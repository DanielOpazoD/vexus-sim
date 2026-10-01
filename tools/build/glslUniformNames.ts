import type { Plugin } from 'vite';
import { join } from 'node:path';
import { readSources } from './glslMinify';

/** Shorten statically named application uniforms and their JS bindings together.
 * Generated uLook/uTissue families retain their spelling. Applied after the GLSL map. */
export function glslUniformNames(): Plugin {
  let root = process.cwd();
  let names = new Map<string, string>();
  return {
    name: 'glsl-uniform-names',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      const sources = readSources(join(root, 'src'));
      const all = sources.map((s) => s.code).join('\n');
      const candidates = [...new Set(all.match(/\bu[A-Z]\w*/g))].filter((n) => !/^u(?:Look|Tissue)/.test(n)).sort();
      names = new Map(candidates.map((name, i) => [name, `_u${i.toString(36)}`]));
      for (const value of names.values())
        if (new RegExp(`\\b${value}\\b`).test(all)) throw new Error(`Uniform short-name collision: ${value}`);
    },
    transform(code, id) {
      if (!/[\\/]src[\\/].*\.ts$/.test(id) || /[\\/]node_modules[\\/]/.test(id)) return null;
      return { code: code.replace(/\bu[A-Z]\w*/g, (name) => names.get(name) ?? name), map: null };
    },
  };
}
