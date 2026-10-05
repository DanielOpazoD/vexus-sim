import { describe, expect, it } from 'vitest';
import { Tissue } from '../anatomy/tissues';
import {
  SLOW_HETEROGENEITY_TISSUES,
  SLOW_HETEROGENEITY_GLSL_CONDITION,
  LIVER_HET_COORDINATE_SCALE,
  HET_CELL_MM,
  HET_SCALE_DB,
  heterogeneityDb,
  valueNoise,
} from '../ultrasound/speckleField';
import { FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED } from '../ultrasound/shaders/passes.glsl';

describe('parénquima hepático basal con modulación material más fina', () => {
  it('conserva los seis tejidos del medio y excluye sangre y paredes', () => {
    expect(SLOW_HETEROGENEITY_TISSUES).toEqual([
      Tissue.Liver,
      Tissue.Muscle,
      Tissue.Bowel,
      Tissue.RenalCortex,
      Tissue.Psoas,
      Tissue.QuadratusLumborum,
    ]);
    for (const t of [Tissue.Blood, Tissue.VesselWallPortal, Tissue.LiverCapsule]) expect(SLOW_HETEROGENEITY_TISSUES).not.toContain(t);
  });
  it('la mirada central y las dirigidas usan la misma selección sin borrar tríadas portales', () => {
    const selection = `if (${SLOW_HETEROGENEITY_GLSL_CONDITION}) het = hetGain(m, tissue);`;
    expect(SLOW_HETEROGENEITY_GLSL_CONDITION).toContain('T_LIVER');
    expect(FRAG_RAWFIELD.split(selection).length - 1).toBe(1);
    expect(FRAG_RAWFIELD_STEERED.split(selection).length - 1).toBe(2);
    for (const shader of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) {
      expect(shader).toContain('if (tissue == T_LIVER) het *= portalTriad(m, dir);');
      expect(shader).toContain('speckleField');
    }
  });
  it('la modulación hepática conserva variación y potencia, sin anular el campo', () => {
    const gains = Array.from(
      { length: 4000 },
      (_, i) => 10 ** (heterogeneityDb([-150 + 0.077 * i, 30 + 0.051 * i, -90 + 0.033 * i], 47, Tissue.Liver) / 20),
    );
    expect(Math.min(...gains)).toBeGreaterThan(0);
    expect(Math.max(...gains) - Math.min(...gains)).toBeGreaterThan(0.3);
    const meanPower = gains.reduce((sum, g) => sum + g * g, 0) / gains.length;
    // Reported engineering bound: the zero-centred dB field is not an arbitrary brightness boost.
    // Finite sample variation is allowed; do not calibrate clinical echogenicity from this sample.
    expect(Math.abs(10 * Math.log10(meanPower))).toBeLessThan(0.5);
  });
  it('cambia solo la escala espacial hepática, no amplitud, ley ni semilla del medio', () => {
    for (let i = 0; i < 100; i++) {
      const p: [number, number, number] = [-20 + i * 0.37, 9 + i * 0.51, -7 + i * 0.19];
      const doubled: [number, number, number] = p.map((v) => v * LIVER_HET_COORDINATE_SCALE) as [number, number, number];
      expect(heterogeneityDb(p, 47, Tissue.Liver)).toBe(heterogeneityDb(doubled, 47));
      const old = (valueNoise(p.map((v) => v / HET_CELL_MM) as [number, number, number], 58) - 0.5) * HET_SCALE_DB;
      for (const t of SLOW_HETEROGENEITY_TISSUES.filter((t) => t !== Tissue.Liver)) expect(heterogeneityDb(p, 47, t)).toBe(old);
    }
  });
  it('ambas rutas GPU aplican el mismo cambio de coordenada antes del ruido de valor', () => {
    for (const shader of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) expect(shader).toContain('if (tissue == T_LIVER) m *= 2.0;');
  });
});
