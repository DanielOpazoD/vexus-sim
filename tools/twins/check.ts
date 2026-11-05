import ts from 'typescript';
import type { TwinPair, TwinSide } from './registry';
import { markersIn, TWIN_WORD, type ScannedSource } from './scan';

/**
 * Comprobaciones del registro de gemelos (decisión 322, punto 5), como funciones puras sobre la lectura de `src`: así
 * `src/validation/twinRegistry.test.ts` las aplica al árbol real y a árboles mutados (que deben fallar). Cada una
 * devuelve la lista de problemas; vacía si se cumple.
 */

export interface Tree {
  /** Lectura de cada módulo de `src` (sin pruebas), por ruta desde la raíz. */
  byFile: ReadonlyMap<string, ScannedSource>;
  /** Texto de un archivo del repositorio (para las llamadas del Worker y las pruebas). */
  read: (file: string) => string;
}

const sides = (t: TwinPair): Array<['cpu' | 'gpu', TwinSide]> => [
  ...t.cpu.map((s): ['cpu', TwinSide] => ['cpu', s]),
  ...t.gpu.map((s): ['gpu', TwinSide] => ['gpu', s]),
];

/**
 * (b) Cada lado apunta a un archivo que existe y a símbolos de su lenguaje: el lado CPU, a declaraciones TS; el GPU, a
 * funciones GLSL de ese archivo y a sus plantillas como declaraciones TS; el Worker, a funciones que llama.
 */
export function missingSymbols(twins: readonly TwinPair[], tree: Tree): string[] {
  const out: string[] = [];
  for (const t of twins)
    for (const [label, side] of sides(t)) {
      const scan = tree.byFile.get(side.file);
      if (!scan) {
        out.push(`${t.id}: ${side.file} no existe (o es una prueba)`);
        continue;
      }
      const declares = (n: string): boolean => scan.tsDeclarations.some((d) => d.name === n);
      if (label === 'cpu') {
        for (const n of side.symbols) if (!declares(n)) out.push(`${t.id}: el lado CPU (${side.file}) no declara ${n} en TS`);
        if (side.templates?.length) out.push(`${t.id}: el lado CPU (${side.file}) no lleva plantillas`);
      } else if (t.kind === 'cpu-worker') {
        // el Worker instala con las mismas funciones que la página: basta con que las llame
        for (const n of side.symbols)
          if (!new RegExp(`\\b${n}\\s*\\(`).test(tree.read(side.file))) out.push(`${t.id}: el Worker (${side.file}) no llama a ${n}`);
      } else {
        for (const n of side.symbols)
          if (!scan.glslFunctions.some((f) => f.name === n)) out.push(`${t.id}: el lado GPU (${side.file}) no define la función GLSL ${n}`);
        for (const n of side.templates ?? [])
          if (!declares(n)) out.push(`${t.id}: el lado GPU (${side.file}) no declara la plantilla ${n}`);
        if (side.symbols.length + (side.templates?.length ?? 0) === 0) out.push(`${t.id}: lado GPU vacío en ${side.file}`);
      }
    }
  return out;
}

/** (a) Marcadores `@twin` que no nombran un par registrado, en los comentarios de `src` y en los textos dados. */
export function unknownMarkers(twins: readonly TwinPair[], tree: Tree, texts: ReadonlyMap<string, string>): string[] {
  const ids = new Set(twins.map((t) => t.id));
  const out: string[] = [];
  for (const s of tree.byFile.values())
    for (const c of s.tsComments) for (const id of markersIn(c.text)) if (!ids.has(id)) out.push(`${s.file}:${c.startLine} @twin ${id}`);
  for (const [file, text] of texts) for (const id of markersIn(text)) if (!ids.has(id)) out.push(`${file} @twin ${id}`);
  return out;
}

/**
 * (a) Cada lado fuera de los archivos pendientes lleva `@twin <id>` en el comentario inmediatamente anterior a la
 * declaración de uno de sus símbolos: una declaración TS del lado CPU o una plantilla del lado GPU. El lado Worker
 * llama a funciones que declara otro módulo: basta con el marcador en su archivo.
 */
export function unmarkedSides(twins: readonly TwinPair[], tree: Tree, pending: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  for (const t of twins)
    for (const [label, side] of sides(t)) {
      const scan = tree.byFile.get(side.file);
      if (!scan || side.file in pending) continue;
      if (label === 'gpu' && t.kind === 'cpu-worker') {
        if (!scan.tsComments.some((c) => markersIn(c.text).includes(t.id))) out.push(`${t.id}: falta @twin ${t.id} en ${side.file}`);
        continue;
      }
      const names = label === 'cpu' ? side.symbols : (side.templates ?? []);
      const marked = names.some((n) => scan.tsDeclarations.some((d) => d.name === n && markersIn(d.leading).includes(t.id)));
      if (!marked)
        out.push(
          `${t.id}: falta @twin ${t.id} en el comentario de ${label === 'cpu' ? 'una función' : 'una plantilla'} (${names.join(', ') || '—'}) de ${side.file}`,
        );
    }
  return out;
}

/**
 * (a) La palabra «gemelo» en un comentario TS de `src` va con su `@twin`; en el texto GLSL, solo delante de una función
 * registrada en el lado GPU de ese archivo. Los archivos pendientes quedan fuera.
 */
export function looseTwinWords(twins: readonly TwinPair[], tree: Tree, pending: Readonly<Record<string, string>>): string[] {
  const glsl = new Map<string, Set<string>>();
  for (const t of twins)
    for (const side of t.gpu) for (const n of side.symbols) (glsl.get(side.file) ?? glsl.set(side.file, new Set()).get(side.file)!).add(n);
  const out: string[] = [];
  for (const s of tree.byFile.values()) {
    if (s.file in pending) continue;
    for (const c of s.tsComments)
      if (TWIN_WORD.test(c.text) && markersIn(c.text).length === 0) out.push(`${s.file}:${c.startLine} (comentario TS sin @twin)`);
    for (const c of s.glslComments)
      if (TWIN_WORD.test(c.text) && !(c.nextGlslFunction && glsl.get(s.file)?.has(c.nextGlslFunction)))
        out.push(`${s.file}:${c.startLine} (GLSL: «${c.nextGlslFunction ?? '—'}» no está en ningún par)`);
  }
  return out;
}

/**
 * (d) Toda función GLSL (de una plantilla o de una cadena con GLSL) con el nombre de una función TS de `src`,
 * exportada o no, o de un método, está en el lado GPU de algún par con su archivo (gemelo por nombre, decisión 46).
 */
export function orphanHomonyms(twins: readonly TwinPair[], tree: Tree, notTwins: Readonly<Record<string, string>>): string[] {
  const tsNames = new Set([...tree.byFile.values()].flatMap((s) => s.tsDeclarations.filter((d) => d.fn || d.member).map((d) => d.name)));
  const covered = new Set(twins.flatMap((t) => t.gpu.flatMap((side) => side.symbols.map((n) => `${side.file}#${n}`))));
  const out = new Set<string>();
  for (const s of tree.byFile.values())
    for (const f of s.glslFunctions)
      if (f.name !== 'main' && tsNames.has(f.name) && !covered.has(`${s.file}#${f.name}`) && !(f.name in notTwins))
        out.add(`${s.file}:${f.line} ${f.name}`);
  return [...out];
}

/** Cadena de nombres de una llamada: `test.describe.skip(…)` → `['test', 'describe', 'skip']`. */
function calleeChain(e: ts.Expression): string[] {
  if (ts.isIdentifier(e)) return [e.text];
  if (ts.isPropertyAccessExpression(e)) return [...calleeChain(e.expression), e.name.text];
  return [];
}
const MODIFIERS = new Set(['skip', 'fails', 'todo', 'fixme', 'only']);

/**
 * (c) Títulos de las pruebas de un archivo (el primer argumento de `it(…)`/`test(…)`) que están activas, y los de las
 * desactivadas: con un modificador (`.skip`, `.fails`, `.todo`, `.fixme`, `.only`), dentro de un `describe` con
 * modificador o con un `*.skip()` incondicional en lo alto de su cuerpo.
 */
export function testTitles(file: string, code: string): { titles: string[]; disabled: string[] } {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const titles: string[] = [];
  const disabled: string[] = [];
  const skipsAtTop = (fn: ts.Node | undefined): boolean => {
    if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) || !ts.isBlock(fn.body)) return false;
    return fn.body.statements.some((st) => {
      if (!ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) return false;
      const chain = calleeChain(st.expression.expression);
      const arg = st.expression.arguments[0];
      return chain.at(-1) === 'skip' && (st.expression.arguments.length === 0 || arg.kind === ts.SyntaxKind.TrueKeyword);
    });
  };
  const visit = (node: ts.Node, off: boolean): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const chain = calleeChain(node.expression);
      const arg = node.arguments[0];
      const title = ts.isStringLiteralLike(arg) || ts.isTemplateExpression(arg) ? arg.getText(source).slice(1, -1) : undefined;
      const modified = chain.slice(1).some((n) => MODIFIERS.has(n));
      if (chain.includes('describe')) {
        node.forEachChild((c) => visit(c, off || modified));
        return;
      }
      if (title !== undefined && (chain[0] === 'it' || chain[0] === 'test')) {
        const callback = node.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        if (off || modified || skipsAtTop(callback)) disabled.push(title);
        else if (chain.length === 1) titles.push(title);
      }
    }
    node.forEachChild((c) => visit(c, off));
  };
  visit(source, false);
  return { titles, disabled };
}

/** (c) Cada prueba de paridad declarada existe en disco y está activa con ese título. */
export function missingEvidence(twins: readonly TwinPair[], exists: (file: string) => boolean, read: (file: string) => string): string[] {
  const out: string[] = [];
  const cache = new Map<string, ReturnType<typeof testTitles>>();
  for (const t of twins)
    for (const e of t.evidence) {
      if (!exists(e.file)) {
        out.push(`${t.id}: ${e.file} no existe`);
        continue;
      }
      const found = cache.get(e.file) ?? cache.set(e.file, testTitles(e.file, read(e.file))).get(e.file)!;
      if (!found.titles.some((title) => title.includes(e.title)))
        out.push(
          `${t.id}: ${e.file} no tiene una prueba activa «${e.title}»${found.disabled.some((d) => d.includes(e.title)) ? ' (desactivada)' : ''}`,
        );
    }
  return out;
}
