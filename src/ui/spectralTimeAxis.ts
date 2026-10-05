/** Display time in seconds; independent of PRF, FFT duration and physiological heart rate. */
export function spectralTimeAxis(end: number, visibleSeconds: number) {
  if (!Number.isFinite(end) || end < 0 || !Number.isFinite(visibleSeconds) || visibleSeconds < 0.004)
    throw new RangeError('Invalid spectral time axis');
  const start = Math.max(0, end - visibleSeconds);
  const span = Math.max(0.004, end - start);
  return { start, end, span, fractionOf: (time: number) => (time - start) / span };
}
