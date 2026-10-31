import { describe, expect, it } from 'vitest';
import { focalGain } from '../ultrasound/beamEcho';
import { DEFAULT_BMODE, nearFieldTgcDb } from '../ultrasound/renderer';
import { FRAG_SCANCONVERT } from '../ultrasound/shaders/passes.glsl';
import { bmodeBeam, CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';

describe('compensación nominal del campo cercano', () => {
  it('compensa parte de lo que la ganancia focal del preajuste le quita a la pared, y nunca más', () => {
    const beam = bmodeBeam(CONVEX_C35_PROFILE, { ...DEFAULT_BMODE, harmonic: true });
    for (let r = 3; r <= 60; r += 3) {
      const deficit = -20 * Math.log10(focalGain(r, DEFAULT_BMODE.focusMm, beam));
      expect(nearFieldTgcDb(r), `r = ${r}`).toBeLessThanOrEqual(deficit);
    }
    for (const r of [60, 90, 120, 180]) expect(nearFieldTgcDb(r)).toBe(0);
  });

  it('la GPU usa la misma recta', () => {
    expect(FRAG_SCANCONVERT).toContain('3.0 * max(0.0, 1.0 - r / 60.0)');
    expect(nearFieldTgcDb(0)).toBe(3);
    expect(nearFieldTgcDb(30)).toBe(1.5);
  });
});
