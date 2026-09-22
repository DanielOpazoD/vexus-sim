import type { Simulator } from '../app/simulator';
import type { SpectralColumn } from '../doppler/spectral';
import { velocityFromShiftMmS } from '../core/units';

/** Gráficos vectoriales sobre el sector: regla, marcador, foco, cuadro, puerta. */
export function drawOverlay(canvas: HTMLCanvasElement, sim: Simulator): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
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
  const fp = sim.renderer.beamToPixel(edgeTheta, sim.bmode.focusMm, tr);
  ctx.fillStyle = '#e0a33b';
  ctx.beginPath();
  ctx.moveTo(fp.x + 2, fp.y);
  ctx.lineTo(fp.x - 5, fp.y - 4);
  ctx.lineTo(fp.x - 5, fp.y + 4);
  ctx.closePath();
  ctx.fill();
  // Cuadro de color
  if (sim.color.enabled) {
    const c = sim.color;
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

/** Tira de ECG desplazable, con el mismo reloj que el espectro. */
export function drawEcg(canvas: HTMLCanvasElement, sim: Simulator, secondsVisible: number, tRight: number): void {
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
    const x = ((s.t - tLeft) / secondsVisible) * W;
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
    const x = ((s.t - tLeft) / secondsVisible) * W;
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
}

/** Estado de dibujo del espectrograma (bitmap desplazable). */
export class SpectrogramView {
  private img: ImageData | null = null;
  private lastDrawnT = -1;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  constructor(private readonly canvas: HTMLCanvasElement) {
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d')!;
  }

  reset(): void {
    this.lastDrawnT = -1;
    this.img = null;
  }

  /**
   * Dibuja columnas nuevas desde `columns` a la velocidad de barrido dada.
   * El eje vertical es la banda [−PRF/2, PRF/2] desplazada por la línea de
   * base; la velocidad rotulada usa la corrección angular del usuario.
   */
  draw(sim: Simulator, columns: readonly SpectralColumn[], tNow: number, secondsVisible: number): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (this.off.width !== W || this.off.height !== H) {
      this.off.width = W;
      this.off.height = H;
      this.img = null;
      this.lastDrawnT = -1;
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
    // Columnas nuevas → píxeles
    const fft = sim.spectral.fftSize;
    const newCols = columns.filter((c) => c.t > this.lastDrawnT);
    if (newCols.length) {
      const dtCol = sim.spectral.hop / pw.prfHz;
      const colPx = Math.max(1, Math.round(dtCol * pxPerSec));
      const shiftPx = newCols.length * colPx;
      // desplazar el bitmap a la izquierda
      this.offCtx.drawImage(this.off, -shiftPx, 0);
      for (let ci = 0; ci < newCols.length; ci++) {
        const col = newCols[ci];
        const x0 = W - (newCols.length - ci) * colPx;
        const strip = this.offCtx.createImageData(colPx, H);
        for (let y = 0; y < H; y++) {
          // y=0 arriba ↔ frecuencia máxima de la banda mostrada
          let fracBand = 1 - y / H; // 0..1 de abajo a arriba
          if (pw.invert) fracBand = 1 - fracBand;
          // banda mostrada: [−PRF/2 + shift·PRF, PRF/2 + shift·PRF]
          const f = (fracBand - 0.5 + pw.baselineShift) * col.prfHz;
          // plegar a la banda medida (la línea de base no crea muestras)
          const fw = ((((f + col.prfHz / 2) % col.prfHz) + col.prfHz) % col.prfHz) - col.prfHz / 2;
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
      this.lastDrawnT = newCols[newCols.length - 1].t;
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
    void tNow;
  }
}
