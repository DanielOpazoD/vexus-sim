import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { scanSource } from './scan';

/**
 * Constantes de los gemelos (decisión 322, punto 5): la secuencia ordenada de literales numéricos, con su signo, del
 * cuerpo de una función TS y de su gemela GLSL. La convención (`docs/ARCHITECTURE.md`) es interpolar en la plantilla las
 * constantes de TS; las que siguen escritas a mano en los dos lados se comparan aquí como secuencias: la de la GLSL
 * tiene que aparecer seguida dentro de la de la TS (la TS puede llevar ramas de más, como la de otra persona). Uso:
 * `node --import tsx tools/twins/constants.ts` imprime las cifras y las listas congeladas del registro.
 */

/** Constantes con nombre de `Math` que el TS usa donde la GLSL escribe el número. */
const MATH: Readonly<Record<string, number>> = {
  SQRT1_2: Math.SQRT1_2,
  SQRT2: Math.SQRT2,
  PI: Math.PI,
  LN2: Math.LN2,
  LN10: Math.LN10,
  E: Math.E,
};

const TOKEN = /0[xX][0-9a-fA-F]+[uU]?|\d+\.\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|\d+[eE][-+]?\d+|\d+[uU]?|[A-Za-z_$][\w$]*|\S/g;
const NUMBER = /^(?:0[xX][0-9a-fA-F]+[uU]?|\d|\.\d)/;

const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Literales de un cuerpo en orden, con signo (negativo si el token anterior es `-`), sin los índices `a[0]` y con las
 * repeticiones seguidas juntas (el TS desenrolla en tres líneas lo que la GLSL hace con un `vec3`). `Math.PI` y
 * compañía cuentan como su valor.
 */
export function literalSequence(body: string): number[] {
  const bare = body
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, (m) => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const tokens = bare.match(TOKEN) ?? [];
  const out: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const before = tokens[i - 1];
    let value: number | undefined;
    if (t === 'Math' && tokens[i + 1] === '.' && tokens[i + 2] in MATH) {
      value = MATH[tokens[i + 2]];
      i += 2;
    } else if (NUMBER.test(t)) {
      if (before === '[' && tokens[i + 1] === ']') continue; // índice
      value = /^0[xX]/.test(t) ? parseInt(t.replace(/[uU]$/, ''), 16) : Number(t.replace(/[uU]$/, ''));
    }
    if (value === undefined) continue;
    if (before === '-') value = -value;
    if (out.length === 0 || !close(out[out.length - 1], value)) out.push(value);
  }
  return out;
}

/** ¿Aparece `part` seguida, elemento a elemento, dentro de `whole`? */
export function contiguousIn(part: readonly number[], whole: readonly number[]): boolean {
  if (part.length === 0) return true;
  for (let i = 0; i + part.length <= whole.length; i++) if (part.every((v, k) => close(v, whole[i + k]))) return true;
  return false;
}

/**
 * Clase de las constantes de una función GLSL frente a su homónima TS. `sin-literales`: la GLSL no escribe ningún número
 * (los interpola de TS o no los necesita); `copiados`: su secuencia aparece seguida en la de la TS (escritos a mano en los
 * dos lados, en el mismo orden y con el mismo signo); `reordenados`: cada literal de la GLSL, con su signo, está en la TS
 * pero no en ese orden (la TS escribe `Math.max(0, x)` donde la GLSL `max(x, 0.0)`, o reparte la cuenta en varias
 * líneas); `distintos`: alguno no está (constante con nombre en TS, literales propios de la GLSL u otra estructura).
 */
export type ConstantsKind = 'sin-literales' | 'copiados' | 'reordenados' | 'distintos';

export function constantsKind(glsl: readonly number[], tsSeq: readonly number[]): ConstantsKind {
  if (glsl.length === 0) return 'sin-literales';
  if (contiguousIn(glsl, tsSeq)) return 'copiados';
  return glsl.every((v) => tsSeq.some((w) => close(v, w))) ? 'reordenados' : 'distintos';
}

/** Cuerpo de la función TS `fn` de `code` (declaración `function` o constante con una función). */
export function tsBody(code: string, fn: string): string | undefined {
  const source = ts.createSourceFile('x.ts', code, ts.ScriptTarget.ES2022, true);
  let body: ts.Node | undefined;
  const find = (node: ts.Node): void => {
    if (body) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === fn) body = node.body;
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === fn && node.initializer)
      body = node.initializer;
    else node.forEachChild(find);
  };
  find(source);
  return body ? code.slice(body.getStart(source), body.end) : undefined;
}

/** Cuerpo de la primera definición de la función GLSL `fn` de `code` (de una plantilla o de una cadena con GLSL). */
export function glslBody(code: string, fn: string): string | undefined {
  const f = scanSource('x.ts', code).glslFunctions.find((g) => g.name === fn);
  return f ? code.slice(f.bodyStart, f.bodyEnd) : undefined;
}

export interface ConstantsRow {
  twin: string;
  fn: string;
  /** Archivo de la GLSL comparada (con `fn`, identifica la fila). */
  file: string;
  glsl: number[];
  ts: number[];
  kind: ConstantsKind;
}

/** Clasifica cada función homónima de un par: la GLSL de cada lado GPU frente a la TS del lado CPU con el mismo nombre. */
export function constantsInventory(
  root: string,
  pairs: ReadonlyArray<{
    id: string;
    cpu: ReadonlyArray<{ file: string; symbols: readonly string[] }>;
    gpu: ReadonlyArray<{ file: string; symbols: readonly string[] }>;
  }>,
  read: (file: string) => string = (f) => readFileSync(join(root, f), 'utf8'),
): ConstantsRow[] {
  const rows: ConstantsRow[] = [];
  for (const p of pairs)
    for (const g of p.gpu)
      for (const fn of g.symbols) {
        const glsl = glslBody(read(g.file), fn);
        const tsSide = p.cpu.find((c) => c.symbols.includes(fn));
        const tsCode = tsSide && tsBody(read(tsSide.file), fn);
        if (glsl === undefined || tsCode === undefined) continue;
        const [gl, tv] = [literalSequence(glsl), literalSequence(tsCode)];
        rows.push({ twin: p.id, fn, file: g.file, glsl: gl, ts: tv, kind: constantsKind(gl, tv) });
      }
  return rows;
}

/** Funciones de una clase por archivo GLSL, en el orden del inventario: la forma de las listas congeladas del registro. */
export function byGlslFile(rows: readonly ConstantsRow[], kind: ConstantsKind): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rows) if (r.kind === kind) (out[r.file] ??= []).push(r.fn);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { ARCHIVOS_PENDIENTES, TWINS } = await import('./registry');
  const rows = constantsInventory(resolve(import.meta.dirname, '../..'), TWINS);
  const count = (k: ConstantsKind): number => rows.filter((r) => r.kind === k).length;
  console.log(
    `${rows.length} funciones GLSL homónimas: sin literales ${count('sin-literales')}, copiados ${count('copiados')}, ` +
      `reordenados ${count('reordenados')}, distintos ${count('distintos')}`,
  );
  // los archivos pendientes de r3 se miden pero no se congelan (regla de colisión de la decisión 322)
  const frozen = rows.filter((r) => !(r.file in ARCHIVOS_PENDIENTES));
  console.log(`CONSTANTES_COPIADAS = ${JSON.stringify(byGlslFile(frozen, 'copiados'), null, 2)}`);
  console.log(`CONSTANTES_REORDENADAS = ${JSON.stringify(byGlslFile(frozen, 'reordenados'), null, 2)}`);
}
