import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUDGETS } from '../../tools/ci/bundleBudgets';
import { DEFAULT_JS_BUDGET, S0028_JS_BUDGET } from '../../tools/ci/personBundles';
import { SAMPLER_GUARD, SLOT_GUARD } from '../../tools/ci/shaderBudgets';
import { parseDecisions } from '../../tools/docs/decisions-index';
import {
  BLOCKS,
  LOAD_S0028_GUARD,
  MEDIDAS,
  descriptorSha256,
  s0028Textures,
  shaderRows,
  staticCeilings,
  type Medidas,
} from '../../tools/docs/estado';

const ROOT = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');
const PAGES = ['docs/estado/anatomia.md', 'docs/estado/imagen.md', 'docs/estado/pruebas.md', 'docs/estado/presupuestos.md'] as const;
const medidas = (): Medidas => JSON.parse(read(MEDIDAS)) as Medidas;
/** Tablas Markdown sin el relleno de prettier: celdas recortadas y separadores canónicos. */
const tables = (md: string): string =>
  md
    .split('\n')
    .map((l) =>
      l.startsWith('|')
        ? l
            .split('|')
            .map((c) => c.trim().replace(/^(:?)-+(:?)$/, '$1---$2'))
            .join('|')
        : l,
    )
    .join('\n');

/** Números de decisión citados en prosa («decisión 61», «decisiones 309 y 320», «317–321») y en columnas «Decisión». */
function citedDecisions(md: string): number[] {
  const out: number[] = [];
  const numbers = (text: string): void => {
    for (const m of text.matchAll(/(\d+)(?:\s*[–-]\s*(\d+))?/g)) {
      const a = Number(m[1]),
        b = m[2] === undefined ? a : Number(m[2]);
      for (let k = a; k <= b && k - a < 50; k++) out.push(k);
    }
  };
  for (const m of md.matchAll(/decisi(?:ón|ones)\s+((?:\d+(?:\s*[–-]\s*\d+)?(?:\s*,\s*|\s+y\s+)?)+)/gi)) numbers(m[1]);
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('|') || !lines[i + 1]?.startsWith('| ---')) continue;
    const cols = lines[i]
      .split('|')
      .map((c) => c.trim())
      .flatMap((c, k) => (/decisi/i.test(c) ? [k] : []));
    for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) {
      const cells = lines[j].split('|');
      for (const k of cols) if (/^\s*[\d,\s–-]+\s*$/.test(cells[k] ?? '')) numbers(cells[k]);
    }
  }
  return out;
}

describe('Páginas de estado vigente (decisión 322, punto 9)', () => {
  it('existen, son cortas, dicen sobre qué main se actualizaron y citan decisiones que existen', () => {
    const decisions = parseDecisions(read('docs/DECISIONS.md')).length;
    for (const page of PAGES) {
      expect(existsSync(resolve(ROOT, page)), page).toBe(true);
      const md = read(page);
      expect(md.split('\n').length, `${page}: ≤ 120 líneas`).toBeLessThanOrEqual(121);
      expect(md, page).toMatch(/^Actualizado: \d{4}-\d{2}-\d{2} sobre main `[0-9a-f]{7,40}`\./m);
      const cited = citedDecisions(md);
      expect(new Set(cited).size, `${page}: cita al menos tres decisiones`).toBeGreaterThanOrEqual(3);
      expect(
        cited.filter((n) => n < 1 || n > decisions),
        `${page}: decisiones que no existen`,
      ).toEqual([]);
    }
  });

  it('las cifras generadas son las de medidas.json, del mismo main que dice cada página', () => {
    const m = medidas();
    for (const [page, b] of Object.entries(BLOCKS)) {
      const md = read(page);
      expect(
        tables(md.slice(md.indexOf(b.start), md.indexOf(b.end) + b.end.length)),
        `${page}: regenera con tools/docs/estado.ts --write`,
      ).toBe(tables(b.render(m)));
      expect(md, page).toContain(`sobre main \`${m.main}\``);
    }
  });

  it('cada techo de medidas.json es el que aplica hoy el código', () => {
    const m = medidas();
    // bundle: el techo de cada activo es el primer patrón de bundleBudgets.ts que encaja con su nombre en dist
    for (const r of m.rows.filter((r) => r.source === 'tools/ci/bundleBudgets.ts')) {
      const name = r.what.replace(/`/g, '').replace(/(\.\w+)$/, '-abcdefgh$1');
      expect(r.limit, r.what).toBe(BUDGETS.find(([re]) => re.test(name))?.[1]);
    }
    // los demás, leídos de su fuente
    const statics = staticCeilings(ROOT);
    for (const c of statics) expect(m.rows, c.what).toContainEqual(expect.objectContaining(c));
    expect(m.rows.filter((r) => r.source !== 'tools/ci/bundleBudgets.ts')).toHaveLength(statics.length);
  });

  it('publica las dos clausuras JS y conserva el techo de main para cada una', () => {
    const rows = medidas().rows.filter((r) => r.source === 'tools/ci/personBundles.ts');
    expect(rows.map((r) => [r.what, r.limit])).toEqual([
      ['JS clausura default (Workers y ganchos incluidos)', DEFAULT_JS_BUDGET],
      ['JS clausura s0028 (Workers y ganchos incluidos)', S0028_JS_BUDGET],
    ]);
    for (const row of rows) {
      expect(row.actual).toBeGreaterThan(0);
      expect(row.actual).toBeLessThanOrEqual(row.limit);
      expect(row.limit).toBe(1_070_080);
    }
  });

  it.each([
    { what: 'Samplers por programa (las dos personas)', limit: SAMPLER_GUARD },
    { what: 'Ranuras vec4 de uniforms por programa', limit: SLOT_GUARD },
  ])('$what: la página publica la guarda real de shaderLimits', ({ what, limit }) => {
    const row = read('docs/estado/presupuestos.md')
      .split('\n')
      .map((line) => line.split('|').map((cell) => cell.trim()))
      .find((cells) => cells[1] === what);
    expect(row, what).toBeDefined();
    expect(Number(row?.[2].replaceAll('.', '')), `${what}: regenera la página si cambia la guarda`).toBe(limit);
  });

  it('las medidas de programas y texturas son las vivas mientras su GLSL y sus descriptores no cambien', () => {
    const m = medidas();
    const live = shaderRows();
    expect(live.map((s) => [s.name, s.tokenLimit, s.branchLimit])).toEqual(m.shaders.map((s) => [s.name, s.tokenLimit, s.branchLimit]));
    for (const s of m.shaders) {
      const now = live.find((x) => x.name === s.name)!;
      if (now.current.sourceSha256 === s.current.sourceSha256) expect(now.current, `${s.name} default`).toEqual(s.current);
      if (now.s0028.sourceSha256 === s.s0028.sourceSha256) expect(now.s0028, `${s.name} s0028`).toEqual(s.s0028);
    }
    // la cuenta de las texturas es la de la carga instalada
    const loader = read('src/anatomy/people/s0028/runtime.ts').replace(/\s+/g, ' ');
    for (const expr of LOAD_S0028_GUARD) expect(loader, expr).toContain(expr);
    if (m.s0028DescriptorSha256 === descriptorSha256()) {
      const t = s0028Textures();
      expect(m.rows.find((r) => r.what.startsWith('Textura abdominal'))?.actual).toBe(t.abdominal);
      expect(m.rows.find((r) => r.what.startsWith('Textura torácica'))?.actual).toBe(t.thoracic);
    }
  });
});
