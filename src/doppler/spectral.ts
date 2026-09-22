import { FFT, hannWindow } from '../core/fft';

/**
 * Espectrograma Doppler pulsado: P(m,k) = |STFT{z}(m,k)|² (base D.8). Cada
 * columna lleva el instante de adquisición de su centro de ventana (reloj de
 * simulación) para alinearse con ECG y respiración. El brillo se resuelve
 * después (ganancia, compresión y persistencia) en la presentación: aquí solo
 * hay potencia en dB, sin interpolación que finja resolución.
 */
export interface SpectralColumn {
  /** Tiempo de simulación del centro de la ventana (s). */
  t: number;
  /** Potencia en dB por bin, con fftshift: índice 0 ↔ −PRF/2, N/2 ↔ 0 Hz. */
  powerDb: Float32Array;
  prfHz: number;
}

export class SpectralProcessor {
  readonly fftSize: number;
  readonly hop: number;
  private fft: FFT;
  private window: Float32Array;
  private bufRe: Float32Array;
  private bufIm: Float32Array;
  private filled = 0;
  private sampleIndex = 0;
  private workRe: Float32Array;
  private workIm: Float32Array;
  readonly columns: SpectralColumn[] = [];
  private maxColumns: number;
  private t0 = 0;
  private prfHz = 2500;

  constructor(opts: { fftSize?: number; hop?: number; maxColumns?: number } = {}) {
    this.fftSize = opts.fftSize ?? 128;
    this.hop = opts.hop ?? 16;
    this.maxColumns = opts.maxColumns ?? 2048;
    this.fft = new FFT(this.fftSize);
    this.window = hannWindow(this.fftSize);
    this.bufRe = new Float32Array(this.fftSize);
    this.bufIm = new Float32Array(this.fftSize);
    this.workRe = new Float32Array(this.fftSize);
    this.workIm = new Float32Array(this.fftSize);
  }

  /** Fija el tiempo de simulación del próximo índice de muestra y la PRF. */
  sync(tNextSample: number, prfHz: number): void {
    if (prfHz !== this.prfHz) {
      this.prfHz = prfHz;
      this.filled = 0;
    }
    this.t0 = tNextSample - this.sampleIndex / prfHz;
  }

  push(re: Float32Array, im: Float32Array, n: number): void {
    const N = this.fftSize;
    for (let i = 0; i < n; i++) {
      // Buffer circular deslizante: desplazamos de hop en hop.
      if (this.filled === N) {
        this.bufRe.copyWithin(0, this.hop);
        this.bufIm.copyWithin(0, this.hop);
        this.filled = N - this.hop;
      }
      this.bufRe[this.filled] = re[i];
      this.bufIm[this.filled] = im[i];
      this.filled++;
      this.sampleIndex++;
      if (this.filled === N) this.emit();
    }
  }

  private emit(): void {
    const N = this.fftSize;
    for (let i = 0; i < N; i++) {
      this.workRe[i] = this.bufRe[i] * this.window[i];
      this.workIm[i] = this.bufIm[i] * this.window[i];
    }
    this.fft.forward(this.workRe, this.workIm);
    const power = new Float32Array(N);
    const half = N >> 1;
    for (let k = 0; k < N; k++) {
      const src = (k + half) % N; // fftshift
      const p = this.workRe[src] * this.workRe[src] + this.workIm[src] * this.workIm[src];
      power[k] = 10 * Math.log10(p + 1e-20);
    }
    // Centro de la ventana: la muestra sampleIndex − N/2
    const tCenter = this.t0 + (this.sampleIndex - half) / this.prfHz;
    this.columns.push({ t: tCenter, powerDb: power, prfHz: this.prfHz });
    if (this.columns.length > this.maxColumns) this.columns.splice(0, this.columns.length - this.maxColumns);
  }

  /** Frecuencia (Hz) del bin k con fftshift. */
  binFrequency(k: number, prfHz = this.prfHz): number {
    return ((k - (this.fftSize >> 1)) * prfHz) / this.fftSize;
  }

  reset(): void {
    this.filled = 0;
    this.columns.length = 0;
  }
}

export interface EnvelopePoint {
  t: number;
  /** Frecuencia máxima con señal en el semiplano positivo (Hz) o 0. */
  fPos: number;
  /** Frecuencia mínima (negativa) con señal en el semiplano negativo (Hz) o 0. */
  fNeg: number;
  powerPosDb: number;
  powerNegDb: number;
  /** Frecuencia de la envolvente dominante con signo (Hz). */
  fEnvelope: number;
}

/**
 * Envolvente de máxima frecuencia por dirección: primer bin, desde el
 * extremo, cuya potencia supera el suelo de ruido más un margen. Refleja lo
 * que traza un calibrador automático; depende de ganancia y ruido, como en un
 * equipo real.
 */
export function columnEnvelope(col: SpectralColumn, fftSize: number, thresholdDb: number): EnvelopePoint {
  const N = fftSize;
  const half = N >> 1;
  const df = col.prfHz / N;
  let fPos = 0;
  let fNeg = 0;
  let pPos = -200;
  let pNeg = -200;
  for (let k = N - 1; k > half; k--) {
    if (col.powerDb[k] > thresholdDb) {
      fPos = (k - half) * df;
      break;
    }
  }
  for (let k = 0; k < half; k++) {
    if (col.powerDb[k] > thresholdDb) {
      fNeg = (k - half) * df;
      break;
    }
  }
  for (let k = half + 1; k < N; k++) pPos = Math.max(pPos, col.powerDb[k]);
  for (let k = 0; k < half; k++) pNeg = Math.max(pNeg, col.powerDb[k]);
  // Dominancia por energía integrada (lineal) en cada semiplano.
  let ePos = 0;
  let eNeg = 0;
  for (let k = half + 2; k < N; k++) ePos += Math.pow(10, col.powerDb[k] / 10);
  for (let k = 0; k < half - 1; k++) eNeg += Math.pow(10, col.powerDb[k] / 10);
  const fEnvelope = ePos >= eNeg ? fPos : fNeg;
  return { t: col.t, fPos, fNeg, powerPosDb: pPos, powerNegDb: pNeg, fEnvelope };
}

/** Frecuencia del bin de máxima potencia de una columna (Hz). */
export function peakFrequency(col: SpectralColumn, fftSize: number): number {
  let best = 0;
  for (let k = 1; k < fftSize; k++) if (col.powerDb[k] > col.powerDb[best]) best = k;
  return ((best - (fftSize >> 1)) * col.prfHz) / fftSize;
}

/** Suelo de ruido estimado como mediana de una columna (dB). */
export function noiseFloorDb(col: SpectralColumn): number {
  const arr = Array.from(col.powerDb).sort((a, b) => a - b);
  return arr[arr.length >> 1];
}
