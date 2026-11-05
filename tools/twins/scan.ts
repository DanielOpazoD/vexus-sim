import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { findGlslTemplates } from '../build/glslMinify';

/**
 * Lectura estática de los gemelos (decisión 322, punto 5): funciones GLSL de las plantillas `/* glsl *\/`, declaraciones
 * TS, comentarios y marcadores `@twin <id>` de los módulos de `src`. Solo lee texto: no importa los módulos ni ejecuta
 * GLSL. Lo usan `src/validation/twinRegistry.test.ts` y `tools/twins/inventory.ts`.
 */

/** Marcador de un par del registro: `@twin <id>` en un comentario TS (JSDoc o `//`), nunca dentro del texto GLSL. */
export const TWIN_MARKER = /@twin\s+([a-z0-9]+(?:-[a-z0-9]+)*)/g;
/** La palabra con la que el proyecto declara un gemelo en prosa. */
export const TWIN_WORD = /gemel[oa]s?/i;

export interface Located {
  name: string;
  /** Línea (1…) en el archivo. */
  line: number;
}

export interface TsDeclaration extends Located {
  exported: boolean;
  /** Método o propiedad de una clase (p. ej. `AnatomyScene.classify`). */
  member: boolean;
}

export interface CommentBlock {
  startLine: number;
  endLine: number;
  text: string;
  /** Comentario GLSL dentro de una plantilla `/* glsl *\/`: la función GLSL que sigue en la misma plantilla. */
  nextGlslFunction?: string;
}

export interface ScannedSource {
  /** Ruta desde la raíz del repositorio, con `/`. */
  file: string;
  glslFunctions: Located[];
  tsDeclarations: TsDeclaration[];
  /** Comentarios TS, agrupados: un JSDoc o bloque `/* *\/`, o una racha de `//` en líneas seguidas. */
  tsComments: CommentBlock[];
  /** Comentarios GLSL (dentro de las plantillas), uno por comentario. */
  glslComments: CommentBlock[];
}

const lineAt = (starts: readonly number[], offset: number): number => {
  let lo = 0,
    hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
};

/** Texto con los comentarios GLSL en blanco (conserva posiciones y saltos de línea). */
function blankGlslComments(text: string): { code: string; comments: Array<{ start: number; end: number }> } {
  const comments: Array<{ start: number; end: number }> = [];
  let out = '';
  for (let i = 0; i < text.length;) {
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      comments.push({ start: i, end: stop });
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      comments.push({ start: i, end: stop });
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else out += text[i++];
  }
  return { code: out, comments };
}

/** Definición de función GLSL (no un prototipo): tipo, nombre, parámetros y llave. */
const GLSL_FUNCTION =
  /(^|[\n;{}])([ \t]*)(?:(?:highp|mediump|lowp)\s+)?(?:void|float|int|uint|bool|[iu]?vec[234]|mat[234](?:x[234])?|[A-Z]\w*)\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*\{/g;

/** Lee un módulo: funciones GLSL de sus plantillas, declaraciones TS, comentarios TS y comentarios GLSL. */
export function scanSource(file: string, code: string): ScannedSource {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  const glslFunctions: Located[] = [];
  const glslComments: CommentBlock[] = [];
  for (const tpl of findGlslTemplates(code)) {
    const raw = code.slice(tpl.start, tpl.end);
    // las interpolaciones `${…}` se tratan como texto opaco: no definen funciones con nombre fijo
    const { code: bare, comments } = blankGlslComments(raw.replace(/\$\{[^}]*\}/g, (m) => m.replace(/[^\n]/g, ' ')));
    const defs: Array<Located & { offset: number }> = [];
    for (const m of bare.matchAll(GLSL_FUNCTION)) {
      const offset = tpl.start + m.index + m[1].length + m[2].length;
      defs.push({ name: m[3], line: lineAt(starts, offset), offset });
    }
    glslFunctions.push(...defs.map(({ name, line }) => ({ name, line })));
    for (const c of comments) {
      const offset = tpl.start + c.start;
      glslComments.push({
        startLine: lineAt(starts, offset),
        endLine: lineAt(starts, tpl.start + c.end),
        text: raw.slice(c.start, c.end),
        nextGlslFunction: defs.find((d) => d.offset > offset)?.name,
      });
    }
  }
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const tsDeclarations: TsDeclaration[] = [];
  const exportedTop = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const add = (name: ts.Node | undefined, exported: boolean, member: boolean): void => {
    if (name && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)))
      tsDeclarations.push({ name: name.text, line: lineAt(starts, name.getStart(source)), exported, member });
  };
  for (const stmt of source.statements) {
    if (ts.isFunctionDeclaration(stmt)) add(stmt.name, exportedTop(stmt), false);
    else if (ts.isVariableStatement(stmt)) for (const d of stmt.declarationList.declarations) add(d.name, exportedTop(stmt), false);
    else if (ts.isClassDeclaration(stmt)) {
      add(stmt.name, exportedTop(stmt), false);
      for (const m of stmt.members)
        if (ts.isMethodDeclaration(m) || ts.isPropertyDeclaration(m) || ts.isGetAccessorDeclaration(m)) add(m.name, false, true);
    } else if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt))
      add(stmt.name, exportedTop(stmt), false);
  }
  // comentarios TS: los rangos de comentario de cada nodo, sin repetir. Tras una interpolación `${…}` el rango «de
  // comentario» puede caer dentro del texto de la plantilla (un `//` del GLSL): se descartan los que empiezan en una
  // cadena, una plantilla o una expresión regular.
  const literals: Array<[number, number]> = [];
  const seen = new Set<number>();
  const ranges: ts.CommentRange[] = [];
  const collect = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isRegularExpressionLiteral(node)
    )
      literals.push([node.getStart(source), node.end]);
    for (const r of [...(ts.getLeadingCommentRanges(code, node.pos) ?? []), ...(ts.getTrailingCommentRanges(code, node.end) ?? [])])
      if (!seen.has(r.pos)) {
        seen.add(r.pos);
        ranges.push(r);
      }
    node.forEachChild(collect);
  };
  collect(source);
  for (const r of ts.getLeadingCommentRanges(code, source.endOfFileToken.pos) ?? [])
    if (!seen.has(r.pos)) {
      seen.add(r.pos);
      ranges.push(r);
    }
  const inLiteral = (pos: number): boolean => literals.some(([a, b]) => pos >= a && pos < b);
  ranges.splice(0, ranges.length, ...ranges.filter((r) => !inLiteral(r.pos)));
  ranges.sort((a, b) => a.pos - b.pos);
  const tsComments: CommentBlock[] = [];
  for (const r of ranges) {
    const startLine = lineAt(starts, r.pos);
    const endLine = lineAt(starts, r.end - 1);
    const text = code.slice(r.pos, r.end);
    const last = tsComments.at(-1);
    // una racha de `//` en líneas consecutivas es un solo bloque
    if (r.kind === ts.SyntaxKind.SingleLineCommentTrivia && last && last.text.startsWith('//') && last.endLine === startLine - 1) {
      last.endLine = endLine;
      last.text += `\n${text}`;
    } else tsComments.push({ startLine, endLine, text });
  }
  return { file, glslFunctions, tsDeclarations, tsComments, glslComments };
}

/** Los `.ts` de `src` que no son pruebas (`*.test.ts`), con su ruta desde la raíz. */
export function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir).sort()) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.ts') && !f.endsWith('.test.ts')) out.push(relative(root, p).split('\\').join('/'));
    }
  };
  walk(join(root, 'src'));
  return out;
}

/** Lee y analiza todos los módulos de `src` (sin pruebas). */
export function scanTree(root: string): ScannedSource[] {
  return sourceFiles(root).map((file) => scanSource(file, readFileSync(join(root, file), 'utf8')));
}

/** Identificadores `@twin` de un texto, en orden. */
export const markersIn = (text: string): string[] => [...text.matchAll(TWIN_MARKER)].map((m) => m[1]);
