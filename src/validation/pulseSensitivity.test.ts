import { expect, it } from 'vitest';
import { erf, pulseErf } from '../doppler/sampleVolume';
it('la tabla de sensibilidad conserva erf con error acotado y simetría', () => {
  let maximumError = 0,
    maximumSymmetryError = 0,
    maximumMagnitude = 0;
  for (let i = 0; i <= 100000; i++) {
    const x = -5 + i / 10000;
    maximumError = Math.max(maximumError, Math.abs(pulseErf(x) - erf(x)));
    maximumMagnitude = Math.max(maximumMagnitude, Math.abs(pulseErf(x)));
    if (x !== 0) maximumSymmetryError = Math.max(maximumSymmetryError, Math.abs(pulseErf(-x) + pulseErf(x)));
  }
  // The analytic interpolation bound is 1.16e-7; the >4 tail is <1.6e-8.
  expect(maximumError).toBeLessThan(1.2e-7);
  expect(maximumMagnitude).toBeLessThanOrEqual(1);
  expect(maximumSymmetryError).toBe(0);
});
