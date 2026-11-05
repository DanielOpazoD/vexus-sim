import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  looseTwinWords,
  missingEvidence,
  missingSymbols,
  orphanHomonyms,
  testTitles,
  unknownMarkers,
  unmarkedSides,
  type Tree,
} from '../../tools/twins/check';
import { constantsInventory, type ConstantsKind } from '../../tools/twins/constants';
import { INVENTORY_END, INVENTORY_START, registrySummary } from '../../tools/twins/inventory';
import {
  ARCHIVOS_PENDIENTES,
  CONSTANTES_COPIADAS,
  CONSTANTES_REORDENADAS,
  HOMONIMOS_NO_GEMELOS,
  SIN_PARIDAD_ACEPTADA,
  TWINS,
  twinStatus,
  type TwinEvidence,
} from '../../tools/twins/registry';
import { markersIn, scanSource, scanTree } from '../../tools/twins/scan';

const ROOT = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');
const exists = (p: string): boolean => existsSync(resolve(ROOT, p));
const TREE: Tree = { byFile: new Map(scanTree(ROOT).map((s) => [s.file, s])), read };
const pair = (id: string) => TWINS.find((t) => t.id === id)!;

/** `code` con la única aparición de `from` en `[start, end)` cambiada por `to`. */
function replaceOnce(code: string, from: string, to: string, [start, end] = [0, code.length]): string {
  const part = code.slice(start, end);
  expect(part.split(from).length - 1, `«${from}» una sola vez`).toBe(1);
  return code.slice(0, start) + part.replace(from, () => to) + code.slice(end);
}

/** Cuerpo de la función GLSL `fn` de `code`, para mutar solo el lado GLSL de un módulo que lleva los dos. */
function glslRange(code: string, fn: string): [number, number] {
  const f = scanSource('x.ts', code).glslFunctions.find((g) => g.name === fn);
  expect(f, `${fn}: función GLSL`).toBeDefined();
  return [f!.bodyStart, f!.bodyEnd];
}

/** El árbol de `src` con un módulo cambiado por `edit`. */
function mutated(file: string, edit: (code: string) => string): Tree {
  const next = edit(read(file));
  const byFile = new Map(TREE.byFile);
  byFile.set(file, scanSource(file, next));
  return { byFile, read: (f) => (f === file ? next : read(f)) };
}

describe('Registro de gemelos (decisión 322, punto 5)', () => {
  it('cada par tiene id único en kebab-case, descripción, dos lados, evidencia de su tipo y hueco si no está demostrado', () => {
    expect(new Set(TWINS.map((t) => t.id)).size).toBe(TWINS.length);
    for (const t of TWINS) {
      expect(t.id, t.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(t.what.length, t.id).toBeGreaterThan(10);
      expect(t.cpu.length * t.gpu.length, t.id).toBeGreaterThan(0);
      for (const e of t.evidence) {
        // la GLSL solo se ejecuta con WebGL: una prueba `gpu` es una e2e; `texto` lee el fuente en vitest
        if (e.kind === 'gpu') expect(e.file, `${t.id}: ${e.title}`).toMatch(/^e2e\/.+\.spec\.ts$/);
        if (e.kind === 'texto') expect(e.file, `${t.id}: ${e.title}`).toMatch(/^src\/validation\/.+\.test\.ts$/);
        if (e.kind === 'worker') expect(t.kind, `${t.id}: ${e.title}`).toBe('cpu-worker');
      }
      if (twinStatus(t) !== 'demostrada') expect(t.gap, `${t.id}: sin paridad numérica completa, falta el motivo (gap)`).toBeTruthy();
    }
    // un hueco declarado rebaja la paridad numérica a parcial
    const gpu: TwinEvidence = { kind: 'gpu', file: 'e2e/x.spec.ts', title: 'x' };
    expect(twinStatus({ evidence: [gpu] })).toBe('demostrada');
    expect(twinStatus({ evidence: [gpu], gap: 'hueco' })).toBe('parcial');
    expect(twinStatus({ evidence: [{ ...gpu, kind: 'texto' }], gap: 'hueco' })).toBe('inspeccion');
    expect(twinStatus({ evidence: [], gap: 'hueco' })).toBe('sin-paridad');
  });

  it('(b) cada lado apunta a símbolos de su lenguaje: TS en la CPU, funciones GLSL y plantillas TS en la GPU', () => {
    expect(missingSymbols(TWINS, TREE)).toEqual([]);
    // con dientes: renombrar un lado no lo salva el homónimo del otro lenguaje en el mismo módulo
    const pleura = 'src/ultrasound/pleura.ts';
    const transmission = 'src/ultrasound/transmission.ts';
    const renamed = (file: string, from: string, to: string) => mutated(file, (code) => replaceOnce(code, from, to));
    expect(missingSymbols(TWINS, renamed(pleura, 'function pleuraCapMm(', 'function pleuraCapMmX('))).toEqual([
      `pleura: el lado CPU (${pleura}) no declara pleuraCapMm en TS`,
    ]);
    expect(missingSymbols(TWINS, renamed(transmission, 'function mirrorDirection(', 'function mirrorDirectionX('))).toEqual([
      `espejo-pleural: el lado CPU (${transmission}) no declara mirrorDirection en TS`,
    ]);
    expect(missingSymbols(TWINS, renamed(pleura, 'float pleuraCapMm(', 'float pleuraCapMmX('))).toEqual([
      `pleura: el lado GPU (${pleura}) no define la función GLSL pleuraCapMm`,
    ]);
    expect(missingSymbols(TWINS, renamed(transmission, 'const MIRROR_DIRECTION_GLSL =', 'const MIRROR_GLSL ='))).toEqual([
      `espejo-pleural: el lado GPU (${transmission}) no declara la plantilla MIRROR_DIRECTION_GLSL`,
    ]);
  });

  it('(c) cada prueba de paridad declarada existe en disco, activa, con ese título', () => {
    expect(missingEvidence(TWINS, exists, read)).toEqual([]);
    // con dientes: la e2e del espejo con un `test.skip()` incondicional, con `.fixme` o envuelta en un `describe.skip`
    const t = pair('espejo-pleural');
    const e = t.evidence[0];
    const code = read(e.file);
    const title = `'${e.title}', async ({ page }) => {`;
    const wrapped = `${replaceOnce(code, `test(${title}`, `test.describe.skip('envoltorio', () => {\ntest(${title}`)}\n});\n`;
    for (const mutant of [
      replaceOnce(code, title, `${title} test.skip();`),
      replaceOnce(code, `test(${title}`, `test.fixme(${title}`),
      wrapped,
    ])
      expect(missingEvidence([t], exists, (f) => (f === e.file ? mutant : read(f)))).toEqual([
        `espejo-pleural: ${e.file} no tiene una prueba activa «${e.title}» (desactivada)`,
      ]);
  });

  it('(c) desactivada: con modificador, dentro de un `describe` con modificador o con `skip()` incondicional en lo alto', () => {
    const code = [
      "describe('a', () => {",
      "  it('activa', () => {});",
      "  it.skip('con modificador', () => {});",
      "  it('con ctx.skip()', (ctx) => { ctx.skip(); });",
      "  test('con test.skip(true)', () => { test.skip(true, 'motivo'); });",
      // condicional: corre donde se cumple la condición, cuenta como activa
      "  test('con skip condicional', ({ browserName }) => { test.skip(browserName !== 'chromium'); });",
      '});',
      "describe.skip('b', () => { it('dentro de describe.skip', () => {}); });",
      "test.describe.fixme('c', () => { test('dentro de test.describe.fixme', async () => {}); });",
      "test.describe('d', () => { test('activa en un test.describe', async () => {}); });",
    ].join('\n');
    expect(testTitles('x.spec.ts', code)).toEqual({
      titles: ['activa', 'con skip condicional', 'activa en un test.describe'],
      disabled: ['con modificador', 'con ctx.skip()', 'con test.skip(true)', 'dentro de describe.skip', 'dentro de test.describe.fixme'],
    });
  });

  it('(a) cada marcador nombra un par registrado y cada lado lo lleva en el comentario inmediato de una declaración suya', () => {
    const texts = new Map(TWINS.flatMap((t) => t.evidence.map((e) => [e.file, read(e.file)] as const)));
    expect(unknownMarkers(TWINS, TREE, texts)).toEqual([]);
    expect(unmarkedSides(TWINS, TREE, ARCHIVOS_PENDIENTES)).toEqual([]);
    // con dientes: el marcador de `mirrorDirection` llevado al final del módulo, o el de su plantilla quitado, ya no cuentan
    const file = 'src/ultrasound/transmission.ts';
    const fnDoc = 'transportada al mundo. @twin espejo-pleural */';
    const moved = mutated(file, (code) => `${replaceOnce(code, fnDoc, 'transportada al mundo. */')}\n// @twin espejo-pleural\n`);
    expect(unknownMarkers(TWINS, moved, new Map())).toEqual([]);
    expect(unmarkedSides(TWINS, moved, ARCHIVOS_PENDIENTES)).toEqual([
      `espejo-pleural: falta @twin espejo-pleural en el comentario de una función (mirrorDirection) de ${file}`,
    ]);
    const template = mutated(file, (code) => replaceOnce(code, 'del rayo. @twin espejo-pleural */', 'del rayo. */'));
    expect(unmarkedSides(TWINS, template, ARCHIVOS_PENDIENTES)).toEqual([
      `espejo-pleural: falta @twin espejo-pleural en el comentario de una plantilla (MIRROR_DIRECTION_GLSL) de ${file}`,
    ]);
    const typo = mutated(file, (code) => replaceOnce(code, fnDoc, 'transportada al mundo. @twin espejo-pleura */'));
    expect(unknownMarkers(TWINS, typo, new Map())).toEqual([
      expect.stringMatching(/^src\/ultrasound\/transmission\.ts:\d+ @twin espejo-pleura$/),
    ]);
  });

  it('(a) la palabra «gemelo» en un comentario TS de src va con su `@twin`; en el texto GLSL, delante de una función registrada', () => {
    expect(looseTwinWords(TWINS, TREE, ARCHIVOS_PENDIENTES)).toEqual([]);
    const loose = mutated('src/ultrasound/transmission.ts', (code) => `${code}\n// gemelo sin marcador\n`);
    expect(looseTwinWords(TWINS, loose, ARCHIVOS_PENDIENTES)).toEqual([
      expect.stringMatching(/^src\/ultrasound\/transmission\.ts:\d+ \(comentario TS sin @twin\)$/),
    ]);
  });

  it('(d) toda función GLSL con el nombre de una función TS, exportada o no, está en un par (gemelo por nombre, decisión 46)', () => {
    expect(orphanHomonyms(TWINS, TREE, HOMONIMOS_NO_GEMELOS)).toEqual([]);
    // con dientes: las homónimas de una función TS que no se exporta salen huérfanas si se quitan de su par
    const declarations = [...TREE.byFile.values()].flatMap((s) => s.tsDeclarations);
    for (const name of ['smoothstepSlope', 'domeLift', 'sdRibBone', 'striationNoise', 'striationFasciaSlope', 'wallFaceNoise']) {
      const ts = declarations.filter((d) => d.name === name);
      expect(ts.length > 0 && ts.every((d) => d.fn && !d.exported), `${name}: función TS sin exportar`).toBe(true);
      const without = TWINS.map((t) => ({ ...t, gpu: t.gpu.map((s) => ({ ...s, symbols: s.symbols.filter((n) => n !== name) })) }));
      const orphans = orphanHomonyms(without, TREE, HOMONIMOS_NO_GEMELOS);
      expect(orphans.length, name).toBeGreaterThan(0);
      expect(
        orphans.every((o) => o.endsWith(` ${name}`)),
        orphans.join(', '),
      ).toBe(true);
    }
  });

  it('(e) un par sin ninguna prueba rompe la CI salvo los congelados el 05-11-2026, y esa lista solo encoge', () => {
    const none = TWINS.filter((t) => twinStatus(t) === 'sin-paridad').map((t) => t.id);
    expect(
      none.filter((id) => !SIN_PARIDAD_ACEPTADA.includes(id)),
      'pares nuevos sin prueba de paridad',
    ).toEqual([]);
    expect(
      SIN_PARIDAD_ACEPTADA.filter((id) => !none.includes(id)),
      'ya tienen prueba (o no existen): sácalos de SIN_PARIDAD_ACEPTADA',
    ).toEqual([]);
    for (const f of Object.keys(ARCHIVOS_PENDIENTES)) expect(exists(f), f).toBe(true);
  });

  describe('constantes escritas a mano en una función TS y en su homónima GLSL', () => {
    const rows = constantsInventory(ROOT, TWINS);
    const now = (kind: ConstantsKind): string[] =>
      rows
        .filter((r) => r.kind === kind && !(r.file in ARCHIVOS_PENDIENTES))
        .map((r) => `${r.file}#${r.fn}`)
        .sort();
    const frozen = (lists: Readonly<Record<string, readonly string[]>>): string[] =>
      Object.entries(lists)
        .flatMap(([file, fns]) => fns.map((fn) => `${file}#${fn}`))
        .sort();

    it('cada función congelada sigue en su clase y cada copia nueva está registrada', () => {
      expect(rows.length, 'funciones GLSL homónimas comparadas').toBeGreaterThanOrEqual(180);
      // un literal cambiado en un solo lado saca la función de su clase; regenera con node --import tsx tools/twins/constants.ts
      expect(now('copiados'), 'CONSTANTES_COPIADAS').toEqual(frozen(CONSTANTES_COPIADAS));
      expect(now('reordenados'), 'CONSTANTES_REORDENADAS').toEqual(frozen(CONSTANTES_REORDENADAS));
    });

    const pleura = 'src/ultrasound/pleura.ts';
    const abdomen = 'src/anatomy/organs/abdomen.ts';
    const mutants: Array<{ name: string; id: string; file: string; fn: string; from: string; to: string; kind: ConstantsKind }> = [
      {
        name: 'erf, dos cifras traspuestas',
        id: 'pleura',
        file: pleura,
        fn: 'normalCdf',
        from: '1.453152027',
        to: '1.453152072',
        kind: 'distintos',
      },
      {
        name: 'erf, dos coeficientes intercambiados',
        id: 'pleura',
        file: pleura,
        fn: 'normalCdf',
        from: '1.421413741) * t - 0.284496736',
        to: '0.284496736) * t - 1.421413741',
        kind: 'distintos',
      },
      {
        name: 'erf, un signo cambiado',
        id: 'pleura',
        file: pleura,
        fn: 'normalCdf',
        from: '* t - 1.453152027',
        to: '* t + 1.453152027',
        kind: 'distintos',
      },
      { name: 'erf, 0.3275911 → 0.5', id: 'pleura', file: pleura, fn: 'normalCdf', from: '0.3275911', to: '0.5', kind: 'reordenados' },
      {
        name: 'gas digestivo, 17.0 → 21.0',
        id: 'organo-abdomen',
        file: abdomen,
        fn: 'digestiveGasPlane',
        from: '/17.0',
        to: '/21.0',
        kind: 'reordenados',
      },
    ];
    it.each(mutants)('mutante en la GLSL ($name): la función sale de «copiados»', ({ id, file, fn, from, to, kind }) => {
      expect(frozen(CONSTANTES_COPIADAS)).toContain(`${file}#${fn}`);
      const code = read(file);
      const next = replaceOnce(code, from, to, glslRange(code, fn));
      const after = constantsInventory(ROOT, [pair(id)], (f) => (f === file ? next : read(f))).find((r) => r.file === file && r.fn === fn);
      expect(after?.kind).toBe(kind);
    });
  });

  it('la lectura no se engaña: cadenas, prototipos, interpolaciones, GLSL sin etiqueta y el comentario inmediato', () => {
    const scan = scanSource(
      'x.ts',
      [
        "const url = 'http://example.com // gemelo falso';",
        '/** Gemelo GLSL de `a`. @twin par-a */',
        'export function a(): number { return 1; }',
        '// gemelo suelto',
        '// sigue el bloque',
        'export const A_GLSL = /* glsl */ `',
        'float a(float x);',
        '// gemelo TS: a. @twin dentro-del-glsl',
        'float a(float x) { return x; }',
        '${String(1)}',
        '// gemelo tras una interpolación',
        'float b(float x) { return x; }',
        '`;',
        "const SUSTITUCION = 'float c(float x) { return 2.0 * x; }';",
        'const nombre = `float s28_${"d"}(float x) { return x; }`;',
        "const prosa = 'una llave { y otra }';",
        '/** Lejos. @twin par-b */',
        '// el comentario inmediato no lo lleva',
        'function b(): number { return 2; }',
      ].join('\n'),
    );
    expect(scan.tsComments.map((c) => [c.startLine, c.endLine])).toEqual([
      [2, 2],
      [4, 5],
      [17, 17],
      [18, 18],
    ]);
    // la GLSL de una cadena sin etiqueta cuenta; un nombre pegado a una interpolación no es un nombre fijo
    expect(scan.glslFunctions.map(({ name, line, tagged }) => ({ name, line, tagged }))).toEqual([
      { name: 'a', line: 9, tagged: true },
      { name: 'b', line: 12, tagged: true },
      { name: 'c', line: 14, tagged: false },
    ]);
    expect(scan.glslComments.map((c) => [c.startLine, c.nextGlslFunction])).toEqual([
      [8, 'a'],
      [11, 'b'],
    ]);
    // un marcador dentro del GLSL no cuenta como marcador del lado: el texto GLSL no se toca
    expect(scan.tsComments.flatMap((c) => markersIn(c.text))).toEqual(['par-a', 'par-b']);
    // el marcador de una declaración es el de su comentario inmediato: `b` no lleva el de `/** Lejos. */`
    expect(scan.tsDeclarations.map((d) => [d.name, d.exported, d.fn, markersIn(d.leading)])).toEqual([
      ['url', false, false, []],
      ['a', true, true, ['par-a']],
      ['A_GLSL', true, false, []],
      ['SUSTITUCION', false, false, []],
      ['nombre', false, false, []],
      ['prosa', false, false, []],
      ['b', false, true, []],
    ]);
  });

  it('docs/engineering/gemelos.md lleva las cifras del registro y nombra cada par', () => {
    const doc = read('docs/engineering/gemelos.md');
    const section = doc.slice(doc.indexOf(INVENTORY_START), doc.indexOf(INVENTORY_END));
    expect(section, 'regenera con node --import tsx tools/twins/inventory.ts --write').toContain(registrySummary());
    for (const t of TWINS) expect(section, `${t.id}: regenera el inventario`).toMatch(new RegExp(`\\| \`${t.id}\` +\\|`));
  });
});
