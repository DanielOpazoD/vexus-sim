import { describe, expect, it } from 'vitest';
import { colorWallResponseHz } from '../ultrasound/colorWallFilter';

describe('color wall response in sampled frequency', () => {
  it('agrees with an independent sampled-IQ phase oracle, including aliases', () => {
    for (const prf of [700, 1000, 2272])
      for (const fraction of [-2, -1.37, -0.5, -0.04, 0, 0.17, 0.49, 0.5, 1, 2.17]) {
        const f = fraction * prf;
        const iq = Array.from({ length: 16 }, (_, n) => [Math.cos((2 * Math.PI * f * n) / prf), Math.sin((2 * Math.PI * f * n) / prf)]);
        let re = 0,
          im = 0;
        for (let n = 1; n < iq.length; n++) {
          re += iq[n][0] * iq[n - 1][0] + iq[n][1] * iq[n - 1][1];
          im += iq[n][1] * iq[n - 1][0] - iq[n][0] * iq[n - 1][1];
        }
        const sampledHz = (Math.atan2(im, re) * prf) / (2 * Math.PI);
        for (const cutoff of [0, 60, 600]) {
          const independent = cutoff === 0 ? 1 : Math.pow(1 / (1 + (cutoff / Math.abs(sampledHz)) ** 2), 4);
          expect(colorWallResponseHz(f, cutoff, prf)).toBeCloseTo(independent, 10);
        }
      }
  });
  it('is finite and transparent when disabled, including stationary clutter', () => {
    for (const f of [0, -1000, 1000, 8000]) expect(colorWallResponseHz(f, 0, 1000)).toBe(1);
    for (const f of [0, -1000, 1000, 8000]) expect(colorWallResponseHz(f, 60, 1000)).toBe(0);
    expect(colorWallResponseHz(400, 60, 1000)).toBeCloseTo(colorWallResponseHz(1400, 60, 1000), 12);
    expect(colorWallResponseHz(400, 600, 1000)).toBeLessThan(colorWallResponseHz(400, 60, 1000));
  });
});
