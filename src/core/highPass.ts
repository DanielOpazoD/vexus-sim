export const WALL_FILTER_MAX_PRF_FRACTION = 0.45;

/** Corte efectivo del receptor, estrictamente por debajo de Nyquist. */
export function effectiveWallFilterCutoff(cutoffHz: number, sampleRateHz: number): number {
  if (!Number.isFinite(cutoffHz) || !Number.isFinite(sampleRateHz) || sampleRateHz <= 0)
    throw new RangeError('Invalid wall-filter frequency');
  return Math.min(Math.max(0, cutoffHz), sampleRateHz * WALL_FILTER_MAX_PRF_FRACTION);
}
