import { describe, expect, it } from 'vitest';
import { personShader } from '../../tools/anatomy/s0028-p1-specialized';
import { shaderCosts } from '../../tools/anatomy/s0028-shader-metrics';
import { wallShader } from '../../tools/anatomy/s0028-wall-cost';
import { S0028_BUNDLE } from './support/legacyPerson/anatomyBundle';

describe('representación P2 offline sobre las ocho fuentes P1 vigentes', () => {
  it('mide el lector con U, halos y proyección sin añadir samplers ni cambiar techos', () => {
    const rows = shaderCosts(wallShader, (s) => personShader(s, { person: 's0028', bundle: S0028_BUNDLE }));
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.current.pass, row.name + ' P1').toBe(true);
      expect(row.specialized.pass, row.name + ' P2 estimado').toBe(true);
      expect(row.specialized.samplers, row.name).toBe(row.current.samplers);
      expect(row.specialized.slots, row.name).toBeLessThanOrEqual(179);
    }
  });

  it('rechaza un sampler adicional en ECHO y crecimiento de uniforms', () => {
    const sampler = shaderCosts((s) => wallShader(s) + '\nuniform sampler3D uWallExtra;');
    const echo = sampler.find((r) => r.name === 'FRAG_RAWFIELD_ECHO');
    expect(echo?.specialized.samplers).toBe(17);
    expect(echo?.specialized.pass).toBe(false);
    const slots = shaderCosts((s) => wallShader(s) + '\nuniform vec4 uWallExtra[180];');
    expect(slots.every((r) => !r.specialized.pass)).toBe(true);
  });
});
