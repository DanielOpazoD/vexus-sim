import { presentationPower, spectralGrey, type SpectralPresentation } from './spectralPresentation';
import { spectralAxis, spectralBinAt, spectralTicks } from './spectralAxis';
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
  pixelRatio = 1,
  baselineShift = 0,
  presentation: SpectralPresentation = { gainDb: 0, dynamicRangeDb: 45 },
): void {
  const axis = spectralAxis(scaleCms, baselineShift);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width,
    H = canvas.height,
    plotH = Math.max(1, Math.round(H - 24 * pixelRatio)),
    plotW = Math.max(1, Math.round(W - 58 * pixelRatio));
  const span = Math.max(0.004, end - start);
  const xOf = (t: number) => ((t - start) / span) * plotW;
  const bitmap = ctx.createImageData(plotW, plotH);
  for (let i = 3; i < bitmap.data.length; i += 4) bitmap.data[i] = 255;
  for (let c = 0; c < columns.length; c++) {
    const col = columns[c];
    if (col.t < start || col.t > end) continue;
    const hopS = 16 / col.prfHz;
    const x0 = Math.max(0, Math.floor(xOf(col.t - hopS / 2)));
    const x1 = Math.min(plotW, Math.ceil(xOf(col.t + hopS / 2)));
    const power = presentationPower(columns, c);
    const n = power.length;
    for (let y = 0; y < plotH; y++) {
      const k = spectralBinAt((y + 0.5) / plotH, n, baselineShift);
      const value = spectralGrey(power[k], presentation);
      for (let x = x0; x < x1; x++) {
        const p = (y * plotW + x) * 4;
        bitmap.data[p] = value;
        bitmap.data[p + 1] = value;
        bitmap.data[p + 2] = value;
      }
    }
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.putImageData(bitmap, 0, 0);
  ctx.strokeStyle = '#efdc72';
  ctx.lineWidth = 1.5 * pixelRatio;
  ctx.beginPath();
  ctx.moveTo(0, plotH * axis.zeroFraction);
  ctx.lineTo(plotW, plotH * axis.zeroFraction);
  ctx.stroke();
  ctx.font = `${13 * pixelRatio}px sans-serif`;
  ctx.fillStyle = '#d7e0e5';
  const labelX = plotW + 4 * pixelRatio;
  ctx.fillText(`+${axis.maxCms.toFixed(0)}`, labelX, 13 * pixelRatio);
  ctx.fillText(`${axis.minCms.toFixed(0)}`, labelX, plotH - 3 * pixelRatio);
  for (const value of spectralTicks(scaleCms, baselineShift)) {
    const y = plotH * axis.fractionOf(value);
    if (y < 24 * pixelRatio || y > plotH - 18 * pixelRatio) continue;
    ctx.fillStyle = value === 0 ? '#efdc72' : '#d7e0e5';
    ctx.fillText(value === 0 ? '0' : `${value > 0 ? '+' : ''}${value}`, labelX, y + 4 * pixelRatio);
    ctx.fillRect(plotW - 4 * pixelRatio, y, 4 * pixelRatio, pixelRatio);
  }
  ctx.fillStyle = '#d7e0e5';
  ctx.fillText('cm/s', labelX, H - 5 * pixelRatio);
  for (let t = Math.ceil(start); t <= end; t++) {
    const label = `${t}s`,
      x = xOf(t) + 2 * pixelRatio;
    if (x + ctx.measureText(label).width < plotW) ctx.fillText(label, x, H - 5 * pixelRatio);
  }
  ctx.fillStyle = '#ffd166';
  for (const mark of marks) {
    if (mark.t < start || mark.t > end || mark.vScreen <= axis.minCms || mark.vScreen >= axis.maxCms) continue;
    const x = xOf(mark.t),
      y = plotH * axis.fractionOf(mark.vScreen);
    ctx.fillText(
      mark.label,
      Math.max(2 * pixelRatio, Math.min(plotW - 40 * pixelRatio, x)),
      Math.max(
        14 * pixelRatio,
        Math.min(plotH - 3 * pixelRatio, y + (mark.label === 'Vmín' || mark.label === 'mín' ? 16 : -5) * pixelRatio),
      ),
    );
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
