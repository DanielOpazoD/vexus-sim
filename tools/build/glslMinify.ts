import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type * as TS from 'typescript';
import type { Plugin } from 'vite';
import { buildMangleMap, mangleGlslParts, type GlslAnalysis, type MangleMap } from './glslMangle';

/**
 * Minificado del GLSL en el build: el texto de los shaders viaja en el chunk principal dentro de las plantillas
 * `/* glsl *\/ \`…\``, con sus comentarios, su sangría y sus nombres largos (el presupuesto lo cuenta entero). En el
 * build, en dos etapas:
 *
 * 1. Comentarios y sangría: se quitan los comentarios (`//` y `/* *\/`; uno de bloque entre dos tokens deja un espacio)
 *    y la sangría de esas plantillas; se conservan los saltos de línea (las directivas `#define` y `#if` los necesitan y
 *    así el mapa de fuentes sigue siendo línea a línea) y las interpolaciones `${…}` (salvo las que caen dentro de un
 *    comentario, que desaparecen con él).
 * 2. Nombres (`glslMangle.ts`): los identificadores DECLARADOS en el texto de las plantillas (funciones, sobrecargas
 *    incluidas, parámetros, variables locales y globales, `const`, `#define`, structs y sus campos) pasan a nombres de
 *    1–2 caracteres (3 si hiciera falta) con UN mapa para todo el bundle: los programas se montan al ejecutar
 *    concatenando plantillas de muchos módulos. El mapa sale de leer todos los `src/**\/*.ts` (salvo las pruebas) al
 *    empezar el build: es determinista (solo depende del fuente), y un módulo con plantillas que no sea el que se leyó
 *    (cambió, está fuera de `src/`, es un `.js`) hace fallar el build en vez de dejar un shader a medias.
 *    Nunca se renombran: los uniforms (el renderer los busca por nombre), las entradas y salidas (`in`/`out`, atributos,
 *    bloques de interfaz; cualquier nombre de una sentencia global `uniform`/`in`/`out`, aunque su tipo no se entienda),
 *    los campos de un struct que sea el tipo de un uniform (también anidados), `main`, las palabras clave, los tipos y
 *    lo integrado de GLSL, los nombres con forma reservada (`gl_`, `GL_`, `webgl_`, `__` y, como red de seguridad,
 *    `u[A-Z]…`, la convención de los uniforms), los campos con forma de swizzle (`.s`, `.xy`) ni nada que el texto de un
 *    shader pueda recibir de JS al ejecutar:
 *    - cualquier identificador que aparezca en una cadena, una plantilla sin etiqueta o una expresión regular de
 *      cualquier módulo de `src/` (los `#define` de `TISSUE_DEFINES`, los uniforms de la escena, el `NOTCH` de
 *      `kidney.ts`: los genera JS);
 *    - en los módulos que generan o montan GLSL (los que tienen plantillas, lo que importan y los que los importan),
 *      lo que pueda formar un fragmento pegado a una interpolación o a una concatenación (`uLook${i}` reserva todo lo
 *      que empiece por `uLook`); en las plantillas, un nombre pegado a una interpolación o a un extremo de la plantilla
 *      (que se interpola junto a otro texto) tampoco se toca.
 *    Un nombre que solo aparece en el código JS (el gemelo TS de una función GLSL, una constante con el mismo nombre)
 *    sí se renombra: un identificador de JS no es texto; llega a un shader solo si una cadena lo escribe (reservado),
 *    si sale de una plantilla (renombrada con el mismo mapa) o por reflexión (`Object.keys`, `.name`…), que ningún
 *    módulo de shaders usa para escribir GLSL (`TISSUE_DEFINES` recorre claves numéricas y valores que son cadenas).
 *    Las reglas estáticas no ven un nombre que JS forme por reflexión, a través de constantes (`organ + SUFIJO`) o en
 *    módulos ajenos a los de GLSL: esa es la garantía de `glslMangle.test.ts`, que monta los programas reales con el
 *    fuente transformado y comprueba que cada uno es el original renombrado con el mapa (mismo texto salvo los
 *    nombres, sin colisiones y con los mismos uniforms y entradas/salidas); un nombre así la hace fallar.
 *    Para depurar un shader del build con sus nombres: `glslMinify({ mangle: false })` en `vite.config.ts`. Con
 *    `vite build --watch` solo se aplica la primera etapa (la caché de transformaciones mezclaría mapas).
 *
 * Las pruebas (vitest) y el servidor de desarrollo ven el fuente tal cual; la e2e prueba los shaders minificados.
 */

let ts: typeof TS | undefined;
/** TypeScript solo se carga al usarse (build y pruebas del minificado), no al arrancar vite ni vitest. */
const typescript = (): typeof TS => (ts ??= createRequire(import.meta.url)('typescript') as typeof TS);

/** Una plantilla `/* glsl *\/`: trozos estáticos y expresiones alternados (`statics.length === exprs.length + 1`). */
export interface GlslTemplate {
  /** Índice tras el acento grave de apertura y el del acento grave de cierre. */
  start: number;
  end: number;
  statics: string[];
  exprs: string[];
}

/** Lo que un módulo aporta al renombrado. */
export interface ScannedModule {
  /** Plantillas `/* glsl *\/` (una anidada en la interpolación de otra no se transforma: cuenta como cadena). */
  templates: GlslTemplate[];
  /** Identificadores que aparecen en cadenas, plantillas sin etiqueta y expresiones regulares. */
  stringNames: Set<string>;
  /** Fragmentos pegados a una interpolación o a una concatenación: pueden empezar / acabar un nombre formado al ejecutar. */
  prefixes: Set<string>;
  suffixes: Set<string>;
  /** Identificadores del código JS. */
  identifiers: Set<string>;
  /** Especificadores de los módulos importados. */
  imports: string[];
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;
const LEADING_RUN = /^[A-Za-z0-9_]+/;
const TRAILING_RUN = /[A-Za-z0-9_]+$/;

/** El último comentario de la trivia que precede a un literal es la etiqueta `/* glsl *\/`. */
function glslTagged(trivia: string): boolean {
  let last = '';
  for (let i = 0; i < trivia.length;) {
    if (trivia.startsWith('//', i)) {
      const e = trivia.indexOf('\n', i);
      last = '//';
      i = e < 0 ? trivia.length : e;
    } else if (trivia.startsWith('/*', i)) {
      const e = trivia.indexOf('*/', i + 2);
      const end = e < 0 ? trivia.length : e + 2;
      last = trivia.slice(i, end);
      i = end;
    } else i++;
  }
  return /^\/\*\s*glsl\s*\*\/$/.test(last);
}

/** Trozos y expresiones de una plantilla tal como están en el fuente (sin normalizar saltos ni escapes). */
function templateOf(
  t: typeof TS,
  node: TS.NoSubstitutionTemplateLiteral | TS.TemplateExpression,
  code: string,
  sf: TS.SourceFile,
): GlslTemplate {
  const start = node.getStart(sf) + 1;
  const end = node.end - 1;
  if (t.isNoSubstitutionTemplateLiteral(node)) return { start, end, statics: [code.slice(start, end)], exprs: [] };
  const statics = [code.slice(start, node.head.end - 2)];
  const exprs: string[] = [];
  let prev = node.head.end;
  node.templateSpans.forEach((span, i) => {
    const close = span.literal.getStart(sf); // la `}` que cierra la expresión
    exprs.push(code.slice(prev, close));
    statics.push(code.slice(close + 1, span.literal.end - (i === node.templateSpans.length - 1 ? 1 : 2)));
    prev = span.literal.end;
  });
  return { start, end, statics, exprs };
}

/** Recorre un módulo TS: sus plantillas GLSL, sus cadenas, sus identificadores y sus importaciones. */
export function scanModule(code: string, fileName = 'module.ts'): ScannedModule {
  const t = typescript();
  const sf = t.createSourceFile(fileName, code, t.ScriptTarget.Latest, true, t.ScriptKind.TS);
  const out: ScannedModule = {
    templates: [],
    stringNames: new Set(),
    prefixes: new Set(),
    suffixes: new Set(),
    identifiers: new Set(),
    imports: [],
  };
  const unwrap = (e: TS.Node): TS.Node => (t.isParenthesizedExpression(e) ? unwrap(e.expression) : e);
  const isPlus = (n: TS.Node | undefined): n is TS.BinaryExpression =>
    !!n && t.isBinaryExpression(n) && n.operatorToken.kind === t.SyntaxKind.PlusToken;
  const leaves = (n: TS.Node, acc: TS.Node[] = []): TS.Node[] => {
    const e = unwrap(n);
    if (isPlus(e)) {
      leaves(e.left, acc);
      leaves(e.right, acc);
    } else acc.push(e);
    return acc;
  };
  /** Carácter del extremo de un operando de una concatenación; null si no se conoce (una expresión, una interpolación). */
  const edge = (n: TS.Node, side: 'first' | 'last'): string | null => {
    const e = unwrap(n);
    let s: string | undefined;
    if (t.isStringLiteral(e) || t.isNoSubstitutionTemplateLiteral(e) || t.isNumericLiteral(e)) s = e.text;
    else if (t.isTemplateExpression(e)) s = side === 'first' ? e.head.text : e.templateSpans[e.templateSpans.length - 1].literal.text;
    if (!s) return null;
    return side === 'first' ? s[0] : s[s.length - 1];
  };
  const glues = (n: TS.Node | undefined, side: 'first' | 'last'): boolean => {
    if (n === undefined) return false;
    const c = edge(n, side);
    return c === null || /[A-Za-z0-9_]/.test(c);
  };
  /**
   * ¿Se le puede pegar algo a los extremos de este literal? Sí si en su concatenación (`a + 'x' + b`, también
   * `s += 'x'`) el operando vecino es desconocido o su extremo es un carácter de identificador.
   */
  const openEnds = (node: TS.Node): { start: boolean; end: boolean } => {
    let root: TS.Node = node;
    while (isPlus(root.parent) || (t.isParenthesizedExpression(root.parent) && isPlus(root.parent.parent))) root = root.parent;
    const appended =
      t.isBinaryExpression(root.parent) && root.parent.operatorToken.kind === t.SyntaxKind.PlusEqualsToken && root.parent.right === root;
    const ops = leaves(root);
    const i = ops.indexOf(node);
    if (i < 0) return { start: appended, end: appended };
    return {
      start: (i === 0 && appended) || glues(ops[i - 1], 'last'),
      end: (i === ops.length - 1 && appended) || glues(ops[i + 1], 'first'),
    };
  };
  /** Una cadena JS: sus identificadores se reservan, y el fragmento de un extremo abierto también. */
  const addString = (text: string, openStart: boolean, openEnd: boolean): void => {
    for (const m of text.matchAll(IDENT)) out.stringNames.add(m[0]);
    // lo pegado detrás puede acabar un nombre (`${a}Mm`, también `${a}1`); lo de delante solo lo empieza si no empieza
    // por dígito (`0x${n}` forma un número, no un nombre)
    const head = openStart ? LEADING_RUN.exec(text) : null;
    if (head) out.suffixes.add(head[0]);
    const tail = openEnd ? TRAILING_RUN.exec(text) : null;
    if (tail && !/^[0-9]/.test(tail[0])) out.prefixes.add(tail[0]);
  };
  const visit = (node: TS.Node, insideGlsl: boolean): void => {
    if (t.isIdentifier(node)) out.identifiers.add(node.text);
    else if (t.isPrivateIdentifier(node)) out.identifiers.add(node.text.slice(1));
    else if (t.isStringLiteral(node)) {
      const open = openEnds(node);
      addString(node.text, open.start, open.end);
    } else if (t.isRegularExpressionLiteral(node)) addString(node.text, false, false);
    else if (
      (t.isImportDeclaration(node) || t.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      t.isStringLiteral(node.moduleSpecifier)
    ) {
      out.imports.push(node.moduleSpecifier.text);
    } else if (
      t.isCallExpression(node) &&
      node.expression.kind === t.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      t.isStringLiteral(node.arguments[0])
    ) {
      out.imports.push(node.arguments[0].text);
    } else if (t.isNoSubstitutionTemplateLiteral(node) || t.isTemplateExpression(node)) {
      if (!insideGlsl && glslTagged(code.slice(node.pos, node.getStart(sf)))) {
        out.templates.push(templateOf(t, node, code, sf));
        t.forEachChild(node, (c) => visit(c, true));
        return;
      }
      // plantilla sin etiqueta (o GLSL anidada en una interpolación): una cadena más; entre dos trozos, una interpolación
      const cooked = t.isNoSubstitutionTemplateLiteral(node)
        ? [node.text]
        : [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
      const ends = openEnds(node);
      cooked.forEach((text, i) => addString(text, i > 0 || ends.start, i < cooked.length - 1 || ends.end));
    }
    t.forEachChild(node, (c) => visit(c, insideGlsl));
  };
  visit(sf, false);
  return out;
}

/** Las plantillas `/* glsl *\/` de un módulo, en orden. */
export function findGlslTemplates(code: string): GlslTemplate[] {
  return /\/\*\s*glsl\s*\*\//.test(code) ? scanModule(code).templates : [];
}

/**
 * Sin comentarios: los trozos estáticos que quedan (unidos cuando la interpolación que los separaba caía dentro de un
 * comentario) y las expresiones que sobreviven entre ellos.
 */
export function stripGlslComments(statics: readonly string[], exprs: readonly string[]): { parts: string[]; exprs: string[] } {
  const parts: string[] = [];
  const kept: string[] = [];
  let buf = '';
  let lineComment = false;
  let blockComment = false;
  /** Lo que precede a un comentario de bloque y si este tiene saltos de línea (para no pegar dos tokens). */
  let before: string | undefined;
  let multiline = false;
  const idLike = (c: string | undefined): boolean => c === undefined || /[A-Za-z0-9_]/.test(c);
  for (let p = 0; p < statics.length; p++) {
    const s = statics[p];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (lineComment) {
        if (c === '\n') {
          lineComment = false;
          buf += '\n';
        }
        continue;
      }
      if (blockComment) {
        if (c === '\n') {
          buf += '\n';
          multiline = true;
        } else if (c === '*' && s[i + 1] === '/') {
          blockComment = false;
          i++;
          // en GLSL un comentario separa como un espacio: `a/* x */b` es `a b` (junto a una interpolación, por si acaso)
          if (!multiline && idLike(before) && idLike(s[i + 1])) buf += ' ';
        }
        continue;
      }
      if (c === '/' && s[i + 1] === '/') {
        lineComment = true;
        i++;
        continue;
      }
      if (c === '/' && s[i + 1] === '*') {
        blockComment = true;
        multiline = false;
        before = buf.length > 0 ? buf[buf.length - 1] : undefined;
        i++;
        continue;
      }
      buf += c;
    }
    // una interpolación dentro de un comentario desaparece con él
    if (p < exprs.length && !lineComment && !blockComment) {
      parts.push(buf);
      kept.push(exprs[p]);
      buf = '';
    }
  }
  parts.push(buf);
  return { parts, exprs: kept };
}

/**
 * Minifica el cuerpo de una plantilla GLSL: quita comentarios y sangría (los saltos de línea se quedan) y, con un
 * mapa, renombra. Devuelve el texto que va entre los acentos graves, con las interpolaciones que sobreviven.
 */
export function minifyGlslBody(statics: readonly string[], exprs: readonly string[], mangle?: MangleMap): string {
  const stripped = stripGlslComments(statics, exprs);
  const parts = mangle ? mangleGlslParts(stripped.parts, mangle) : stripped.parts;
  let out = parts[0];
  for (let i = 0; i < stripped.exprs.length; i++) out += '${' + stripped.exprs[i] + '}' + parts[i + 1];
  // sangría y espacios al final de cada línea
  return out
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
}

function applyTemplates(code: string, templates: readonly GlslTemplate[], mangle?: MangleMap): string {
  let out = '';
  let last = 0;
  for (const t of templates) {
    out += code.slice(last, t.start) + minifyGlslBody(t.statics, t.exprs, mangle);
    last = t.end;
  }
  return out + code.slice(last);
}

/** Minifica (y, con un mapa, renombra) todas las plantillas `/* glsl *\/` de un módulo; el número de líneas no cambia. */
export function minifyGlslTemplates(code: string, mangle?: MangleMap): string {
  const templates = findGlslTemplates(code);
  return templates.length === 0 ? code : applyTemplates(code, templates, mangle);
}

/** Un módulo fuente: ruta y contenido. */
export interface SourceModule {
  path: string;
  code: string;
}

const normalizePath = (p: string): string => resolve(p).replace(/\\/g, '/');

/** Los `.ts` de un directorio (recursivo, sin `*.test.ts`), ordenados por ruta. */
export function readSources(dir: string): SourceModule[] {
  const out: SourceModule[] = [];
  const walk = (d: string): void => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) out.push({ path: normalizePath(p), code: readFileSync(p, 'utf8') });
    }
  };
  walk(dir);
  return out;
}

/** El renombrado de un bundle: el mapa y los módulos con que se calculó. */
export interface GlslMangleContext {
  map: MangleMap;
  analysis: GlslAnalysis;
  /** ruta normalizada → contenido y plantillas del módulo leído */
  modules: ReadonlyMap<string, { code: string; templates: GlslTemplate[] }>;
  /** Módulos que generan o montan GLSL: los que tienen plantillas, lo que importan (transitivo) y los que los importan. */
  related: ReadonlySet<string>;
}

/**
 * El mapa de renombrado de un conjunto de módulos (todo `src/` en el build). Reserva los identificadores de las cadenas
 * de TODOS los módulos y los fragmentos pegados de los módulos que generan o montan GLSL; los nombres cortos evitan
 * además cualquier identificador JS de esos módulos (nada que JS pudiera escribir en un shader choca con ellos).
 */
export function prepareGlslMangle(sources: readonly SourceModule[]): GlslMangleContext {
  const scanned = new Map<string, { code: string; scan: ScannedModule }>();
  for (const m of [...sources].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    scanned.set(normalizePath(m.path), { code: m.code, scan: scanModule(m.code, m.path) });
  }
  const resolveImport = (from: string, spec: string): string | undefined => {
    if (!spec.startsWith('.')) return undefined;
    const base = normalizePath(join(dirname(from), spec));
    return [base, `${base}.ts`, `${base}/index.ts`, base.replace(/\.js$/, '.ts')].find((c) => scanned.has(c));
  };
  const withGlsl = new Set([...scanned].filter(([, m]) => m.scan.templates.length > 0).map(([p]) => p));
  const related = new Set<string>();
  const stack = [...withGlsl];
  while (stack.length > 0) {
    const p = stack.pop() as string;
    if (related.has(p)) continue;
    related.add(p);
    for (const spec of scanned.get(p)?.scan.imports ?? []) {
      const dep = resolveImport(p, spec);
      if (dep) stack.push(dep);
    }
  }
  for (const [p, m] of scanned) {
    if (m.scan.imports.some((spec) => withGlsl.has(resolveImport(p, spec) ?? ''))) related.add(p);
  }
  const reserved = new Set<string>();
  const prefixes = new Set<string>();
  const suffixes = new Set<string>();
  const taken = new Set<string>();
  const templates: string[][] = [];
  for (const [path, { scan }] of scanned) {
    for (const n of scan.stringNames) reserved.add(n);
    if (related.has(path)) {
      for (const f of scan.prefixes) prefixes.add(f);
      for (const f of scan.suffixes) suffixes.add(f);
      for (const n of scan.identifiers) taken.add(n);
    }
    for (const tpl of scan.templates) templates.push(stripGlslComments(tpl.statics, tpl.exprs).parts);
  }
  const { names, afterDot, analysis } = buildMangleMap(templates, {
    reserved,
    reservedPrefixes: prefixes,
    reservedSuffixes: suffixes,
    taken,
  });
  const modules = new Map([...scanned].map(([p, m]) => [p, { code: m.code, templates: m.scan.templates }]));
  return { map: { names, afterDot }, analysis, modules, related };
}

/**
 * Minifica y renombra las plantillas de un módulo con el mapa del bundle. Un módulo con plantillas GLSL que no se
 * leyó al preparar el mapa, o que cambió desde entonces, dejaría shaders inconsistentes: se lanza.
 */
export function transformWithMangle(code: string, id: string, ctx: GlslMangleContext): string {
  const path = normalizePath(id.split('?')[0]);
  const known = ctx.modules.get(path);
  if (known && known.code === code) return known.templates.length === 0 ? code : applyTemplates(code, known.templates, ctx.map);
  if (findGlslTemplates(code).length > 0) {
    throw new Error(`glslMinify: ${path} tiene plantillas GLSL y no es el módulo con que se calculó el renombrado`);
  }
  return code;
}

/** Mapa de fuentes línea a línea (cada línea del código transformado viene de la misma línea del fuente). */
function lineMap(code: string, id: string): { version: number; sources: string[]; names: string[]; mappings: string } {
  const lines = code.split('\n').length;
  return { version: 3, sources: [id], names: [], mappings: ['AAAA', ...Array.from({ length: lines - 1 }, () => 'AACA')].join(';') };
}

/**
 * Plugin de Vite: solo en el build y solo en los módulos de `src/` con plantillas GLSL. `mangle: false` deja solo la
 * primera etapa (comentarios y sangría).
 */
export function glslMinify(options: { mangle?: boolean } = {}): Plugin {
  const mangle = options.mangle ?? true;
  let root = process.cwd();
  let ctx: GlslMangleContext | null = null;
  return {
    name: 'glsl-minify',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      // con `vite build --watch`, la caché de transformaciones juntaría módulos renombrados con mapas de compilaciones
      // distintas: ahí solo la primera etapa
      ctx = mangle && !this.meta.watchMode ? prepareGlslMangle(readSources(join(root, 'src'))) : null;
    },
    transform(code, id) {
      if (!code.includes('glsl')) return null;
      const file = id.split('?')[0];
      // ni las dependencias (three.js trae sus propias plantillas `/* glsl */`) ni los módulos virtuales
      if (id.startsWith('\0') || /[\\/]node_modules[\\/]/.test(file) || !/\.[cm]?[jt]sx?$/.test(file)) return null;
      let out: string;
      // con el renombrado, un módulo del proyecto con plantillas que no se analizó (fuera de `src/`, un `.js`) hace fallar
      // el build: sus shaders no casarían con los demás
      if (ctx) out = transformWithMangle(code, id, ctx);
      else if (/[\\/]src[\\/].*\.ts$/.test(file)) out = minifyGlslTemplates(code);
      else return null;
      if (out === code) return null;
      return { code: out, map: lineMap(out, id) };
    },
  };
}
