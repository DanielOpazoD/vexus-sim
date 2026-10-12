import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { threeGlslCompact } from '../../tools/build/threeGlslCompact';

describe('contratos GLSL dinámicos de Three', () => {
  it('el mapa sigue al archivo real cuando varios checkouts comparten el mismo Three', () => {
    const root = mkdtempSync(join(tmpdir(), 'vexus-three-realpath-'));
    try {
      mkdirSync(join(root, 'node_modules'));
      symlinkSync(realpathSync(join(process.cwd(), 'node_modules/three')), join(root, 'node_modules/three'), 'dir');
      const plugin = threeGlslCompact();
      (plugin.configResolved as (config: { root: string }) => void)({ root });
      (plugin.buildStart as () => void)();
      const alias = join(root, 'node_modules/three/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js');
      const resolved = realpathSync(alias),
        code = readFileSync(resolved, 'utf8');
      const transform = plugin.transform as (code: string, id: string) => { code: string };
      const fromAlias = transform(code, alias),
        fromResolved = transform(code, resolved);
      expect(fromResolved.code).toBe(fromAlias.code);
      expect(fromResolved.code.length).toBeLessThan(code.length);
      expect(fromResolved.code).toContain('vec3 ACESFilmicToneMapping(');
      // Identidad canónica no permite aceptar contenido diferente del analizado.
      expect(() => transform(code.replace('vec3 LinearToneMapping', 'vec3 AlteredToneMapping'), resolved)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('conserva las funciones que WebGLProgram compone con el sufijo ToneMapping', () => {
    const plugin = threeGlslCompact();
    (plugin.configResolved as (config: { root: string }) => void)({ root: process.cwd() });
    (plugin.buildStart as () => void)();
    const path = join(process.cwd(), 'node_modules/three/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js');
    const code = readFileSync(path, 'utf8');
    const result = (plugin.transform as (code: string, id: string) => { code: string })(code, path);
    for (const name of ['Linear', 'Reinhard', 'Cineon', 'ACESFilmic', 'AgX', 'Neutral', 'Custom'])
      expect(result.code).toContain(`vec3 ${name}ToneMapping(`);
    expect(result.code.length).toBeLessThan(code.length);
  });
});
