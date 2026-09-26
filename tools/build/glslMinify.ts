import type { Plugin } from 'vite';

/**
 * Minificado del GLSL en el build: el texto de los shaders viaja en el chunk principal dentro de las plantillas
 * `/* glsl *\/ \`…\``, con sus comentarios y su sangría (el presupuesto lo cuenta entero). En el build se quitan los
 * comentarios (`//` y `/* *\/`) y la sangría de esas plantillas; se conservan los saltos de línea (las directivas
 * `#define` y `#if` los necesitan y así el mapa de fuentes sigue siendo línea a línea) y las interpolaciones
 * `${…}` (salvo las que caen dentro de un comentario, que desaparecen con él). Las pruebas (vitest) y el servidor de
 * desarrollo ven el fuente tal cual; la e2e prueba los shaders minificados.
 */

const TAG = /\/\*\s*glsl\s*\*\/\s*`/g;

/** Una plantilla: trozos estáticos y expresiones alternados (`statics.length === exprs.length + 1`). */
interface Template {
  start: number;
  end: number;
  statics: string[];
  exprs: string[];
}

/** Índice del final de la expresión `${` que empieza en `from` (el `}` que la cierra), saltando cadenas anidadas. */
function exprEnd(code: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < code.length) {
    const c = code[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      i++;
      while (i < code.length && code[i] !== q) i += code[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '`') {
      i = templateEnd(code, i + 1).end;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
    i++;
  }
  throw new Error('glslMinify: expresión sin cerrar');
}

/** Recorre una plantilla desde el carácter tras el acento grave de apertura; `end` es el índice tras el de cierre. */
function templateEnd(code: string, from: number): { end: number; statics: string[]; exprs: string[] } {
  const statics: string[] = [];
  const exprs: string[] = [];
  let buf = '';
  let i = from;
  while (i < code.length) {
    const c = code[i];
    if (c === '\\') {
      buf += code.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '`') {
      statics.push(buf);
      return { end: i + 1, statics, exprs };
    }
    if (c === '$' && code[i + 1] === '{') {
      const e = exprEnd(code, i + 2);
      statics.push(buf);
      buf = '';
      exprs.push(code.slice(i + 2, e));
      i = e + 1;
      continue;
    }
    buf += c;
    i++;
  }
  throw new Error('glslMinify: plantilla sin cerrar');
}

function findTemplates(code: string): Template[] {
  const out: Template[] = [];
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(code))) {
    const open = m.index + m[0].length; // tras el acento grave
    const t = templateEnd(code, open);
    out.push({ start: open, end: t.end - 1, statics: t.statics, exprs: t.exprs });
    TAG.lastIndex = t.end;
  }
  return out;
}

/**
 * Minifica el cuerpo de una plantilla GLSL: quita comentarios y sangría, conserva los saltos de línea. Devuelve el
 * texto que va entre los acentos graves (con las interpolaciones que sobreviven).
 */
export function minifyGlslBody(statics: readonly string[], exprs: readonly string[]): string {
  let out = '';
  let lineComment = false;
  let blockComment = false;
  for (let p = 0; p < statics.length; p++) {
    const s = statics[p];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (lineComment) {
        if (c === '\n') {
          lineComment = false;
          out += '\n';
        }
        continue;
      }
      if (blockComment) {
        if (c === '\n') out += '\n';
        else if (c === '*' && s[i + 1] === '/') {
          blockComment = false;
          i++;
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
        i++;
        continue;
      }
      out += c;
    }
    // una interpolación dentro de un comentario desaparece con él
    if (p < exprs.length && !lineComment && !blockComment) out += '${' + exprs[p] + '}';
  }
  // sangría y espacios al final de cada línea (los saltos de línea se quedan)
  return out
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
}

/** Minifica todas las plantillas `/* glsl *\/` de un módulo; el número de líneas no cambia. */
export function minifyGlslTemplates(code: string): string {
  const ts = findTemplates(code);
  if (ts.length === 0) return code;
  let out = '';
  let last = 0;
  for (const t of ts) {
    out += code.slice(last, t.start) + minifyGlslBody(t.statics, t.exprs);
    last = t.end;
  }
  return out + code.slice(last);
}

/** Mapa de fuentes línea a línea (cada línea del código transformado viene de la misma línea del fuente). */
function lineMap(code: string, id: string): { version: number; sources: string[]; names: string[]; mappings: string } {
  const lines = code.split('\n').length;
  return { version: 3, sources: [id], names: [], mappings: ['AAAA', ...Array.from({ length: lines - 1 }, () => 'AACA')].join(';') };
}

/** Plugin de Vite: solo en el build y solo en los módulos de `src/` con plantillas GLSL. */
export function glslMinify(): Plugin {
  return {
    name: 'glsl-minify',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]src[\\/].*\.ts$/.test(id) || !code.includes('glsl')) return null;
      const out = minifyGlslTemplates(code);
      if (out === code) return null;
      return { code: out, map: lineMap(out, id) };
    },
  };
}
