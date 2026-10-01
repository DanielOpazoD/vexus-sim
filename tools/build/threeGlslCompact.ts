import type { Plugin } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { prepareGlslMangle, transformWithMangle, type GlslMangleContext, type SourceModule } from './glslMinify';

/** Optimize Three's tagged GLSL with one map across its source modules.
 * Renderer strings, uniforms, attributes and preprocessor lines retain their contracts. */
export function threeGlslCompact(): Plugin {
  let root = process.cwd();
  let context: GlslMangleContext;
  return {
    name: 'three-glsl-compact',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      const modules: SourceModule[] = [];
      const visit = (dir: string): void => {
        for (const item of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, item.name);
          if (item.isDirectory()) visit(path);
          else if (item.name.endsWith('.js')) modules.push({ path, code: readFileSync(path, 'utf8') });
        }
      };
      visit(join(root, 'node_modules/three/src/renderers')); // Includes WebGL prefix/replacement strings and all uniform-binding contracts.
      context = prepareGlslMangle(modules);
      // WebGLProgram constructs `${toneMappingName}ToneMapping` in JS. The general
      // scanner sees the suffix, but this caller is outside the tagged-template graph.
      context.map.names = new Map([...context.map.names].filter(([name]) => !name.endsWith('ToneMapping')));
    },
    transform(code, id) {
      if (!/node_modules\/three\/src\/renderers\/shaders\/(?:ShaderChunk|ShaderLib)\/[^/]+\.glsl\.js$/.test(id.replaceAll('\\', '/')))
        return null;
      return { code: transformWithMangle(code, id, context, { compact: true }), map: null };
    },
  };
}
