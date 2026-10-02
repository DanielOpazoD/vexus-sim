import { describe, expect, it } from 'vitest';
import { bindingNames, compactBindings } from '../../tools/build/glslUniformNames';
import { readSources } from '../../tools/build/glslMinify';
import { join } from 'node:path';
import { ANATOMY_GLSL } from '../anatomy/gpu/anatomy.glsl';
import { INTERFACE_GLSL_NAME, Interface } from '../anatomy/interfaces';
import { TISSUE_GLSL_NAME, Tissue } from '../anatomy/tissues';

describe('bindings GLSL estáticos compactos', () => {
  it('todos los fuentes se restituyen exactamente, incluidas definiciones generadas', () => {
    const sources = readSources(join(process.cwd(), 'src'));
    const names = bindingNames(sources.map((s) => s.code).join('\n'));
    const inverse = new Map([...names].map(([a, b]) => [b, a]));
    expect(names.has('IF_VERTEBRAL_CORTEX')).toBe(true);
    for (const { code } of sources) {
      const restored = compactBindings(code, names).replace(/\b_u[0-9a-z]+\b/g, (n) => inverse.get(n) ?? n);
      expect(restored).toBe(code);
    }
    const shader = compactBindings(ANATOMY_GLSL, names);
    for (const [id, label] of Object.entries(INTERFACE_GLSL_NAME)) {
      expect(shader).toContain(`#define ${names.get(label)} ${id}`);
      expect(shader).not.toMatch(new RegExp(`\\b${label}\\b`));
    }
    expect(shader).toContain(`#define ${names.get(TISSUE_GLSL_NAME[Tissue.Vertebra])} ${Tissue.Vertebra}`);
    expect(INTERFACE_GLSL_NAME[Interface.VertebralCortex]).toBe('IF_VERTEBRAL_CORTEX');
  });
  it('protege familias dinámicas y rechaza colisiones', () => {
    const s = 'uLook0 uTissueA uSpine IF_NONE T_BONE';
    expect(compactBindings(s, bindingNames(s))).toMatch(/^uLook0 uTissueA /);
    expect(() => bindingNames('uSpine _u0')).toThrow('collision');
  });
});
