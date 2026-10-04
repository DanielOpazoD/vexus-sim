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
export function spectralBinAt(rowFraction: number, fftSize: number, baselineShift: number, invert = false): number {
  const binFraction = invert ? rowFraction - baselineShift : 1 - rowFraction + baselineShift;
  const wrapped = ((binFraction % 1) + 1) % 1;
  return Math.round(wrapped * fftSize) % fftSize;
}

/** Major ticks in velocity units, independent of the acquired spectrum. */
export function spectralTicks(nyquistCms: number, baselineShift: number): number[] {
  const axis = spectralAxis(nyquistCms, baselineShift);
  const target = (axis.maxCms - axis.minCms) / 5;
  const order = 10 ** Math.floor(Math.log10(target));
  const scaled = target / order;
  const step = order * (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10);
  const ticks: number[] = [];
  for (let n = Math.ceil(axis.minCms / step); n <= Math.floor(axis.maxCms / step); n++) ticks.push(n === 0 ? 0 : n * step);
  return ticks;
}
