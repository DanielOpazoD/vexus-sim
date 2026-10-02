import type { Plugin } from 'vite';
import { join } from 'node:path';
import { readSources } from './glslMinify';

const BINDING = /\b(?:u[A-Z]\w*|(?:IF|T)_[A-Z][A-Z0-9_]*)\b/g;
/** Uniforms y tags estáticos: los #defines generados y sus consumidores se renombran juntos. */
export function bindingNames(all: string): Map<string, string> {
  const candidates = [...new Set(all.match(BINDING))].filter((n) => !/^u(?:Look|Tissue)/.test(n)).sort();
  const names = new Map(candidates.map((name, i) => [name, `_u${i.toString(36)}`]));
  for (const value of names.values()) if (new RegExp(`\\b${value}\\b`).test(all)) throw new Error(`Uniform short-name collision: ${value}`);
  return names;
}
export function compactBindings(code: string, names: ReadonlyMap<string, string>): string {
  return code.replace(BINDING, (name) => names.get(name) ?? name);
}
/** Applied after the GLSL map. Generated uLook/uTissue families retain their spelling. */
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
      names = bindingNames(
        readSources(join(root, 'src'))
          .map((s) => s.code)
          .join('\n'),
      );
    },
    transform(code, id) {
      if (!/[\\/]src[\\/].*\.ts$/.test(id) || /[\\/]node_modules[\\/]/.test(id)) return null;
      return { code: compactBindings(code, names), map: null };
    },
  };
}
