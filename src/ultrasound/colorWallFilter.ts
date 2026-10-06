/** Estimated power response in the sampled slow-time domain (decision 173). */
export function colorWallResponseHz(frequencyHz: number, cutoffHz: number, prfHz: number): number {
  if (cutoffHz <= 0) return 1;
  const f = frequencyHz - prfHz * Math.floor(frequencyHz / prfHz + 0.5);
  const x = (f * f) / (f * f + cutoffHz * cutoffHz);
  return x ** 4;
}

export const COLOR_WALL_FILTER_GLSL = /* glsl */ `
float colorWallResponseHz(float frequencyHz, float cutoffHz, float prfHz) {
  if (cutoffHz <= 0.0) return 1.0;
  float f = frequencyHz - prfHz * floor(frequencyHz / prfHz + 0.5);
  float x = f * f / (f * f + cutoffHz * cutoffHz);
  return x * x * x * x;
}
`;
