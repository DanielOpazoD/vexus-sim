import { effectiveWallFilterCutoff, WALL_FILTER_MAX_PRF_FRACTION } from '../core/highPass';

/** Steady-state power response of the same two Butterworth high-pass
 * biquads as PW. This does not turn the analytic Color estimator into IQ. */
export function colorWallResponseHz(frequencyHz: number, cutoffHz: number, prfHz: number): number {
  const fc = effectiveWallFilterCutoff(cutoffHz, prfHz);
  if (!Number.isFinite(frequencyHz)) throw new RangeError('Invalid wall-filter frequency');
  if (fc === 0) return 1;
  const phase = Math.PI * (frequencyHz / prfHz - Math.floor(frequencyHz / prfHz + 0.5));
  const cut = (Math.PI * fc) / prfHz;
  const a = Math.tan(phase);
  const b = Math.tan(cut);
  const a4 = a ** 4;
  const stage = a4 / (a4 + b ** 4);
  return stage * stage;
}

export const COLOR_WALL_FILTER_GLSL = /* glsl */ `
float colorWallResponseHz(float frequencyHz, float cutoffHz, float prfHz) {
  if (cutoffHz <= 0.0) return 1.0;
  float f = frequencyHz - prfHz * floor(frequencyHz / prfHz + 0.5);
  float a = tan(3.1415927 * f / prfHz);
  float b = tan(3.1415927 * min(cutoffHz, ${WALL_FILTER_MAX_PRF_FRACTION} * prfHz) / prfHz);
  a *= a;
  b *= b;
  float stage = a * a / (a * a + b * b);
  return stage * stage;
}
`;
