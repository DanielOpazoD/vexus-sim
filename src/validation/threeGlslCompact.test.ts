import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { threeGlslCompact } from '../../tools/build/threeGlslCompact';

describe('contratos GLSL dinámicos de Three', () => {
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
