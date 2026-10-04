/** Screen velocities share the sign convention of the displayed capture. */
export function velocityRuler(nyquistCms: number, baselineShift: number, invert: boolean, height: number) {
  const offset = 2 * nyquistCms * baselineShift * (invert ? -1 : 1);
  const top = nyquistCms + offset;
  const bottom = -nyquistCms + offset;
  if (!(nyquistCms > 0) || !Number.isFinite(top + bottom) || !(height > 0)) return { top, bottom, ticks: [] };
  const target = (2 * nyquistCms) / Math.max(2, Math.floor(height / 30));
  const decade = 10 ** Math.floor(Math.log10(target));
  const step = ([1, 2, 5, 10].find((n) => n * decade >= target) ?? 10) * decade;
  const ticks: { value: number; row: number; major: boolean }[] = [];
  const minor = step / 2;
  for (let i = Math.ceil(bottom / minor); i <= Math.floor(top / minor); i++) {
    const value = i === 0 ? 0 : i * minor;
    ticks.push({ value, row: ((top - value) / (2 * nyquistCms)) * height, major: i % 2 === 0 });
  }
  // PRF is rounded to integer Hz: bounds seldom coincide exactly with nice ticks.
  // Keep truthful positions, label both bounds, and avoid crowding the zero label.
  const zeroRow = (top / (2 * nyquistCms)) * height;
  for (const tick of ticks) if (tick.value !== 0 && (tick.row < 18 || tick.row > height - 18)) tick.major = false;
  if (ticks.every((t) => t.row > 1e-6)) ticks.push({ value: top, row: 0, major: zeroRow > 18 });
  else ticks.find((t) => t.row <= 1e-6)!.major = zeroRow > 18;
  if (ticks.every((t) => t.row < height - 1e-6)) ticks.push({ value: bottom, row: height, major: height - zeroRow > 18 });
  else ticks.find((t) => t.row >= height - 1e-6)!.major = height - zeroRow > 18;
  return { top, bottom, ticks };
}

/** Independent gutter: never covers the acquired spectrum or shifts it relative to ECG. */
export function drawVelocityRuler(canvas: HTMLCanvasElement, nyquistCms: number, baselineShift: number, invert: boolean): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const ratio = canvas.width / (canvas.clientWidth || canvas.width);
  const width = canvas.width / ratio,
    height = canvas.height / ratio;
  const axis = velocityRuler(nyquistCms, baselineShift, invert, height);
  ctx.save();
  ctx.scale(ratio, ratio);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  for (const tick of axis.ticks) {
    ctx.fillStyle = ctx.strokeStyle = tick.value === 0 ? '#e3ede8' : '#aab8c5';
    ctx.beginPath();
    ctx.moveTo(0, tick.row);
    ctx.lineTo(tick.major ? 7 : 4, tick.row);
    ctx.stroke();
    if (tick.major)
      ctx.fillText(
        tick.value === 0 ? '0 cm/s' : `${Number(tick.value.toFixed(nyquistCms < 5 ? 1 : 0))}`,
        8,
        Math.max(7, Math.min(height - 7, tick.row)),
      );
  }
  ctx.restore();
  const label = `Escala PW en cm/s: ${axis.bottom.toFixed(1)} a ${axis.top.toFixed(1)}, cero en la línea de base`;
  if (canvas.getAttribute('aria-label') !== label) canvas.setAttribute('aria-label', label);
}
