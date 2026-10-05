import { describe, expect, it } from 'vitest';
import { Tissue } from '../anatomy/tissues';
import { SLOW_HETEROGENEITY_TISSUES, SLOW_HETEROGENEITY_GLSL_CONDITION, heterogeneityDb } from '../ultrasound/speckleField';
import { FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED } from '../ultrasound/shaders/passes.glsl';

describe('parénquima hepático basal sin modulación macroscópica añadida', () => {
  it('conserva exactamente los otros cinco tejidos y excluye sangre, paredes y el hígado basal', () => {
    expect(SLOW_HETEROGENEITY_TISSUES).toEqual([Tissue.Muscle, Tissue.Bowel, Tissue.RenalCortex, Tissue.Psoas, Tissue.QuadratusLumborum]);
    for (const t of [Tissue.Liver, Tissue.Blood, Tissue.VesselWallPortal, Tissue.LiverCapsule])
      expect(SLOW_HETEROGENEITY_TISSUES).not.toContain(t);
  });
  it('la mirada central y las dirigidas usan la misma selección sin borrar tríadas portales', () => {
    const selection = `if (${SLOW_HETEROGENEITY_GLSL_CONDITION}) het = hetGain(m);`;
    expect(SLOW_HETEROGENEITY_GLSL_CONDITION).not.toContain('T_LIVER');
    expect(FRAG_RAWFIELD.split(selection).length - 1).toBe(1);
    expect(FRAG_RAWFIELD_STEERED.split(selection).length - 1).toBe(2);
    for (const shader of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) {
      expect(shader).toContain('if (tissue == T_LIVER) het *= portalTriad(m, dir);');
      expect(shader).toContain('speckleField');
    }
  });
  it('la variación retirada es una ganancia de material, no una supresión del moteado ni del eco', () => {
    const gains = Array.from(
      { length: 4000 },
      (_, i) => 10 ** (heterogeneityDb([-150 + 0.077 * i, 30 + 0.051 * i, -90 + 0.033 * i], 47) / 20),
    );
    expect(Math.min(...gains)).toBeGreaterThan(0);
    expect(Math.max(...gains) - Math.min(...gains)).toBeGreaterThan(0.3);
    const meanPower = gains.reduce((sum, g) => sum + g * g, 0) / gains.length;
    // Reported engineering bound: removing this zero-centred dB field is not a brightness boost.
    // Finite sample variation is allowed; do not calibrate clinical echogenicity from this sample.
    expect(Math.abs(10 * Math.log10(meanPower))).toBeLessThan(0.5);
  });
});
