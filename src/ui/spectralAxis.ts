/** A baseline shift repositions one PRF-wide display interval; it never changes the acquired signal. */
export function spectralAxis(nyquistCms: number, baselineShift: number) {
  if (!(nyquistCms > 0) || !Number.isFinite(nyquistCms) || !Number.isFinite(baselineShift) || Math.abs(baselineShift) > 0.45)
    throw new Error('Invalid spectral axis');
  return {
    minCms: (-1 + 2 * baselineShift) * nyquistCms,
    maxCms: (1 + 2 * baselineShift) * nyquistCms,
    zeroFraction: 0.5 + baselineShift,
    fractionOf: (velocityCms: number) => 0.5 + baselineShift - velocityCms / (2 * nyquistCms),
  };
}

/** FFT-shifted bins remain periodic at PRF. Use pixel centers to avoid sampling the duplicated Nyquist edge. */
export function spectralBinAt(rowFraction: number, fftSize: number, baselineShift: number): number {
  const binFraction = 1 - rowFraction + baselineShift;
  const wrapped = ((binFraction % 1) + 1) % 1;
  return Math.round(wrapped * fftSize) % fftSize;
}
