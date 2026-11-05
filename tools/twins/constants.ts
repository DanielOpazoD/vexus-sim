import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { findGlslTemplates } from '../build/glslMinify';

/**
 * Constantes de los gemelos (decisión 322, punto 5): los literales numéricos del cuerpo de una función TS y de su gemela
 * GLSL. La convención (`docs/ARCHITECTURE.md`) es interpolar en la plantilla las constantes de TS; los que siguen
 * escritos a mano en los dos lados se comparan aquí como conjuntos de valores.
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

/** Literales de la función TS `fn` de `code` (sin los índices `a[0]`), con las constantes de `Math`. */
export function tsLiterals(code: string, fn: string): number[] | undefined {
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
  if (!body) return undefined;
  const out: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNumericLiteral(node) && !(ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node))
      out.push(Number(node.text.replace(/_/g, '')));
    else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Math' &&
      node.name.text in MATH
    )
      out.push(MATH[node.name.text]);
    node.forEachChild(visit);
  };
  visit(body);
  return out;
}

/** Literales del cuerpo de la función GLSL `fn` en las plantillas `/* glsl *\/` de `code` (sin los interpolados). */
export function glslLiterals(code: string, fn: string): number[] | undefined {
  for (const tpl of findGlslTemplates(code)) {
    // una interpolación es un hueco: separa, pero no aporta literales
    const text = tpl.statics.join(' ').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
    const head = new RegExp(
      `(?:^|[\\n;{}])\\s*(?:void|float|int|uint|bool|[iu]?vec[234]|mat[234]|[A-Z]\\w*)\\s+${fn}\\s*\\([^()]*\\)\\s*\\{`,
    ).exec(text);
    if (!head) continue;
    let depth = 1,
      i = head.index + head[0].length;
    const start = i;
    for (; i < text.length && depth > 0; i++) depth += text[i] === '{' ? 1 : text[i] === '}' ? -1 : 0;
    const body = text.slice(start, i - 1);
    return [...body.matchAll(/(?<![\w.])(\d+\.\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|\d+[eE][-+]?\d+|\d+)(?![\w.])/g)].map((m) =>
      Number(m[1]),
    );
  }
  return undefined;
}

/** Conjunto de valores distintos (a 1e-8 relativo: `Math.SQRT1_2` frente a `0.70710678` difiere en 1,2e-9). */
export function distinct(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) if (!out.some((w) => Math.abs(w - v) <= 1e-8 * Math.max(1, Math.abs(v)))) out.push(v);
  return out;
}

/** ¿Está cada valor de `a` en `b`? */
export const containedIn = (a: readonly number[], b: readonly number[]): boolean =>
  a.every((v) => b.some((w) => Math.abs(v - w) <= 1e-8 * Math.max(1, Math.abs(v))));

/** Literales que no dicen nada de la física: 0, 1, 2 y 0,5. */
export const STRUCTURAL = new Set([0, 1, 2, 0.5]);

export interface ConstantsRow {
  twin: string;
  fn: string;
  /** Valores distintos no estructurales escritos en la GLSL (no interpolados). */
  glsl: number[];
  ts: number[];
  /**
   * `sin-literales`: la GLSL no escribe ninguno (los interpola de TS o solo usa 0, 1, 2 y 0,5); `copiados`: cada uno está
   * también escrito en la función TS (duplicados a mano); `propios`: la GLSL escribe alguno que la TS no (centinelas,
   * épsilon, 2π como número, o una constante con nombre en TS).
   */
  kind: 'sin-literales' | 'copiados' | 'propios';
}

/** Clasifica cada función homónima de un par (la TS y la GLSL con el mismo nombre). */
export function constantsInventory(
  root: string,
  pairs: ReadonlyArray<{
    id: string;
    cpu: ReadonlyArray<{ file: string; symbols: readonly string[] }>;
    gpu: ReadonlyArray<{ file: string; symbols: readonly string[] }>;
  }>,
): ConstantsRow[] {
  const read = (f: string): string => readFileSync(join(root, f), 'utf8');
  const rows: ConstantsRow[] = [];
  for (const p of pairs)
    for (const g of p.gpu)
      for (const fn of g.symbols) {
        const glsl = glslLiterals(read(g.file), fn);
        if (!glsl) continue;
        const tsSide = p.cpu.find((c) => c.symbols.includes(fn));
        const tsVals = tsSide && tsLiterals(read(tsSide.file), fn);
        if (!tsVals) continue;
        const physical = (v: readonly number[]): number[] => distinct(v).filter((x) => !STRUCTURAL.has(x));
        const [gl, tv] = [physical(glsl), physical(tsVals)];
        const kind = gl.length === 0 ? 'sin-literales' : containedIn(gl, tv) ? 'copiados' : 'propios';
        rows.push({ twin: p.id, fn, glsl: gl, ts: tv, kind });
      }
  return rows;
}
