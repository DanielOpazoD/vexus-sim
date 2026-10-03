import type { SpectralColumn } from '../doppler/spectral';
import type { CaptureMark } from '../doppler/spectralMeasure';

/** Paint measured STFT power, without filling under an envelope or adding image noise. */
export function drawVenousSpectrum(
  canvas: HTMLCanvasElement,
  columns: readonly SpectralColumn[],
  start: number,
  end: number,
  scaleCms: number,
  marks: readonly CaptureMark[],
  cursorT: number | null,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width,
    H = canvas.height,
    plotH = H - 24;
  const span = Math.max(0.004, end - start);
  const xOf = (t: number) => ((t - start) / span) * W;
  const bitmap = ctx.createImageData(W, plotH);
  for (let i = 3; i < bitmap.data.length; i += 4) bitmap.data[i] = 255;
  for (let c = 0; c < columns.length; c++) {
    const col = columns[c];
    if (col.t < start || col.t > end) continue;
    const hopS = 16 / col.prfHz;
    const x0 = Math.max(0, Math.floor(xOf(col.t - hopS / 2)));
    const x1 = Math.min(W, Math.ceil(xOf(col.t + hopS / 2)));
    const n = col.powerDb.length;
    for (let y = 0; y < plotH; y++) {
      const k = Math.min(n - 1, Math.max(0, Math.floor((1 - y / plotH) * n)));
      const value = Math.round(255 * Math.pow(Math.max(0, Math.min(1, (col.powerDb[k] + 52) / 45)), 1.4));
      for (let x = x0; x < x1; x++) {
        const p = (y * W + x) * 4;
        bitmap.data[p] = value;
        bitmap.data[p + 1] = value;
        bitmap.data[p + 2] = value;
      }
    }
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.putImageData(bitmap, 0, 0);
  ctx.strokeStyle = '#8b969f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, plotH / 2);
  ctx.lineTo(W, plotH / 2);
  ctx.stroke();
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#d7e0e5';
  for (const [y, text] of [
    [15, `+${scaleCms}`],
    [plotH / 2 - 3, '0'],
    [plotH - 4, `−${scaleCms} cm/s`],
  ] as const) {
    ctx.fillText(text, W - 80, y);
  }
  for (let t = Math.ceil(start); t <= end; t++) ctx.fillText(`${t}s`, xOf(t) + 2, H - 5);
  ctx.fillStyle = '#ffd166';
  for (const mark of marks) {
    if (mark.t < start || mark.t > end || Math.abs(mark.vScreen) >= scaleCms) continue;
    const x = xOf(mark.t),
      y = (plotH / 2) * (1 - mark.vScreen / scaleCms);
    ctx.fillText(mark.label, Math.max(2, Math.min(W - 22, x)), Math.max(14, Math.min(plotH - 3, y - 5)));
  }
  if (cursorT !== null) {
    ctx.strokeStyle = '#66ddff';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(xOf(cursorT), 0);
    ctx.lineTo(xOf(cursorT), plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
