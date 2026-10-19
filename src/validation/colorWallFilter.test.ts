import { describe, expect, it } from 'vitest';
import { WallFilter } from '../doppler/wallFilter';
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
          const independent = new WallFilter(cutoff, prf).magnitude(sampledHz) ** 2;
          expect(colorWallResponseHz(f, cutoff, prf)).toBeCloseTo(independent, 10);
        }
      }
  });
  it('conserva la potencia del PW medido sobre IQ, también en el corte y Nyquist', () => {
    const prf = 1000;
    for (const cutoff of [0, 60, 600])
      for (const f of [0, 15, 60, 400, 500, 1060, -60]) {
        const re = Float32Array.from({ length: 4096 }, (_, n) => Math.cos((2 * Math.PI * f * n) / prf));
        const im = Float32Array.from({ length: 4096 }, (_, n) => Math.sin((2 * Math.PI * f * n) / prf));
        new WallFilter(cutoff, prf).process(re, im);
        let power = 0;
        for (let n = 2048; n < re.length; n++) power += re[n] ** 2 + im[n] ** 2;
        expect(colorWallResponseHz(f, cutoff, prf)).toBeCloseTo(power / 2048, 6);
      }
    // Two cascaded biquads give −6.02 dB of power at their shared cutoff.
    // The previous Color model gave −12.04 dB and erased more slow blood.
    expect(colorWallResponseHz(60, 60, prf)).toBeCloseTo(0.25, 12);
  });

  it('rechaza frecuencias no finitas y PRF inválida', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => colorWallResponseHz(value, 60, 1000)).toThrow(RangeError);
      expect(() => colorWallResponseHz(100, value, 1000)).toThrow(RangeError);
      expect(() => colorWallResponseHz(100, 60, value)).toThrow(RangeError);
    }
    for (const prf of [0, -1]) expect(() => colorWallResponseHz(100, 60, prf)).toThrow(RangeError);
  });

  it('is finite and transparent when disabled, including stationary clutter', () => {
    for (const f of [0, -1000, 1000, 8000]) expect(colorWallResponseHz(f, 0, 1000)).toBe(1);
    for (const f of [0, -1000, 1000, 8000]) expect(colorWallResponseHz(f, 60, 1000)).toBe(0);
    expect(colorWallResponseHz(400, 60, 1000)).toBeCloseTo(colorWallResponseHz(1400, 60, 1000), 12);
    expect(colorWallResponseHz(400, 600, 1000)).toBeLessThan(colorWallResponseHz(400, 60, 1000));
  });
});
