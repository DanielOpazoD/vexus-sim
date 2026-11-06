import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { findGlslTemplates } from '../build/glslMinify';

/**
 * Lectura estática de los gemelos (decisión 322, punto 5): funciones GLSL, declaraciones TS, comentarios y marcadores
 * `@twin <id>` de los módulos de `src`. Solo lee texto: no importa los módulos ni ejecuta GLSL. Lo usan
 * `tools/twins/check.ts`, `tools/twins/constants.ts`, `tools/twins/inventory.ts` y `src/validation/twinRegistry.test.ts`.
 *
 * El GLSL se lee de las plantillas `/* glsl *\/` y también de las cadenas y plantillas sin etiqueta que contienen una
 * definición de función GLSL (la especialización por persona escribe así sus sustituciones, `personShader.ts` y
 * `s0028Wall.glsl.ts`); las interpolaciones `${…}` son texto opaco.
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

export interface GlslFunction extends Located {
  /** Cuerpo entre llaves (posiciones en el archivo, sin las llaves). */
  bodyStart: number;
  bodyEnd: number;
  /** En una plantilla `/* glsl *\/` (si no, en una cadena o plantilla sin etiqueta). */
  tagged: boolean;
}

export interface TsDeclaration extends Located {
  exported: boolean;
  /** Método o propiedad de una clase (p. ej. `AnatomyScene.classify`). */
  member: boolean;
  /** Función: declaración `function`, constante con una función flecha o expresión de función, o método. */
  fn: boolean;
  /** Comentarios inmediatamente anteriores a la declaración (JSDoc o `//`), unidos. */
  leading: string;
}

export interface CommentBlock {
  startLine: number;
  endLine: number;
  text: string;
  /** Comentario GLSL: la función GLSL que sigue en la misma plantilla o cadena. */
  nextGlslFunction?: string;
}

export interface ScannedSource {
  /** Ruta desde la raíz del repositorio, con `/`. */
  file: string;
  glslFunctions: GlslFunction[];
  tsDeclarations: TsDeclaration[];
  /** Comentarios TS, agrupados: un JSDoc o bloque `/* *\/`, o una racha de `//` en líneas seguidas. */
  tsComments: CommentBlock[];
  /** Comentarios GLSL (dentro de las plantillas y cadenas con GLSL), uno por comentario. */
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

/** Igual, sin estado: solo dice si un texto define alguna función GLSL. */
const HAS_GLSL_FUNCTION = new RegExp(GLSL_FUNCTION.source);

/** Fin del cuerpo que abre la llave en `open` (posición tras la llave de cierre). */
function bodyEnd(text: string, open: number): number {
  let depth = 1,
    i = open + 1;
  for (; i < text.length && depth > 0; i++) depth += text[i] === '{' ? 1 : text[i] === '}' ? -1 : 0;
  return i;
}

/** Lee un módulo: funciones GLSL, declaraciones TS, comentarios TS y comentarios GLSL. */
export function scanSource(file: string, code: string): ScannedSource {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  const glslFunctions: GlslFunction[] = [];
  const glslComments: CommentBlock[] = [];
  /** Un trozo de GLSL del archivo: [inicio, fin) con las interpolaciones ya en blanco. */
  const readGlsl = (start: number, raw: string, tagged: boolean): void => {
    const { code: bare, comments } = blankGlslComments(raw);
    const defs: GlslFunction[] = [];
    for (const m of bare.matchAll(GLSL_FUNCTION)) {
      const offset = start + m.index + m[1].length + m[2].length;
      const open = m.index + m[0].length - 1;
      // un nombre pegado a una interpolación (`s28_${name}`) lo forma JS al ejecutar: no es un nombre fijo
      const nameEnd = start + m.index + m[0].search(new RegExp(`${m[3]}\\s*\\(`)) + m[3].length;
      if (code.startsWith('${', nameEnd)) continue;
      defs.push({
        name: m[3],
        line: lineAt(starts, offset),
        bodyStart: start + open + 1,
        bodyEnd: start + bodyEnd(bare, open) - 1,
        tagged,
      });
    }
    glslFunctions.push(...defs);
    for (const c of comments) {
      const offset = start + c.start;
      glslComments.push({
        startLine: lineAt(starts, offset),
        endLine: lineAt(starts, start + c.end),
        text: raw.slice(c.start, c.end),
        nextGlslFunction: defs.find((d) => d.bodyStart > offset)?.name,
      });
    }
  };
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  // plantillas y cadenas: el texto estático con las interpolaciones `${…}` en blanco por posiciones del AST (texto opaco:
  // no definen funciones con nombre fijo). Las `/* glsl */` se leen siempre; las demás, si definen una función GLSL.
  const taggedStarts = new Set(findGlslTemplates(code).map((t) => t.start));
  const literalText = (node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression, open: number): string => {
    const raw = code.slice(open + 1, node.end - 1);
    if (!ts.isTemplateExpression(node)) return raw;
    const chars = raw.split('');
    let from = node.head.end - 2;
    for (const span of node.templateSpans) {
      const to = span.literal.getStart(source) + 1;
      for (let i = from; i < to; i++) if (chars[i - open - 1] !== '\n') chars[i - open - 1] = ' ';
      from = span.literal.end - 2;
    }
    return chars.join('');
  };
  const strings = (node: ts.Node): void => {
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node) || ts.isTemplateExpression(node)) {
      const open = node.getStart(source);
      const isTagged = taggedStarts.has(open + 1);
      const raw = literalText(node, open);
      if (isTagged || HAS_GLSL_FUNCTION.test(raw)) readGlsl(open + 1, raw, isTagged);
    }
    node.forEachChild(strings);
  };
  strings(source);
  glslFunctions.sort((a, b) => a.bodyStart - b.bodyStart);
  glslComments.sort((a, b) => a.startLine - b.startLine);

  const tsDeclarations: TsDeclaration[] = [];
  const exportedTop = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  // el comentario inmediatamente anterior: el último bloque, o la racha de `//` en líneas seguidas que acaba en él
  const leadingOf = (node: ts.Node): string => {
    const ranges = ts.getLeadingCommentRanges(code, node.pos) ?? [];
    let first = ranges.length - 1;
    if (first < 0) return '';
    if (ranges[first].kind === ts.SyntaxKind.SingleLineCommentTrivia)
      while (
        first > 0 &&
        ranges[first - 1].kind === ts.SyntaxKind.SingleLineCommentTrivia &&
        lineAt(starts, ranges[first - 1].pos) === lineAt(starts, ranges[first].pos) - 1
      )
        first--;
    return ranges
      .slice(first)
      .map((r) => code.slice(r.pos, r.end))
      .join('\n');
  };
  const add = (name: ts.Node | undefined, exported: boolean, member: boolean, fn: boolean, leading: string): void => {
    if (name && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)))
      tsDeclarations.push({ name: name.text, line: lineAt(starts, name.getStart(source)), exported, member, fn, leading });
  };
  // Factories expose the named closures returned in their query object.
  // Only those declarations are public CPU sides; callbacks and local helpers are not exported APIs.
  const declarations: ts.Statement[] = [...source.statements];
  for (const factory of source.statements) {
    if (!ts.isFunctionDeclaration(factory) || !exportedTop(factory) || !factory.body) continue;
    const last = factory.body.statements.at(-1);
    if (!last || !ts.isReturnStatement(last) || !last.expression) continue;
    const expression = last.expression;
    const object =
      ts.isCallExpression(expression) && expression.expression.getText(source) === 'Object.freeze' ? expression.arguments[0] : expression;
    if (!object || !ts.isObjectLiteralExpression(object)) continue;
    const returned = new Set(object.properties.flatMap((p) => (ts.isShorthandPropertyAssignment(p) ? [p.name.text] : [])));
    for (const declaration of factory.body.statements) {
      if (ts.isFunctionDeclaration(declaration) && declaration.name && returned.has(declaration.name.text)) declarations.push(declaration);
      if (
        ts.isVariableStatement(declaration) &&
        declaration.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && returned.has(d.name.text))
      )
        declarations.push(declaration);
    }
  }
  for (const stmt of declarations) {
    const leading = leadingOf(stmt);
    if (ts.isFunctionDeclaration(stmt)) add(stmt.name, exportedTop(stmt), false, true, leading);
    else if (ts.isVariableStatement(stmt))
      for (const d of stmt.declarationList.declarations)
        add(
          d.name,
          exportedTop(stmt),
          false,
          !!d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)),
          leading,
        );
    else if (ts.isClassDeclaration(stmt)) {
      add(stmt.name, exportedTop(stmt), false, false, leading);
      for (const m of stmt.members)
        if (ts.isMethodDeclaration(m) || ts.isPropertyDeclaration(m) || ts.isGetAccessorDeclaration(m))
          add(m.name, false, true, !ts.isPropertyDeclaration(m), leadingOf(m));
    } else if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt))
      add(stmt.name, exportedTop(stmt), false, false, leading);
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
