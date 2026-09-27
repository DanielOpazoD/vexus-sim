import { ecgX, SweepTimeline } from './sweep';
import { drawCursor } from './mModeView';
import { nyquistVelocityCms, wrapToNyquist } from '../core/units';
import type { Simulator } from '../app/simulator';
import type { SpectralColumn } from '../doppler/spectral';
import { velocityFromShiftMmS } from '../core/units';
import { overlayOnSpectrum, spectrumRowOf, type CaptureOverlay } from './captureOverlay';

/**
 * Gráficos vectoriales sobre el sector: regla, marcador, foco, cuadro, puerta y línea M. La regla, el foco y la caja
 * son los de la imagen en pantalla (con el cine, los de su cuadro: decisión 80).
 */
export function drawOverlay(canvas: HTMLCanvasElement, sim: Simulator): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const tr = sim.transducer;
  const shown = sim.displayed;
  const depth = shown.bmode.depthMm;
  // Regla de profundidad (cada cm) en el borde derecho del sector
  ctx.strokeStyle = '#9aa7b4';
  ctx.fillStyle = '#9aa7b4';
  ctx.lineWidth = 1;
  ctx.font = '11px sans-serif';
  const edgeTheta = -tr.halfSector;
  for (let cm = 0; cm <= depth / 10; cm++) {
    const r = cm * 10;
    const p = sim.renderer.beamToPixel(edgeTheta, r, tr);
    const big = cm % 5 === 0;
    ctx.beginPath();
    ctx.moveTo(p.x + 6, p.y);
    ctx.lineTo(p.x + (big ? 14 : 10), p.y);
    ctx.stroke();
    if (big) ctx.fillText(`${cm}`, p.x + 17, p.y + 4);
  }
  // Marcador de orientación (izquierda de pantalla)
  const mk = sim.renderer.beamToPixel(tr.halfSector, 0, tr);
  ctx.fillStyle = '#3fb6a8';
  ctx.beginPath();
  ctx.arc(mk.x - 10, mk.y - 6, 5, 0, Math.PI * 2);
  ctx.fill();
  // Foco
  const fp = sim.renderer.beamToPixel(edgeTheta, shown.bmode.focusMm, tr);
  ctx.fillStyle = '#e0a33b';
  ctx.beginPath();
  ctx.moveTo(fp.x + 2, fp.y);
  ctx.lineTo(fp.x - 5, fp.y - 4);
  ctx.lineTo(fp.x - 5, fp.y + 4);
  ctx.closePath();
  ctx.fill();
  // Cuadro de color
  if (shown.color.enabled) {
    const c = shown.color;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const th = c.theta0 + ((c.theta1 - c.theta0) * i) / steps;
      const p = sim.renderer.beamToPixel(th, c.r0, tr);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let i = steps; i >= 0; i--) {
      const th = c.theta0 + ((c.theta1 - c.theta0) * i) / steps;
      const p = sim.renderer.beamToPixel(th, c.r1, tr);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
    drawColorScale(ctx, W, H, sim);
  }
  // Línea M (decisión 80): de la cara al fondo, con un asa arriba para arrastrarla
  if (sim.mmode.enabled) {
    const a = sim.renderer.beamToPixel(sim.mmode.theta, 0, tr);
    const b = sim.renderer.beamToPixel(sim.mmode.theta, depth, tr);
    ctx.strokeStyle = ctx.fillStyle = '#ffc857';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(a.x + (b.x - a.x) * 0.04, a.y + (b.y - a.y) * 0.04, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Cursor PW: línea Doppler, puerta y cursor angular
  if (sim.pw.enabled) {
    const pw = sim.pw;
    const a = sim.renderer.beamToPixel(pw.theta, 0, tr);
    const b = sim.renderer.beamToPixel(pw.theta, depth, tr);
    ctx.strokeStyle = 'rgba(120, 220, 200, 0.8)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const g0 = sim.renderer.beamToPixel(pw.theta, pw.depthMm - pw.gateMm / 2, tr);
    const g1 = sim.renderer.beamToPixel(pw.theta, pw.depthMm + pw.gateMm / 2, tr);
    const nx = -(b.y - a.y);
    const ny = b.x - a.x;
    const nl = Math.hypot(nx, ny) || 1;
    const ux = (nx / nl) * 7;
    const uy = (ny / nl) * 7;
    ctx.strokeStyle = '#7ff0d8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(g0.x - ux, g0.y - uy);
    ctx.lineTo(g0.x + ux, g0.y + uy);
    ctx.moveTo(g1.x - ux, g1.y - uy);
    ctx.lineTo(g1.x + ux, g1.y + uy);
    ctx.stroke();
    // Cursor de corrección angular
    const gc = sim.renderer.beamToPixel(pw.theta, pw.depthMm, tr);
    const beamAng = Math.atan2(b.y - a.y, b.x - a.x);
    const ang = beamAng + pw.angleCorrection;
    ctx.strokeStyle = '#7ff0d8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gc.x - Math.cos(ang) * 22, gc.y - Math.sin(ang) * 22);
    ctx.lineTo(gc.x + Math.cos(ang) * 22, gc.y + Math.sin(ang) * 22);
    ctx.stroke();
  }
}

/** Tira de ECG desplazable, con el mismo reloj que el espectro; con el cine, el cursor de su cuadro (decisión 80). */
export function drawEcg(
  canvas: HTMLCanvasElement,
  sim: Simulator,
  secondsVisible: number,
  tRight: number,
  cursorT: number | null = null,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const samples = sim.physiology.samples;
  const tLeft = tRight - secondsVisible;
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  let started = false;
  for (const s of samples) {
    if (s.t < tLeft) continue;
    if (s.t > tRight) break;
    const x = ecgX(s.t, tRight, secondsVisible, W);
    const y = H * 0.75 - s.ecgMv * H * 0.45;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Marca respiratoria: volumen
  ctx.strokeStyle = 'rgba(120,160,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  started = false;
  for (const s of samples) {
    if (s.t < tLeft) continue;
    if (s.t > tRight) break;
    const x = ecgX(s.t, tRight, secondsVisible, W);
    const y = H * 0.92 - s.resp.volume * H * 0.3;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#6b7a88';
  ctx.font = '10px sans-serif';
  ctx.fillText('ECG · resp', 6, 11);
  if (cursorT !== null) drawCursor(ctx, ecgX(cursorT, tRight, secondsVisible, W), H);
}

/** Estado de dibujo del espectrograma (bitmap desplazable). */
export class SpectrogramView {
  private img: ImageData | null = null;
  private lastDrawnT = -1;
  /** Eje temporal compartido con el ECG (ver `ui/sweep.ts`). */
  private readonly timeline = new SweepTimeline();
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  constructor(private readonly canvas: HTMLCanvasElement) {
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d')!;
  }

  reset(): void {
    this.lastDrawnT = -1;
    this.img = null;
    this.timeline.reset();
  }

  /**
   * Dibuja columnas nuevas desde `columns` a la velocidad de barrido dada.
   * El eje vertical es la banda [−PRF/2, PRF/2] desplazada por la línea de
   * base; la velocidad rotulada usa la corrección angular del usuario.
   */
  draw(
    sim: Simulator,
    columns: readonly SpectralColumn[],
    tNow: number,
    secondsVisible: number,
    cursorT: number | null = null,
    capture: CaptureOverlay | null = null,
  ): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (this.off.width !== W || this.off.height !== H) {
      this.off.width = W;
      this.off.height = H;
      this.img = null;
      this.lastDrawnT = -1;
      this.timeline.reset();
    }
    const pw = sim.pw;
    const pxPerSec = W / secondsVisible;
    if (!pw.enabled) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#6b7a88';
      ctx.font = '11px sans-serif';
      ctx.fillText('Doppler pulsado desactivado — pulse PW y coloque la puerta en un vaso', 8, 16);
      return;
    }
    // Eje temporal: desplazar el mapa de bits lo que avanzó el tiempo (píxeles enteros, con resto)
    const { shiftPx, cleared } = this.timeline.advance(tNow, pxPerSec);
    if (cleared) {
      this.offCtx.fillStyle = '#000';
      this.offCtx.fillRect(0, 0, W, H);
      this.lastDrawnT = tNow - secondsVisible;
    } else if (shiftPx > 0) {
      this.offCtx.drawImage(this.off, -shiftPx, 0);
      this.offCtx.fillStyle = '#000';
      this.offCtx.fillRect(W - shiftPx, 0, shiftPx, H);
    }
    // Columnas nuevas → el tramo de píxeles de su intervalo de tiempo
    const fft = sim.spectral.fftSize;
    const dtCol = sim.spectral.hop / pw.prfHz;
    for (const col of columns) {
      if (col.t <= this.lastDrawnT) continue;
      if (!this.timeline.ready(col.t, dtCol)) break;
      const [x0, x1] = this.timeline.span(col.t, dtCol, pxPerSec, W);
      this.lastDrawnT = col.t;
      const colPx = x1 - x0;
      if (colPx <= 0) continue;
      const strip = this.offCtx.createImageData(colPx, H);
      for (let y = 0; y < H; y++) {
        // y=0 arriba ↔ frecuencia máxima de la banda mostrada
        let fracBand = 1 - y / H; // 0..1 de abajo a arriba
        if (pw.invert) fracBand = 1 - fracBand;
        // banda mostrada: [−PRF/2 + shift·PRF, PRF/2 + shift·PRF]
        const f = (fracBand - 0.5 + pw.baselineShift) * col.prfHz;
        // plegar a la banda medida (la línea de base no crea muestras)
        const fw = wrapToNyquist(f, col.prfHz);
        const k = Math.round((fw / col.prfHz) * fft + fft / 2);
        const kk = Math.min(fft - 1, Math.max(0, k));
        const db = col.powerDb[kk];
        // Mapeo de brillo: 45 dB de rango sobre el suelo de ruido a ganancia 0 (la
        // ganancia ya multiplica la IQ, así que el ruido sube con ella).
        let g = (db + 52) / 45;
        g = Math.max(0, Math.min(1, g));
        g = Math.pow(g, 1.4);
        const v = Math.round(g * 255);
        for (let x = 0; x < colPx; x++) {
          const idx = (y * colPx + x) * 4;
          strip.data[idx] = v;
          strip.data[idx + 1] = Math.round(v * 0.95);
          strip.data[idx + 2] = Math.round(v * 0.75);
          strip.data[idx + 3] = 255;
        }
      }
      this.offCtx.putImageData(strip, x0, 0);
    }
    ctx.drawImage(this.off, 0, 0);
    // Línea de base y escala
    const baselineY = (() => {
      let frac = 0.5 - pw.baselineShift; // posición de f=0 dentro de la banda, de abajo a arriba
      if (pw.invert) frac = 1 - frac;
      return H * (1 - frac);
    })();
    ctx.strokeStyle = 'rgba(160,180,200,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baselineY);
    ctx.lineTo(W, baselineY);
    ctx.stroke();
    ctx.fillStyle = '#9aa7b4';
    ctx.font = '10px sans-serif';
    const nyq = sim.pwNyquistCms();
    const topF = (0.5 + pw.baselineShift) * pw.prfHz * (pw.invert ? -1 : 1);
    const botF = (-0.5 + pw.baselineShift) * pw.prfHz * (pw.invert ? -1 : 1);
    const toCms = (f: number) => velocityFromShiftMmS(f, sim.transducer.f0Doppler, pw.angleCorrection) / 10;
    ctx.fillText(`${toCms(topF).toFixed(0)} cm/s`, W - 60, 11);
    ctx.fillText(`${toCms(botF).toFixed(0)} cm/s`, W - 60, H - 4);
    ctx.fillText(
      `Nyquist ±${nyq.toFixed(0)} cm/s · PRF ${pw.prfHz} Hz · WF ${pw.wallFilterHz} Hz · ${pw.sweepMmS} mm/s · θ ${((pw.angleCorrection * 180) / Math.PI).toFixed(0)}°${pw.invert ? ' · INV' : ''}`,
      6,
      H - 4,
    );
    // Escala de tiempo (1 s)
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    for (let s = 0; s < secondsVisible; s++) {
      const x = W - s * pxPerSec;
      ctx.beginPath();
      ctx.moveTo(x, H - 8);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    if (capture && overlayOnSpectrum(capture, columns))
      drawCaptureOverlay(ctx, capture, (t) => ecgX(t, this.timeline.rightT, secondsVisible, W), H);
    if (cursorT !== null) drawCursor(ctx, ecgX(cursorT, this.timeline.rightT, secondsVisible, W), H);
  }
}

/**
 * Lo medido en la última captura sobre el espectro (decisión 93): los latidos analizados (corchetes arriba), la traza
 * automática y, si la captura vale, sus marcas. La traza de una captura rechazada va en otro color.
 */
function drawCaptureOverlay(ctx: CanvasRenderingContext2D, o: CaptureOverlay, xOf: (t: number) => number, H: number): void {
  const yOf = (f: number) => spectrumRowOf(f, o.prfHz, o.display, H);
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(92,200,255,0.8)';
  for (const [t0, t1] of o.beats) {
    const x0 = xOf(t0);
    const x1 = xOf(t1);
    ctx.beginPath();
    ctx.moveTo(x0 + 1, 22);
    ctx.lineTo(x0 + 1, 16);
    ctx.lineTo(x1 - 1, 16);
    ctx.lineTo(x1 - 1, 22);
    ctx.stroke();
  }
  ctx.strokeStyle = o.accepted ? '#ffd166' : '#ff8a8a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let pen = false;
  let lastY = 0;
  for (const p of o.trace) {
    if (!Number.isFinite(p.fHz)) {
      pen = false;
      continue;
    }
    const x = xOf(p.t);
    const y = yOf(p.fHz);
    // donde la traza se pliega por la línea de base salta de un borde al otro: no se une
    if (pen && Math.abs(y - lastY) < H / 2) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    pen = true;
    lastY = y;
  }
  ctx.stroke();
  if (o.accepted) {
    ctx.font = '10px sans-serif';
    for (const m of o.marks) {
      const x = xOf(m.t);
      const y = yOf(m.fHz);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = '#ffd166';
      ctx.fillText(m.label, x + 4, y < 14 ? y + 12 : y - 4);
    }
  }
  ctx.restore();
}

/**
 * Mapa del color de la conversión de barrido (FRAG_SCANCONVERT): hacia la sonda de rojo oscuro a amarillo, desde la
 * sonda de azul a celeste, negro en cero. `mag` ∈ [0, 1] es |f| / Nyquist.
 */
export function colorMapRgb(towardProbe: boolean, mag: number): [number, number, number] {
  const m = Math.min(1, Math.max(0, mag));
  const a: [number, number, number] = towardProbe ? [0.55, 0.05, 0] : [0, 0.1, 0.6];
  const b: [number, number, number] = towardProbe ? [1, 0.95, 0.35] : [0.35, 0.95, 1];
  return [0, 1, 2].map((k) => Math.round(255 * (a[k] + (b[k] - a[k]) * m))) as [number, number, number];
}

/**
 * Barra de escala del color (decisión 70), como en los equipos: arriba el flujo hacia la sonda, abajo el que se aleja,
 * negro en la línea de base y ±Nyquist en cm/s en los extremos (con «Invertir mapa» se intercambian los colores).
 */
function drawColorScale(ctx: CanvasRenderingContext2D, W: number, H: number, sim: Simulator): void {
  const nyq = Math.round(nyquistVelocityCms(sim.displayed.color.prfHz, sim.transducer.f0Doppler));
  const s = H / 800;
  const x = Math.round(12 * s);
  const w = Math.max(6, Math.round(9 * s));
  const y0 = Math.round(H * 0.16);
  const h = Math.round(H * 0.22);
  const inv = sim.displayed.color.invert;
  for (let i = 0; i < h; i++) {
    // i = 0 arriba (+Nyquist, hacia la sonda); h/2 la línea de base
    const v = 1 - (2 * i) / (h - 1);
    const toward = v >= 0 !== inv;
    const [r, g, b] = Math.abs(v) < 0.02 ? [0, 0, 0] : colorMapRgb(toward, Math.abs(v));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y0 + i, w, 1);
  }
  ctx.strokeStyle = '#6b7684';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y0 - 0.5, w + 1, h + 1);
  ctx.fillStyle = '#c9d2dc';
  ctx.font = `${Math.round(11 * s)}px sans-serif`;
  ctx.fillText(`+${nyq}`, x + w + 4, y0 + Math.round(9 * s));
  ctx.fillText(`−${nyq}`, x + w + 4, y0 + h);
  ctx.fillText('cm/s', x + w + 4, y0 + Math.round(h / 2 + 4 * s));
}
