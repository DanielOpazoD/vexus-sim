import { mmsToCms, velocityFromShiftMmS } from '../core/units';
import type { SpectralColumn } from './spectral';

/** Sampling-grid spacing, not effective resolution, error bounds or clinical accuracy. */
export function spectralSampling(column: SpectralColumn | undefined, f0Hz: number) {
  if (!column) return null;
  const fftSize = column.powerDb.length;
  if (fftSize < 2 || !Number.isFinite(column.prfHz) || column.prfHz <= 0 || !Number.isFinite(f0Hz) || f0Hz <= 0)
    throw new RangeError('Invalid spectral sampling metadata');
  const binHz = column.prfHz / fftSize;
  const binCms = mmsToCms(velocityFromShiftMmS(binHz, f0Hz, 0));
  const windowMs = (1000 * fftSize) / column.prfHz;
  if (![binHz, binCms, windowMs].every((x) => Number.isFinite(x) && x > 0)) throw new RangeError('Invalid spectral sampling interval');
  return { fftSize, binHz, binCms, windowMs };
}
