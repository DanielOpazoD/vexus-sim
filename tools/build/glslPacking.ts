import { dirname, join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { GLSL_WORDS } from '../../src/core/glslPacking';
import { findGlslTemplates, scanModule } from './glslMinify';

/** Encode static pieces only: dynamic interpolations retain their original evaluation/coercion. */
export function packGlslTemplates(code: string, id: string, root: string): string {
  const identifiers = scanModule(code).identifiers;
  let alias = '__unpackGlsl';
  while (identifiers.has(alias)) alias += '_';
  let used = false;
  let out = code;
  const words = new RegExp(`\\b(?:${GLSL_WORDS.join('|')})\\b`, 'g');
  for (const t of findGlslTemplates(code).reverse()) {
    const parts = t.statics.map((raw) => {
      // Preserve JS escapes literally; marker collisions remain on the ordinary path.
      if (/[\\@`]/.test(raw)) return raw;
      const cooked = raw.replace(/\r\n?/g, '\n');
      const packed = cooked.replace(
        words,
        (word) => '@' + String.fromCharCode(65 + GLSL_WORDS.indexOf(word as (typeof GLSL_WORDS)[number])),
      );
      const expression = '${' + alias + '(' + JSON.stringify(packed) + ')}';
      if (expression.length + 16 >= raw.length) return raw;
      used = true;
      return expression;
    });
    const content = parts.map((part, i) => part + (i < t.exprs.length ? '${' + t.exprs[i] + '}' : '')).join('');
    out = out.slice(0, t.start) + content + out.slice(t.end);
  }
  if (!used) return code;
  let path = relative(dirname(id), join(root, 'src/core/glslPacking')).replace(/\\/g, '/');
  if (!path.startsWith('.')) path = './' + path;
  return `import { unpackGlsl as ${alias} } from ${JSON.stringify(path)};\n` + out;
}

/** Last source-stage optimization, after GLSL names and bindings; source maps intentionally omitted. */
export function glslPacking(): Plugin {
  let root = process.cwd();
  return {
    name: 'glsl-lossless-packing',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    transform(code, id) {
      if (!/[\\/]src[\\/].*\.ts$/.test(id) || /[\\/]node_modules[\\/]/.test(id) || !code.includes('glsl')) return null;
      const out = packGlslTemplates(code, id, root);
      return out === code ? null : { code: out, map: null };
    },
  };
}
