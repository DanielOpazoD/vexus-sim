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
/**
 * Envolvente de frecuencia máxima (decisión 44), como la traza un equipo: (1) solo
 * cuentan los bins significativos (> suelo + 6 dB; el periodograma del ruido supera 4×
 * su media con probabilidad e⁻⁴ ≈ 2 %); (2) en cada semiplano la banda espectral es la
 * región CONTIGUA a la línea de base (se corta tras 3 bins seguidos no significativos),
 * así los bins de ruido aislados lejos de la banda no cuentan; (3) se elige el semiplano
 * con más energía en su banda; (4) la envolvente es la frecuencia donde la potencia
 * acumulada desde la continua alcanza la fracción `pct` de la banda (método del
 * percentil). Devuelve 0 si ningún bin supera el suelo en `detectDb`.
 */
const SIGNIFICANT_DB = 6;
const BAND_GAP_BINS = 3;
/**
 * Hueco tolerado en la banda de `halfPlaneEnvelopeHz` (Hz): 3 bins a la PRF por defecto (2600 Hz). A PRF 1300 la
 * ventana de la FFT dura 98 ms, el bin mide 10 Hz y el moteado espectral parte la banda de la porta en dos; con 3 bins
 * la envolvente saltaba de una parte a otra y la PF de la cirrosis (verdad 35 %) salía 42–50 %.
 */
const BAND_GAP_HZ = 60;

/** Envolventes de ambos semiplanos (Hz, ≥ 0) y energía de sus bandas contiguas. */
export interface BandEnvelopes {
  posHz: number;
  negHz: number;
  ePos: number;
  eNeg: number;
  detected: boolean;
}

export function columnBandEnvelopes(col: SpectralColumn, fftSize: number, floorDb: number, detectDb = 12, pct = 0.92): BandEnvelopes {
  const N = fftSize;
  const half = N >> 1;
  const df = col.prfHz / N;
  const floorLin = Math.pow(10, floorDb / 10);
  const sigLin = floorLin * Math.pow(10, SIGNIFICANT_DB / 10);
  const binPower = (k: number): number => {
    const lin = Math.pow(10, col.powerDb[k] / 10);
    return lin > sigLin ? lin - floorLin : 0;
  };
  let peak = -200;
  for (let k = 0; k < N; k++) if (Math.abs(k - half) > 1) peak = Math.max(peak, col.powerDb[k]);
  if (peak < floorDb + detectDb) return { posHz: 0, negHz: 0, ePos: 0, eNeg: 0, detected: false };
  // Banda contigua a la línea de base en un semiplano (j = distancia en bins a la continua)
  const band = (sign: 1 | -1): { hz: number; total: number } => {
    const power: number[] = [];
    let total = 0;
    let gap = 0;
    for (let j = 2; j < half; j++) {
      const k = half + sign * j;
      if (k < 0 || k >= N) break;
      const p = binPower(k);
      power.push(p);
      if (p > 0) {
        gap = 0;
        total += p;
      } else if (++gap >= BAND_GAP_BINS && total > 0) break;
    }
    if (total <= 0) return { hz: 0, total: 0 };
    let acc = 0;
    for (let i = 0; i < power.length; i++) {
      acc += power[i];
      if (acc >= pct * total) return { hz: (i + 2) * df, total };
    }
    return { hz: (power.length + 1) * df, total };
  };
  const pos = band(1);
  const neg = band(-1);
  return { posHz: pos.hz, negHz: neg.hz, ePos: pos.total, eNeg: neg.total, detected: true };
}

/**
 * Un bin es flujo de SU semiplano solo si supera a su espejo (el bin de la frecuencia opuesta) en
 * este margen (dB). El flujo es unilateral; el clutter del tejido que respira o late, los
 * transitorios del filtro de pared (una rampa de amplitud es simétrica) y la imagen especular son
 * simétricos respecto a la línea de base (decisión 94).
 */
export const MIRROR_MARGIN_DB = 6;

/**
 * Envolvente de flujo en un semiplano FIJO (decisión 94), en Hz ≥ 0, o NaN si en ese semiplano no hay
 * flujo. Como la traza un equipo sobre un vaso de dirección conocida:
 *  - solo cuentan los bins a |f| ≥ `fMinHz` (fuera de la banda del filtro de pared), significativos
 *    (> suelo + 6 dB) y unilaterales (≥ MIRROR_MARGIN_DB sobre su espejo): el clutter y los
 *    transitorios junto a la línea de base no son flujo;
 *  - la banda crece desde el bin de más potencia hacia los dos lados, tolerando BAND_GAP_BINS − 1 bins
 *    vacíos. Con la banda «contigua a la línea de base» de `columnBandEnvelopes`, un bin de ruido o de
 *    clutter junto a la base abría la banda y el hueco que lo separa del flujo la cerraba: con una señal
 *    débil (la porta a 10–14 cm de profundidad, −30 dB), la envolvente caía a 2–6 cm/s en columnas
 *    sueltas y la PF salía 80–110 % con una verdad de 13 %;
 *  - la envolvente es la frecuencia a la que la potencia acumulada (menos la del espejo) alcanza `pct`.
 * Exige un bin a ≥ suelo + `detectDb` en la banda y dos bins seguidos significativos.
 */
export function halfPlaneEnvelopeHz(
  col: SpectralColumn,
  fftSize: number,
  floorDb: number,
  sign: 1 | -1,
  fMinHz: number,
  detectDb = 12,
  pct = 0.92,
): number {
  const N = fftSize;
  const half = N >> 1;
  const df = col.prfHz / N;
  const floorLin = Math.pow(10, floorDb / 10);
  const sigLin = floorLin * Math.pow(10, SIGNIFICANT_DB / 10);
  const detLin = floorLin * Math.pow(10, detectDb / 10);
  const mirrorRatio = Math.pow(10, MIRROR_MARGIN_DB / 10);
  const j0 = Math.max(1, Math.ceil(fMinHz / df - 1e-9));
  // hueco tolerado en Hz, no en bins: a PRF baja el bin es más estrecho y el moteado espectral parte la banda
  const gapBins = Math.max(BAND_GAP_BINS, Math.ceil(BAND_GAP_HZ / df));
  const nj = half - j0;
  if (nj <= 0) return Number.NaN;
  // potencia de flujo unilateral de cada bin (lineal, sobre el suelo y sobre su espejo) o 0
  const p = new Float64Array(nj);
  const lin = new Float64Array(nj);
  let best = -1;
  for (let i = 0; i < nj; i++) {
    const j = j0 + i;
    lin[i] = Math.pow(10, col.powerDb[half + sign * j] / 10);
    const mirror = Math.pow(10, col.powerDb[half - sign * j] / 10);
    if (lin[i] > sigLin && lin[i] > mirrorRatio * mirror) p[i] = lin[i] - Math.max(floorLin, mirror);
    if (p[i] > 0 && (best < 0 || p[i] > p[best])) best = i;
  }
  if (best < 0) return Number.NaN;
  // banda: crece desde el pico mientras no haya BAND_GAP_BINS bins vacíos seguidos
  let lo = best;
  for (let i = best - 1, gap = 0; i >= 0; i--) {
    if (p[i] > 0) {
      lo = i;
      gap = 0;
    } else if (++gap >= gapBins) break;
  }
  let hi = best;
  for (let i = best + 1, gap = 0; i < nj; i++) {
    if (p[i] > 0) {
      hi = i;
      gap = 0;
    } else if (++gap >= gapBins) break;
  }
  let total = 0;
  let peak = 0;
  let run = 0;
  let pair = false;
  for (let i = lo; i <= hi; i++) {
    total += p[i];
    if (p[i] > 0) peak = Math.max(peak, lin[i]);
    run = p[i] > 0 ? run + 1 : 0;
    if (run >= 2) pair = true;
  }
  if (!pair || peak < detLin) return Number.NaN;
  let acc = 0;
  for (let i = lo; i <= hi; i++) {
    acc += p[i];
    if (acc >= pct * total) return (j0 + i) * df;
  }
  return (j0 + hi) * df;
}

/** Envolvente con signo del semiplano dominante (el de más energía en su banda). */
export function columnPercentileEnvelope(col: SpectralColumn, fftSize: number, floorDb: number, detectDb = 12, pct = 0.92): number {
  const b = columnBandEnvelopes(col, fftSize, floorDb, detectDb, pct);
  if (!b.detected) return 0;
  return b.ePos >= b.eNeg ? b.posHz : -b.negHz;
}

export function noiseFloorDb(col: SpectralColumn): number {
  const arr = Array.from(col.powerDb).sort((a, b) => a - b);
  return arr[arr.length >> 1];
}

/**
 * Suelo de ruido de cada columna de una captura, robusto a un flujo ancho. La mediana de la columna
 * deja de ser ruido cuando la sangre ocupa más de la mitad de los bins: en el pico S de una vena
 * grande muestreada en su centro, el perfil llena el espectro de 0 a vmax (a PRF 2600, 62 de los 64
 * bins de un lado) y el umbral suelo + margen borraba la envolvente justo en el pico (la S del sano
 * salía 0–18 cm/s en un latido de cada tres y el patrón oscilaba entre normal y leve).
 *
 * Cada columna se estima con SU percentil 25 (ruido mientras la sangre ocupe < 75 % de los bins)
 * más la distancia mediana − P25 que tiene el ruido en esta captura (mediana de esa distancia sobre
 * las columnas: la mayoría son ruido o flujo estrecho). Esa distancia es una forma, no un nivel: no
 * cambia con la ganancia. Antes el suelo se acotaba por el decil de la captura y un cambio de
 * ganancia a mitad de la captura dejaba pasar ruido puro como flujo (grado 3 con el visto bueno).
 */
export function captureNoiseFloorsDb(columns: readonly SpectralColumn[]): number[] {
  const stats = columns.map((c) => {
    const arr = Array.from(c.powerDb).sort((a, b) => a - b);
    return { median: arr[arr.length >> 1], p25: arr[Math.floor((arr.length - 1) / 4)] };
  });
  if (stats.length === 0) return [];
  const spreads = stats.map((x) => x.median - x.p25).sort((a, b) => a - b);
  const noiseSpread = spreads[spreads.length >> 1];
  return stats.map((x) => Math.min(x.median, x.p25 + noiseSpread));
}
