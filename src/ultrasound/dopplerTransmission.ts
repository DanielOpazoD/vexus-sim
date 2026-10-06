/** Convert an acoustic loss prefix while preserving frequency-independent barriers. */
export function dopplerTransmission(totalDb: number, fixedDb: number, frequencyRatio: number): number {
  return 10 ** (-(Math.max(0, totalDb - fixedDb) * frequencyRatio + fixedDb) / 20);
}

export const DOPPLER_TRANSMISSION_GLSL = /* glsl */ `
float dopplerTransmission(float totalDb, float fixedDb, float frequencyRatio) {
  return pow(10.0, -(max(0.0, totalDb - fixedDb) * frequencyRatio + fixedDb) / 20.0);
}
`;
