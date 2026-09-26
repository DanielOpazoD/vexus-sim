/**
 * Espacios y saltos de línea del GLSL en el build (tercera etapa de `glslMinify.ts`, que documenta el contrato).
 *
 * Trabaja sobre los trozos estáticos de una plantilla `/* glsl *\/` ya sin comentarios (y renombrados, si toca), con
 * las interpolaciones entre ellos. El blanco entre dos trozos de código se quita si el texto pegado se lee con los
 * mismos tokens que separado; si no, queda un espacio (`float x`, `- -`, `+ +`, `< <`, `& &`, `= =`, `/ /`…). Se
 * comprueba con dos léxicos, y hace falta que los dos lo acepten: el de los números de preprocesador de C (el de Mesa:
 * `0x1e-5` es un solo token) y el de ANGLE (Chrome, Firefox y Safari: un exponente solo en decimal, `1.5e-3`). Basta
 * mirar cada pareja de trozos vecinos: en el léxico de C todo token (identificador, número de preprocesador, operador)
 * sigue siéndolo al recortarlo por la derecha, y el único patrón de ANGLE que no (el exponente: `1.5e` `-` `3`) necesita
 * un `e±` que el léxico de C nunca deja pegar. Las líneas se juntan, salvo:
 * - las directivas (`#define`, `#version`, `#if`…), que se copian tal cual en su propia línea: el salto que las precede
 *   y el que las cierra se quedan;
 * - lo que viene tras una interpolación hasta el final de su línea, y la primera línea de la plantilla, se copian tal
 *   cual con su salto: el texto interpolado (o el que precede a la plantilla donde se interpola) puede abrir una
 *   directiva o un comentario `//` que siga en esa línea;
 * - junto a una interpolación o a un extremo de la plantilla el blanco se queda (un espacio, o un salto si lo había),
 *   y el blanco que precede a un trozo pegado a la interpolación siguiente tampoco se quita: el token de ese trozo
 *   puede seguir en el texto interpolado;
 * - cada ~`LINE_CAP` caracteres se conserva un salto que ya existía, para que un error de compilación (que cita la
 *   línea) siga siendo legible.
 * Una plantilla con secuencias de escape del literal JS (`\n`, `\``…) no se toca.
 */

/** Longitud a partir de la cual un salto de línea que ya existía se conserva en vez de juntar la línea siguiente. */
export const LINE_CAP = 1000;

/** Operadores de más de un carácter (y los que formarían un comentario o un pegado del preprocesador). */
const MULTI = [
  '<<=',
  '>>=',
  '++',
  '--',
  '<<',
  '>>',
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '^^',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '^=',
  '|=',
  '//',
  '/*',
  '*/',
  '##',
];
const isWs = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;
/** Número de preprocesador de C (el de Mesa): absorbe el signo tras e/E/p/P, también en hexadecimal. */
const C_NUMBER = /\.?[0-9](?:[eEpP][+-]|[A-Za-z0-9_.])*/y;
/** Números de ANGLE (`Tokenizer.l`): enteros, flotantes con exponente decimal y los inválidos que empiezan por dígito. */
const ANGLE_NUMBERS = [
  /0[xX][0-9a-fA-F]+[uU]?/y,
  /[0-9]+[uU]?/y,
  /[0-9]+[eE][+-]?[0-9]+[fF]?/y,
  /[0-9]*\.[0-9]+(?:[eE][+-]?[0-9]+)?[fF]?/y,
  /[0-9]+\.[0-9]*(?:[eE][+-]?[0-9]+)?[fF]?/y,
  /[0-9]+[A-Za-z_][A-Za-z0-9_]*/y,
  /[0-9]*\.[0-9]+[A-Za-z0-9_.]*/y,
  /[0-9]+\.[A-Za-z0-9_.]*/y,
];

const sticky = (re: RegExp, s: string, i: number): number => {
  re.lastIndex = i;
  const m = re.exec(s);
  return m ? m[0].length : 0;
};

/** Un léxico de GLSL (máxima coincidencia) con su regla de números. */
function lexer(numberLength: (s: string, i: number) => number): (s: string) => string[] {
  return (s) => {
    const out: string[] = [];
    for (let i = 0; i < s.length;) {
      let n = sticky(IDENT, s, i) || numberLength(s, i);
      if (n === 0) n = MULTI.find((op) => s.startsWith(op, i))?.length ?? 1;
      out.push(s.slice(i, i + n));
      i += n;
    }
    return out;
  };
}

const LEXERS = [lexer((s, i) => sticky(C_NUMBER, s, i)), lexer((s, i) => Math.max(0, ...ANGLE_NUMBERS.map((re) => sticky(re, s, i))))];

/** ¿Se pueden pegar `a` y `b` (sin blanco entre ellos) y seguir leyéndose los mismos tokens, con los dos léxicos? */
export function canJoin(a: string, b: string): boolean {
  return LEXERS.every((lex) => {
    const joined = lex(a + b);
    const apart = [...lex(a), ...lex(b)];
    return joined.length === apart.length && joined.every((t, k) => t === apart[k]);
  });
}

/** ¿Hace falta un espacio entre estos dos trozos para que se sigan leyendo igual? */
export const needsSpace = (a: string, b: string): boolean => !canJoin(a, b);

/** Modo de la etapa: `join` junta líneas; `lines` conserva todos los saltos (cuando el módulo no puede perder líneas). */
export type CompactMode = 'join' | 'lines';

/** Un blanco, un trozo de código (sin blancos) o texto que se copia tal cual (una directiva, el resto de una línea). */
type Item = { kind: 'ws' | 'code' | 'raw'; text: string };

/**
 * Compacta los trozos estáticos de una plantilla. Devuelve los trozos nuevos (tantos como antes: las interpolaciones
 * no se tocan).
 */
export function compactGlslParts(parts: readonly string[], mode: CompactMode = 'join'): string[] {
  if (parts.some((s) => s.includes('\\'))) return [...parts];
  const out: string[] = [];
  /** Caracteres de la línea de salida en curso (para `LINE_CAP`), contados a través de los trozos. */
  let lineLength = 0;
  for (let p = 0; p < parts.length; p++) {
    const s = parts[p];
    const items: Item[] = [];
    // tras una interpolación y en la primera línea de la plantilla, hasta el salto de línea, tal cual
    const e = s.indexOf('\n');
    let i = e < 0 ? s.length : e;
    if (i > 0) items.push({ kind: 'raw', text: s.slice(0, i) });
    let lineStart = false;
    while (i < s.length) {
      const c = s[i];
      let j = i + 1;
      if (isWs(c)) {
        while (isWs(s[j])) j++;
        if (s.slice(i, j).includes('\n')) lineStart = true;
        items.push({ kind: 'ws', text: s.slice(i, j) });
      } else if (c === '#' && lineStart) {
        // una directiva: tal cual hasta el salto de línea
        const nl = s.indexOf('\n', i);
        j = nl < 0 ? s.length : nl;
        items.push({ kind: 'raw', text: s.slice(i, j) });
        lineStart = false;
      } else {
        while (j < s.length && !isWs(s[j])) j++;
        items.push({ kind: 'code', text: s.slice(i, j) });
        lineStart = false;
      }
      i = j;
    }
    let o = '';
    const emit = (t: string): void => {
      o += t;
      const nl = t.lastIndexOf('\n');
      lineLength = nl < 0 ? lineLength + t.length : t.length - nl - 1;
    };
    const keep = (run: string): string => (run.includes('\n') ? (mode === 'lines' ? run.replace(/[^\n]/g, '') : '\n') : ' ');
    items.forEach((it, k) => {
      if (it.kind !== 'ws') return emit(it.text);
      const prev = items[k - 1];
      const next = items[k + 1];
      // junto a una interpolación o a un extremo de la plantilla, junto a una directiva o a lo copiado tal cual, y ante
      // un trozo pegado a la interpolación siguiente (su token puede seguir en ella): el blanco se queda
      const gluedNext = next !== undefined && k + 1 === items.length - 1;
      if (!prev || !next || prev.kind === 'raw' || next.kind === 'raw' || gluedNext) return emit(keep(it.text));
      const hasNewline = it.text.includes('\n');
      if (hasNewline && (mode === 'lines' || lineLength >= LINE_CAP)) return emit(keep(it.text));
      emit(canJoin(prev.text, next.text) ? '' : ' ');
    });
    out.push(o);
  }
  return out;
}
