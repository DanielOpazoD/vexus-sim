import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { constantsInventory, glslLiterals, tsLiterals, containedIn } from '../../tools/twins/constants';
import { INVENTORY_END, INVENTORY_START, registrySummary } from '../../tools/twins/inventory';
import {
  ARCHIVOS_PENDIENTES,
  CONSTANTES_COPIADAS,
  HOMONIMOS_NO_GEMELOS,
  SIN_PARIDAD_ACEPTADA,
  TWINS,
  twinStatus,
} from '../../tools/twins/registry';
import { markersIn, scanSource, scanTree, TWIN_WORD, type ScannedSource } from '../../tools/twins/scan';

const ROOT = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');
const TREE = scanTree(ROOT);
const BY_FILE = new Map(TREE.map((s) => [s.file, s]));
const IDS = new Set(TWINS.map((t) => t.id));

/** ¿Define el módulo ese símbolo? Una función GLSL de sus plantillas o una declaración TS (también miembros de clase). */
const defines = (scan: ScannedSource, name: string): boolean =>
  scan.glslFunctions.some((f) => f.name === name) || scan.tsDeclarations.some((d) => d.name === name);

/** Títulos de las pruebas de un archivo: el primer argumento de `it(…)`/`test(…)`, sin `.skip`, `.fails` ni `.todo`. */
function testTitles(file: string): { titles: string[]; disabled: string[] } {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const titles: string[] = [];
  const disabled: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression;
      const arg = node.arguments[0];
      const title = ts.isStringLiteralLike(arg) || ts.isTemplateExpression(arg) ? arg.getText(source).slice(1, -1) : undefined;
      if (title !== undefined && ts.isIdentifier(callee) && (callee.text === 'it' || callee.text === 'test')) titles.push(title);
      if (
        title !== undefined &&
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        ['it', 'test'].includes(callee.expression.text) &&
        ['skip', 'fails', 'todo', 'fixme', 'only'].includes(callee.name.text)
      )
        disabled.push(title);
    }
    node.forEachChild(visit);
  };
  visit(source);
  return { titles, disabled };
}

describe('Registro de gemelos (decisión 322, punto 5)', () => {
  it('cada par tiene id único en kebab-case, descripción, dos lados y evidencia del tipo que admite su archivo', () => {
    expect(IDS.size).toBe(TWINS.length);
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
      if (twinStatus(t) !== 'demostrada') expect(t.gap, `${t.id}: sin paridad numérica, falta el motivo (gap)`).toBeTruthy();
    }
  });

  it('(b) cada entrada apunta a archivos y símbolos que existen', () => {
    const missing: string[] = [];
    for (const t of TWINS)
      for (const [label, sides] of [
        ['cpu', t.cpu],
        ['gpu', t.gpu],
      ] as const)
        for (const side of sides) {
          const scan = BY_FILE.get(side.file);
          if (!scan) {
            missing.push(`${t.id}: ${side.file} no existe (o es una prueba)`);
            continue;
          }
          for (const name of side.symbols) {
            // el lado Worker instala con las mismas funciones que la página: basta con que las llame
            const ok =
              t.kind === 'cpu-worker' && label === 'gpu' ? new RegExp(`\\b${name}\\s*\\(`).test(read(side.file)) : defines(scan, name);
            if (!ok) missing.push(`${t.id}: ${side.file} no define ${name}`);
          }
        }
    expect(missing).toEqual([]);
  });

  it('(c) cada prueba de paridad declarada existe en disco, activa, con ese título', () => {
    const missing: string[] = [];
    for (const t of TWINS)
      for (const e of t.evidence) {
        if (!existsSync(resolve(ROOT, e.file))) {
          missing.push(`${t.id}: ${e.file} no existe`);
          continue;
        }
        const { titles, disabled } = testTitles(e.file);
        if (!titles.some((title) => title.includes(e.title)))
          missing.push(
            `${t.id}: ${e.file} no tiene una prueba activa «${e.title}»${disabled.some((d) => d.includes(e.title)) ? ' (desactivada)' : ''}`,
          );
      }
    expect(missing).toEqual([]);
  });

  it('(a) cada marcador `@twin` de src nombra un par registrado, y cada lado lleva el suyo salvo los pendientes de r3', () => {
    const unknown: string[] = [];
    const markers = new Map<string, Set<string>>();
    for (const s of TREE)
      for (const c of s.tsComments)
        for (const id of markersIn(c.text)) {
          if (!IDS.has(id)) unknown.push(`${s.file}:${c.startLine} @twin ${id}`);
          (markers.get(s.file) ?? markers.set(s.file, new Set()).get(s.file)!).add(id);
        }
    // también en las pruebas: un marcador allí es una referencia y debe existir
    for (const t of TWINS)
      for (const e of t.evidence) for (const id of markersIn(read(e.file))) if (!IDS.has(id)) unknown.push(`${e.file} @twin ${id}`);
    expect(unknown).toEqual([]);
    const unmarked = new Set<string>();
    for (const t of TWINS)
      for (const side of [...t.cpu, ...t.gpu])
        if (!(side.file in ARCHIVOS_PENDIENTES) && !markers.get(side.file)?.has(t.id))
          unmarked.add(`${t.id}: falta @twin ${t.id} en ${side.file}`);
    expect([...unmarked]).toEqual([]);
  });

  it('(a) la palabra «gemelo» en un comentario TS de src va con su `@twin`; en el texto GLSL, delante de una función registrada', () => {
    const glslSymbols = new Map<string, Set<string>>();
    for (const t of TWINS)
      for (const side of t.gpu)
        for (const n of side.symbols) (glslSymbols.get(side.file) ?? glslSymbols.set(side.file, new Set()).get(side.file)!).add(n);
    const loose: string[] = [];
    for (const s of TREE) {
      if (s.file in ARCHIVOS_PENDIENTES) continue;
      for (const c of s.tsComments)
        if (TWIN_WORD.test(c.text) && markersIn(c.text).length === 0) loose.push(`${s.file}:${c.startLine} (comentario TS sin @twin)`);
      for (const c of s.glslComments)
        if (TWIN_WORD.test(c.text) && !(c.nextGlslFunction && glslSymbols.get(s.file)?.has(c.nextGlslFunction)))
          loose.push(`${s.file}:${c.startLine} (GLSL: «${c.nextGlslFunction ?? '—'}» no está en ningún par)`);
    }
    expect(loose).toEqual([]);
  });

  it('(d) toda función GLSL con el nombre de una exportación TS está en un par (gemelo por nombre, decisión 46)', () => {
    const tsNames = new Set(TREE.flatMap((s) => s.tsDeclarations.filter((d) => d.exported || d.member).map((d) => d.name)));
    const covered = new Set(TWINS.flatMap((t) => t.gpu.flatMap((side) => side.symbols.map((n) => `${side.file}#${n}`))));
    const orphan: string[] = [];
    for (const s of TREE)
      for (const f of s.glslFunctions)
        if (f.name !== 'main' && tsNames.has(f.name) && !covered.has(`${s.file}#${f.name}`) && !(f.name in HOMONIMOS_NO_GEMELOS))
          orphan.push(`${s.file}:${f.line} ${f.name}`);
    expect([...new Set(orphan)]).toEqual([]);
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
    for (const f of Object.keys(ARCHIVOS_PENDIENTES)) expect(existsSync(resolve(ROOT, f)), f).toBe(true);
  });

  it('las constantes copiadas a mano en una función TS y su gemela GLSL siguen iguales en los dos lados', () => {
    const rows = constantsInventory(ROOT, TWINS);
    const copied = rows.filter((r) => r.kind === 'copiados').map((r) => `${r.twin}:${r.fn}`);
    const frozen = Object.entries(CONSTANTES_COPIADAS).flatMap(([twin, fns]) => fns.map((fn) => `${twin}:${fn}`));
    // una constante cambiada en un solo lado saca la función de «copiados»
    expect(
      frozen.filter((k) => !copied.includes(k)),
      'GLSL con un literal que la TS ya no tiene',
    ).toEqual([]);
    expect(rows.length, 'funciones homónimas comparadas').toBeGreaterThanOrEqual(150);
    // con dientes: el coeficiente de la erf cambiado solo en la GLSL deja de estar en la TS
    const pleura = read('src/ultrasound/pleura.ts');
    const ts = tsLiterals(pleura, 'normalCdf')!;
    expect(containedIn(glslLiterals(pleura, 'normalCdf')!, ts)).toBe(true);
    const at = pleura.lastIndexOf('1.453152027'); // la GLSL va después de la TS en el módulo
    expect(at).toBeGreaterThan(pleura.indexOf('1.453152027'));
    const mutated = `${pleura.slice(0, at)}1.453152072${pleura.slice(at + '1.453152027'.length)}`; // dos cifras traspuestas
    expect(containedIn(glslLiterals(mutated, 'normalCdf')!, ts)).toBe(false);
  });

  it('la lectura no se engaña: comentarios dentro de cadenas, prototipos GLSL y marcadores en el texto GLSL', () => {
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
      ].join('\n'),
    );
    expect(scan.tsComments.map((c) => [c.startLine, c.endLine])).toEqual([
      [2, 2],
      [4, 5],
    ]);
    expect(scan.glslFunctions).toEqual([
      { name: 'a', line: 9 },
      { name: 'b', line: 12 },
    ]);
    expect(scan.glslComments.map((c) => [c.startLine, c.nextGlslFunction])).toEqual([
      [8, 'a'],
      [11, 'b'],
    ]);
    // un marcador dentro del GLSL no cuenta como marcador del lado: el texto GLSL no se toca
    expect(scan.tsComments.flatMap((c) => markersIn(c.text))).toEqual(['par-a']);
    expect(scan.tsDeclarations.map((d) => d.name)).toEqual(['url', 'a', 'A_GLSL']);
  });

  it('docs/engineering/gemelos.md lleva las cifras del registro y nombra cada par', () => {
    const doc = read('docs/engineering/gemelos.md');
    const section = doc.slice(doc.indexOf(INVENTORY_START), doc.indexOf(INVENTORY_END));
    expect(section, 'regenera con node --import tsx tools/twins/inventory.ts --write').toContain(registrySummary());
    for (const t of TWINS) expect(section, `${t.id}: regenera el inventario`).toMatch(new RegExp(`\\| \`${t.id}\` +\\|`));
  });
});
