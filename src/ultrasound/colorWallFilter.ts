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
// Some highp drivers approximate built-in sin/cos too coarsely for R1.
// Reduce to [-pi/2, pi/2]; degree-11 sine has remainder < 6e-8 there.
// Return (cos, sin) for cycles, shared by phase and the biquad response.
vec2 colorPhase(float turn) {
  vec2 x = vec2(turn + 0.25, turn);
  x -= floor(x + 0.5);
  x = 6.28318530718 * sign(x) * min(abs(x), 0.5 - abs(x));
  vec2 y = x * x;
  return x * (1.0 + y * (-0.166666666667 + y * (0.00833333333333 + y * (-0.000198412698413 + y * (0.0000027557319224 - y * 0.0000000250521083854)))));
}
float colorWallResponseHz(float frequencyHz, float cutoffHz, float prfHz) {
  if (cutoffHz <= 0.0) return 1.0;
  float f = frequencyHz - prfHz * floor(frequencyHz / prfHz + 0.5);
  vec2 halfCycles = 0.5 * vec2(f, min(cutoffHz, ${WALL_FILTER_MAX_PRF_FRACTION} * prfHz)) / prfHz;
  vec2 a = colorPhase(halfCycles.x);
  vec2 b = colorPhase(halfCycles.y);
  // tan(a)^4 / (tan(a)^4 + tan(b)^4), without its Nyquist singularity.
  vec2 p = vec2(a.y * b.x, b.y * a.x);
  p *= p;
  float stage = p.x * p.x / (p.x * p.x + p.y * p.y);
  return stage * stage;
}
`;
