import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

/**
 * Prueba estructural de capas (práctica de EchoTwin): la arquitectura declarada
 * en docs/ARCHITECTURE.md se comprueba sobre los imports reales.
 *
 *  - `core` no importa de ningún otro módulo del proyecto.
 *  - `physiology` solo importa `core`.
 *  - `anatomy` solo importa `core` y `physiology`.
 *  - `vexus` no importa `ui`, `app`, `ultrasound` ni `doppler`.
 *  - `ui`, `app` y `validation` no son importados por el motor (`core`, `physiology`, `anatomy`,
 *    `probe`, `ultrasound`, `doppler`, `audio`, `vexus`, `cases`).
 *  - No hay ciclos entre capas salvo los aceptados en ALLOWED_CYCLES (que solo
 *    puede encoger).
 */
const SRC = resolve(__dirname, '..');
const ENGINE = ['core', 'physiology', 'anatomy', 'probe', 'ultrasound', 'doppler', 'audio', 'vexus', 'cases'];
const ALLOWED_CYCLES: string[][] = [];

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f) && !/\.d\.ts$/.test(f)) out.push(p);
  }
  return out;
}

function layerOf(file: string): string {
  const rel = relative(SRC, file);
  return rel.split('/')[0].replace(/\.ts$/, '');
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  // `from '…'`, `import '…'` (efecto lateral) e `import('…')` (dinámico)
  const re = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let target = resolve(dirname(file), m[1]);
    if (!target.endsWith('.ts')) target += '.ts';
    out.push(target);
  }
  return out;
}

const files = listTs(SRC);
const edges = new Map<string, Set<string>>();
const examples = new Map<string, string>();
for (const f of files) {
  const a = layerOf(f);
  for (const t of importsOf(f)) {
    const b = layerOf(t);
    if (a === b) continue;
    if (!edges.has(a)) edges.set(a, new Set());
    edges.get(a)!.add(b);
    examples.set(`${a}>${b}`, `${relative(SRC, f)} → ${relative(SRC, t)}`);
  }
}
const dep = (a: string, b: string) => edges.get(a)?.has(b) ?? false;

/**
 * Dependencias PERMITIDAS de cada capa (Fase 1): matriz completa, no reglas sueltas. Una capa
 * nueva o una dependencia nueva hay que declararlas aquí y en docs/ARCHITECTURE.md.
 * Nota: `doppler → vexus` es deliberado (la medición produce patrones con las reglas puras de
 * VExUS); `doppler` ya NO depende de `audio` (sumidero inyectado, `AudioSink`). `cases → vexus` también
 * (decisión 82): los confusores reales de cada caso (`cases/teaching.ts`) usan el tipo `VexusContext` del
 * clasificador, para que renombrar un confusor rompa la compilación y no el caso.
 */
const ALLOWED: Record<string, readonly string[]> = {
  core: [],
  physiology: ['core'],
  anatomy: ['core', 'physiology'],
  cases: ['physiology', 'vexus'],
  vexus: ['core', 'physiology'],
  probe: ['core', 'anatomy'],
  audio: ['core'],
  doppler: ['core', 'physiology', 'anatomy', 'vexus'],
  ultrasound: ['core', 'physiology', 'anatomy', 'probe'],
  app: ['core', 'physiology', 'anatomy', 'cases', 'probe', 'ultrasound', 'doppler', 'audio', 'vexus'],
  ui: ['core', 'physiology', 'anatomy', 'cases', 'probe', 'ultrasound', 'doppler', 'vexus', 'app'],
  // validation: el registro de limitaciones y los gemelos que solo usan las pruebas (`validation/support`,
  // p. ej. el de los ecos de interfaz, sobre el motor de imagen, y el contorno del hígado de las vistas de
  // las capturas, que necesita la sonda, los casos y las poses de partida de `app/startPoints`); las pruebas
  // no cuentan como capa. La cadena del alumno por la ruta de la aplicación (`support/studentChain.ts`, decisión 93)
  // necesita además la fisiología y la captura del Doppler
  validation: ['core', 'physiology', 'anatomy', 'ultrasound', 'probe', 'doppler', 'cases', 'app'],
  main: ['core', 'physiology', 'anatomy', 'cases', 'probe', 'ultrasound', 'doppler', 'audio', 'vexus', 'app', 'ui'],
};

describe('Fronteras entre capas (docs/ARCHITECTURE.md)', () => {
  it('cada capa conocida tiene su fila en la matriz de dependencias', () => {
    for (const layer of new Set(files.map(layerOf))) expect(ALLOWED[layer], `capa sin reglas: ${layer}`).toBeDefined();
  });
  it('ninguna capa importa fuera de lo que su fila permite', () => {
    const leaks: string[] = [];
    for (const [a, targets] of edges)
      for (const b of targets) if (!(ALLOWED[a] ?? []).includes(b)) leaks.push(`${a} → ${b}: ${examples.get(`${a}>${b}`) ?? ''}`);
    expect(leaks).toEqual([]);
  });
  it('el motor no importa ui, app ni las utilidades de prueba', () => {
    for (const layer of ENGINE) {
      for (const bad of ['ui', 'app', 'main', 'validation']) {
        expect(dep(layer, bad), `${layer} → ${bad}: ${examples.get(`${layer}>${bad}`) ?? ''}`).toBe(false);
      }
    }
  });
  it('no hay ciclos entre capas fuera de los aceptados (que solo pueden encoger)', () => {
    // Tarjan sobre el grafo de capas
    const nodes = [...new Set([...edges.keys(), ...[...edges.values()].flatMap((s) => [...s])])];
    let index = 0;
    const idx = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];
    const strong = (v: string) => {
      idx.set(v, index);
      low.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);
      for (const w of edges.get(v) ?? []) {
        if (!idx.has(w)) {
          strong(w);
          low.set(v, Math.min(low.get(v)!, low.get(w)!));
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
      if (low.get(v) === idx.get(v)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== v);
        if (comp.length > 1) sccs.push(comp.sort());
      }
    };
    for (const n of nodes) if (!idx.has(n)) strong(n);
    const allowed = ALLOWED_CYCLES.map((c) => [...c].sort().join(','));
    for (const c of sccs) {
      const key = c.join(',');
      const detail = c
        .map((a) =>
          c
            .filter((b) => dep(a, b))
            .map((b) => examples.get(`${a}>${b}`))
            .join('; '),
        )
        .join(' | ');
      expect(allowed.includes(key), `ciclo entre capas: ${key} — ${detail}`).toBe(true);
    }
    // el permiso solo puede encoger: cada ciclo aceptado debe seguir existiendo
    for (const a of allowed)
      expect(sccs.map((c) => c.join(',')).includes(a), `ciclo aceptado ${a} ya no existe: bórralo de ALLOWED_CYCLES`).toBe(true);
  });
});
