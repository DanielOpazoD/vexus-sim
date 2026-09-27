import { median, robustExtremeInWindow, type TimeWindow } from '../core/series';
import { velocityFromShiftMmS } from '../core/units';
import type { Beat } from '../physiology/rhythm';
import { RENAL_GAP_MIN_S, beatWindows, systolicPeak } from '../vexus/measurements';
import {
  RENAL_INTERRUPTION_FRACTION,
  hepaticPatternFromPeaks,
  portalPulsatilityFraction,
  renalPatternFromPeaks,
  type HepaticPattern,
  type RenalPattern,
} from '../vexus/classification';
import { assessQuality, flowBandMinHz, type MeasurementQuality } from './measureQuality';
import { receiverNoiseDb } from './sampleVolume';
import {
  captureNoiseFloorsDb,
  columnEnvelope,
  columnPercentileEnvelope,
  halfPlaneEnvelopeHz,
  MIRROR_MARGIN_DB,
  type SpectralColumn,
} from './spectral';

/**
 * Mediciones sobre la señal ADQUIRIDA (espectro observado), separadas de la
 * verdad fisiológica. La velocidad rotulada depende de la corrección angular
 * que puso el alumno (no de la física); las ventanas S/D se anclan al ECG
 * (mismo reloj). La dirección «anterógrada» se infiere como hace un
 * clínico: en la suprahepática, la onda D siempre drena hacia la aurícula;
 * en la porta, el sentido dominante se toma como hepatópeto. Identificar el
 * vaso correcto sigue siendo responsabilidad del operador.
 */
export interface ObservedTracePoint {
  t: number;
  /** Velocidad rotulada con signo de pantalla (cm/s, + = hacia la sonda). */
  vScreen: number;
  powerDb: number;
}

/**
 * Marca de una captura sobre el espectro (decisión 93): dónde leyó la medición cada valor de cada latido, para que el
 * alumno vea qué se midió. `vScreen` con signo de pantalla, como la traza.
 */
export interface CaptureMark {
  t: number;
  vScreen: number;
  label: 'S' | 'D' | 'A' | 'Vmáx' | 'Vmín' | 'mín';
}

/** Instante del punto de la traza en la ventana cuyo valor orientado está más cerca de `target` (NaN si no hay). */
function timeOfValue(trace: readonly { t: number; vScreen: number }[], w: TimeWindow, target: number, sign: number): number {
  let best = Number.NaN;
  let err = Infinity;
  for (const p of trace) {
    if (!(p.t >= w[0] && p.t <= w[1]) || !Number.isFinite(p.vScreen)) continue;
    const e = Math.abs(p.vScreen * sign - target);
    if (e < err) {
      err = e;
      best = p.t;
    }
  }
  return best;
}

/** Marca con el instante del valor en la traza; ninguna si el valor o su instante no existen. */
function mark(
  out: CaptureMark[],
  trace: readonly { t: number; vScreen: number }[],
  w: TimeWindow,
  value: number,
  sign: number,
  label: CaptureMark['label'],
): void {
  if (!Number.isFinite(value)) return;
  const t = timeOfValue(trace, w, value, sign);
  if (Number.isFinite(t)) out.push({ t, vScreen: value * sign, label });
}

export interface ObservedHepatic {
  kind: 'hepatic';
  /** Control de calidad de la captura: si hay problema, el patrón no debe entrar en el grado. */
  quality: MeasurementQuality;
  sPeak: number;
  dPeak: number;
  aPeak: number;
  pattern: HepaticPattern;
  beats: number;
  /** Latidos medidos: los que marca el trazado sobre el espectro. */
  measuredBeats: Beat[];
  /** Dónde se leyeron S, D y A en cada latido. */
  marks: CaptureMark[];
  /** Signo de pantalla considerado anterógrado (+1 hacia la sonda, −1 alejándose). */
  anterogradeSign: number;
  trace: ObservedTracePoint[];
}

export interface ObservedPortal {
  kind: 'portal';
  /** Control de calidad de la captura: si hay problema, el patrón no debe entrar en el grado. */
  quality: MeasurementQuality;
  vMax: number;
  vMin: number;
  pulsatilityFraction: number;
  beats: number;
  /** Latidos medidos (con traza suficiente): los que marca el trazado sobre el espectro. */
  measuredBeats: Beat[];
  /** Dónde se leyeron Vmáx y Vmín en cada latido. */
  marks: CaptureMark[];
  anterogradeSign: number;
  trace: ObservedTracePoint[];
}

export interface ObservedRenal {
  kind: 'renal';
  /** Control de calidad de la captura: si hay problema, el patrón no debe entrar en el grado. */
  quality: MeasurementQuality;
  sPeak: number;
  dPeak: number;
  vMin: number;
  pattern: RenalPattern;
  beats: number;
  /** Latidos medidos: los que marca el trazado sobre el espectro. */
  measuredBeats: Beat[];
  /** Dónde se leyeron S, D y el mínimo de la vena en cada latido. */
  marks: CaptureMark[];
  anterogradeSign: number;
  trace: ObservedTracePoint[];
}

export interface MeasureOptions {
  f0Hz: number;
  angleCorrectionRad: number;
  invert: boolean;
  fftSize: number;
  /** Margen sobre el suelo de ruido (dB) para detectar la envolvente. */
  thresholdMarginDb?: number;
  /** Filtro de pared del equipo (Hz): el clutter residual por debajo no cuenta como flujo (lado de la vena, calidad). */
  wallFilterHz?: number;
  /** Ganancia espectral del equipo (dB): fija el ruido del receptor con el que la calidad reconoce el aliasing fuerte. */
  gainDb?: number;
}

const qualityOf = (
  columns: readonly SpectralColumn[],
  beats: Beat[],
  opts: MeasureOptions,
  side: 'both' | 'pos' | 'neg',
  waves?: { s: readonly number[]; d: readonly number[] },
  phaseWindow?: (b: Beat) => readonly [number, number],
  present?: (c: SpectralColumn) => boolean,
) =>
  assessQuality(
    smoothSpectrum(columns),
    beats,
    {
      wallFilterHz: opts.wallFilterHz ?? 25,
      marginDb: opts.thresholdMarginDb,
      side,
      phaseWindow,
      present,
      receiverNoiseDb: opts.gainDb === undefined ? undefined : receiverNoiseDb(opts.gainDb, opts.fftSize),
    },
    waves,
  );

/**
 * Traza observada: envolvente por el método del percentil en cada columna y mediana
 * temporal de 5 columnas (≈ 30 ms), como el trazado automático de un equipo o el
 * que hace a mano el operador por encima del moteado. Las mediciones toman extremos
 * de esta traza por ventana, así que un pico de ruido ya no decide S, D ni la PF.
 */
export function observedTrace(columns: readonly SpectralColumn[], opts: MeasureOptions): ObservedTracePoint[] {
  const margin = opts.thresholdMarginDb ?? 12;
  const raw: ObservedTracePoint[] = [];
  const smoothed = smoothSpectrum(columns);
  const floors = captureNoiseFloorsDb(smoothed);
  for (const [i, col] of smoothed.entries()) {
    const floor = floors[i];
    const env = columnEnvelope(col, opts.fftSize, floor + margin);
    const f = columnPercentileEnvelope(col, opts.fftSize, floor, margin);
    const vMm = velocityFromShiftMmS(f, opts.f0Hz, opts.angleCorrectionRad);
    const v = (Number.isFinite(vMm) ? vMm / 10 : 0) * (opts.invert ? -1 : 1);
    raw.push({ t: col.t, vScreen: v, powerDb: Math.max(env.powerPosDb, env.powerNegDb) });
  }
  const filtered = medianFilter(raw.map((p) => p.vScreen));
  return raw.map((p, i) => ({ ...p, vScreen: filtered[i] }));
}

/** Semiancho de la mediana temporal de la traza (columnas). */
const TRACE_MEDIAN_HALF = 2;

/**
 * Promedio del espectro en una vecindad 3 × 3 (columnas × bins) en potencia lineal: reduce
 * la varianza del periodograma (moteado espectral de pocos dispersores) antes de trazar la
 * envolvente, como el promediado de visualización de un equipo. No toca la señal mostrada.
 */
export function smoothSpectrum(columns: readonly SpectralColumn[]): SpectralColumn[] {
  const n = columns.length;
  if (n === 0) return [];
  const N = columns[0].powerDb.length;
  const lin = columns.map((c) => Float64Array.from(c.powerDb, (db) => Math.pow(10, db / 10)));
  return columns.map((c, i) => {
    const out = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      let acc = 0;
      let cnt = 0;
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        if (ii < 0 || ii >= n || lin[ii].length !== N) continue;
        for (let dk = -1; dk <= 1; dk++) {
          const kk = k + dk;
          if (kk < 0 || kk >= N) continue;
          acc += lin[ii][kk];
          cnt++;
        }
      }
      out[k] = 10 * Math.log10(acc / cnt);
    }
    return { t: c.t, prfHz: c.prfHz, powerDb: out };
  });
}

const medianFilter = (v: number[]): number[] =>
  v.map((_, i) => {
    const win: number[] = [];
    for (let j = Math.max(0, i - TRACE_MEDIAN_HALF); j <= Math.min(v.length - 1, i + TRACE_MEDIAN_HALF); j++) win.push(v[j]);
    return median(win);
  });

/**
 * Trazas de magnitud de CADA semiplano por separado (cm/s, ≥ 0, corregidas por ángulo):
 * cuando dos flujos opuestos comparten la puerta (arteria y vena interlobares) cada uno
 * se lee en su lado de la línea de base, como hace el operador.
 */
export function observedSideTraces(
  columns: readonly SpectralColumn[],
  opts: MeasureOptions,
): { t: number[]; pos: number[]; neg: number[]; posFlow: boolean[]; negFlow: boolean[] } {
  const margin = opts.thresholdMarginDb ?? 12;
  const t: number[] = [];
  const pos: number[] = [];
  const neg: number[] = [];
  const posFlow: boolean[] = [];
  const negFlow: boolean[] = [];
  const smoothed = smoothSpectrum(columns);
  const floors = captureNoiseFloorsDb(smoothed);
  const toCm = (hz: number) => {
    const v = velocityFromShiftMmS(hz, opts.f0Hz, opts.angleCorrectionRad) / 10;
    return Number.isFinite(v) ? v : 0;
  };
  for (const [i, col] of smoothed.entries()) {
    // envolvente unilateral de cada semiplano (decisión 93): el clutter simétrico junto a la línea de base (a ±80 cm/s
    // el del riñón llega a ±12 cm/s) ya no es flujo, y la vena monofásica del grave no «fluye» en sístole
    const fMin = flowBandMinHz(opts.wallFilterHz ?? 25, col.prfHz, col.powerDb.length);
    const p = halfPlaneEnvelopeHz(col, col.powerDb.length, floors[i], 1, fMin, margin);
    const n = halfPlaneEnvelopeHz(col, col.powerDb.length, floors[i], -1, fMin, margin);
    t.push(col.t);
    posFlow.push(Number.isFinite(p));
    negFlow.push(Number.isFinite(n));
    pos.push(Number.isFinite(p) ? toCm(p) : 0);
    neg.push(Number.isFinite(n) ? toCm(n) : 0);
  }
  return { t, pos: medianFilter(pos), neg: medianFilter(neg), posFlow, negFlow };
}

/**
 * Extremo robusto de la traza medida (cuantil 0,97): una columna con caída de señal o
 * un resto de ruido no decide el pico ni el mínimo, como no lo decide el operador al
 * trazar (decisión 44). La verdad fisiológica usa extremos exactos sobre la señal limpia.
 */
const TRACE_Q = 0.97;
const extreme = (trace: readonly { t: number; vScreen: number }[], w: TimeWindow, pick: (v: number) => number): number =>
  robustExtremeInWindow(
    trace,
    w,
    (p) => p.t,
    (p) => p.vScreen,
    pick,
    TRACE_Q,
  );

export function measureObservedHepatic(columns: readonly SpectralColumn[], beats: Beat[], opts: MeasureOptions): ObservedHepatic | null {
  const trace = observedTrace(columns, opts);
  if (trace.length < 10) return null;
  // Sentido anterógrado: signo mediano de la onda D (diástole temprana).
  const dSigns: number[] = [];
  for (const b of beats) {
    const w = beatWindows(b);
    const d = extreme(trace, w.dWindow, Math.abs);
    if (Number.isFinite(d) && Math.abs(d) > 2) dSigns.push(Math.sign(d));
  }
  const anterogradeSign = dSigns.length ? (median(dSigns) >= 0 ? 1 : -1) : -1;
  const oriented = trace.map((p) => ({ t: p.t, vScreen: p.vScreen * anterogradeSign }));
  const sList: number[] = [];
  const dList: number[] = [];
  const aList: number[] = [];
  const measuredBeats: Beat[] = [];
  const marks: CaptureMark[] = [];
  for (const b of beats) {
    const w = beatWindows(b);
    const s = systolicPeak(oriented, w.sWindow, (p) => p.vScreen, TRACE_Q);
    const d = extreme(oriented, w.dWindow, (v) => v);
    const a = extreme(oriented, w.aWindow, (v) => -v);
    // Sin onda A (fibrilación auricular) la ventana auricular es NaN: S y D bastan
    if (Number.isNaN(s) || Number.isNaN(d)) continue;
    sList.push(s);
    dList.push(d);
    if (!Number.isNaN(a)) aList.push(a);
    measuredBeats.push(b);
    mark(marks, trace, w.sWindow, s, anterogradeSign, 'S');
    mark(marks, trace, w.dWindow, d, anterogradeSign, 'D');
    if (!Number.isNaN(a)) mark(marks, trace, w.aWindow, a, anterogradeSign, 'A');
  }
  if (!sList.length) return null;
  const sPeak = median(sList);
  const dPeak = median(dList);
  return {
    kind: 'hepatic',
    quality: qualityOf(columns, beats, opts, 'both', { s: sList, d: dList }),
    sPeak,
    dPeak,
    aPeak: median(aList),
    pattern: hepaticPatternFromPeaks(sPeak, dPeak),
    beats: sList.length,
    measuredBeats,
    marks,
    anterogradeSign,
    trace,
  };
}

/**
 * Porta (decisión 93). El flujo portal es de dirección conocida y casi continuo: se lee en su semiplano
 * anterógrado, FIJO para toda la captura (el de más energía de flujo, como la vena en la interlobar), con la
 * envolvente unilateral de `halfPlaneEnvelopeHz`. Antes se tomaba el semiplano dominante columna a columna:
 * en las columnas con la banda débil, el clutter junto a la línea de base o su imagen ganaban y la traza caía a
 * 0 o cambiaba de signo; con el cuantil 0,97 del mínimo, la PF del sano (verdad 13–20 %) salía 80–115 % según
 * la escala, con el visto bueno de la calidad. Una columna sin flujo trazable es un hueco (NaN), no velocidad
 * 0: la caída de señal de un vaso profundo no es una pausa. Si el semiplano anterógrado está vacío y el
 * contrario tiene flujo unilateral, la porta se invierte ahí (hepatófugo) y la traza es negativa. Vmáx y Vmín
 * son cuantiles robustos de la traza del latido (PORTAL_Q_HI/LO).
 */
const PORTAL_Q_HI = 0.97;
const PORTAL_Q_LO = 0.03;
/** Fracción de las columnas del latido con traza para medirlo (el resto es un hueco de la señal). */
const PORTAL_TRACE_COVERAGE = 0.5;
/** Fracción del latido que deben cubrir sus columnas para medirlo (la de la calidad). */
const BEAT_COVERAGE = 0.9;
/** Vmáx a partir de esta fracción del Nyquist: el pico se recorta o se pliega (aliasing). */
const PORTAL_CLIP_NYQUIST = 0.85;
/** Flujo «invertido» más allá de esta fracción del Nyquist: es el pico plegado. */
const PORTAL_WRAP_NYQUIST = 0.5;
/** Hueco mínimo (s) con que la traza se hunde en el filtro de pared. */
const WALL_GAP_S = 0.04;
/** Múltiplo del corte del filtro de pared hasta el que la traza no es fiable (banda de transición). */
const WALL_TRANSITION = 1.5;

/** Cuantil q (0–1) de valores finitos (NaN si no hay). */
function quantile(values: readonly number[], q: number): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return Number.NaN;
  return v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))];
}

/** Mediana temporal que ignora los huecos (NaN): hueco si en la ventana hay menos de 3 columnas con traza. */
const medianFilterFinite = (v: readonly number[]): number[] =>
  v.map((_, i) => {
    const win: number[] = [];
    for (let j = Math.max(0, i - TRACE_MEDIAN_HALF); j <= Math.min(v.length - 1, i + TRACE_MEDIAN_HALF); j++)
      if (Number.isFinite(v[j])) win.push(v[j]);
    return win.length >= 3 ? median(win) : Number.NaN;
  });

/**
 * Promedio móvil de la traza (s): la envolvente de una señal débil tiembla ±3 cm/s de una columna a otra con el
 * moteado espectral (a PRF 1300 hay ~10 espectros independientes por segundo) y ese temblor, sobre una porta de
 * 15 cm/s, era por sí solo una PF de ~35 %. Como el ojo del operador, que coloca los calibres sobre la onda y no sobre
 * el moteado. Una ventana de 60 ms apenas toca la pulsatilidad cardiaca (seno de 0,8 s: ×0,99). Ventana, cuantiles y hueco de la
 * banda se eligieron en una rejilla sobre 168 capturas de la cadena del alumno (decisión 93). [EXTRAPOLACIÓN PROPIA]
 */
const PORTAL_SMOOTH_S = 0.06;

/** Media de los valores finitos a ±w/2 de cada instante; hueco (NaN) donde la traza lo es. */
function movingAverageFinite(t: readonly number[], v: readonly number[], w: number): number[] {
  const out: number[] = new Array<number>(v.length).fill(Number.NaN);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    while (hi < v.length && t[hi] <= t[i] + w / 2) {
      if (Number.isFinite(v[hi])) {
        sum += v[hi];
        n++;
      }
      hi++;
    }
    while (t[lo] < t[i] - w / 2) {
      if (Number.isFinite(v[lo])) {
        sum -= v[lo];
        n--;
      }
      lo++;
    }
    if (Number.isFinite(v[i]) && n > 0) out[i] = sum / n;
  }
  return out;
}

/**
 * Traza de la porta en su semiplano anterógrado fijo (cm/s con signo de pantalla; NaN = hueco) y ese signo. La
 * usan la medición y el trazado que ve el alumno sobre el espectro.
 */
export function portalTrace(
  columns: readonly SpectralColumn[],
  opts: MeasureOptions,
  /** Ventana (s) de la que se toma el sentido del flujo: la de los latidos medidos (la puerta pudo estar antes en otro vaso). */
  directionWindow?: readonly [number, number],
): { trace: ObservedTracePoint[]; anterogradeSign: 1 | -1 } {
  const margin = opts.thresholdMarginDb ?? 12;
  const smoothed = smoothSpectrum(columns);
  const floors = captureNoiseFloorsDb(smoothed);
  const inWindow = directionWindow ? columns.filter((c) => c.t >= directionWindow[0] && c.t <= directionWindow[1]) : columns;
  const energy = sideEnergyDb(inWindow.length ? inWindow : columns, opts);
  // semiplano físico del flujo anterógrado (+ = hacia la sonda) y su signo de pantalla
  const phys: 1 | -1 = energy.pos >= energy.neg ? 1 : -1;
  const screen = opts.invert ? -1 : 1;
  const toCm = (hz: number) => {
    const v = velocityFromShiftMmS(hz, opts.f0Hz, opts.angleCorrectionRad) / 10;
    return Number.isFinite(v) ? v : Number.NaN;
  };
  const raw = smoothed.map((col, i) => {
    const fMin = flowBandMinHz(opts.wallFilterHz ?? 25, col.prfHz, col.powerDb.length);
    const ante = halfPlaneEnvelopeHz(col, col.powerDb.length, floors[i], phys, fMin, margin);
    if (Number.isFinite(ante)) return toCm(ante);
    const retro = halfPlaneEnvelopeHz(col, col.powerDb.length, floors[i], phys === 1 ? -1 : 1, fMin, margin);
    return Number.isFinite(retro) ? -toCm(retro) : Number.NaN;
  });
  const filtered = movingAverageFinite(
    smoothed.map((c) => c.t),
    medianFilterFinite(raw),
    PORTAL_SMOOTH_S,
  );
  const anterogradeSign = (phys * screen) as 1 | -1;
  return {
    trace: smoothed.map((col, i) => ({ t: col.t, vScreen: filtered[i] * anterogradeSign, powerDb: 0 })),
    anterogradeSign,
  };
}

export function measureObservedPortal(columns: readonly SpectralColumn[], beats: Beat[], opts: MeasureOptions): ObservedPortal | null {
  if (columns.length < 10) return null;
  const span: [number, number] | undefined = beats.length
    ? [beats[0].tR, beats[beats.length - 1].tR + beats[beats.length - 1].rr]
    : undefined;
  const { trace, anterogradeSign } = portalTrace(columns, opts, span);
  const prf = columns[columns.length - 1].prfHz;
  const cmsOf = (hz: number) => Math.abs(velocityFromShiftMmS(hz, opts.f0Hz, opts.angleCorrectionRad) / 10);
  const nyquistCms = cmsOf(prf / 2);
  const wallHz = opts.wallFilterHz ?? 25;
  const binHz = prf / columns[columns.length - 1].powerDb.length;
  // por debajo, la traza no es fiable: la banda de transición del filtro de pared (4.º orden: −1 dB a ~1,3 veces el corte)
  // se come la parte lenta del perfil, y Vmín se leería en su borde
  const floorCms = cmsOf(
    Math.max(flowBandMinHz(wallHz, prf, columns[columns.length - 1].powerDb.length), WALL_TRANSITION * wallHz) + binHz,
  );
  const maxs: number[] = [];
  const mins: number[] = [];
  const pfs: number[] = [];
  const measured: Beat[] = [];
  const marks: CaptureMark[] = [];
  let clipped = false;
  let wallCut = false;
  for (const b of beats) {
    const inBeat = trace.filter((p) => p.t >= b.tR && p.t < b.tR + b.rr);
    // un latido a medias (PW recién encendido o la escala recién cambiada) no se mide, como en la calidad
    if (!inBeat.length || inBeat[inBeat.length - 1].t - inBeat[0].t < BEAT_COVERAGE * b.rr) continue;
    const oriented = inBeat.map((p) => p.vScreen * anterogradeSign);
    const v = oriented.filter(Number.isFinite);
    if (v.length < PORTAL_TRACE_COVERAGE * inBeat.length) continue;
    const vmax = quantile(v, PORTAL_Q_HI);
    const vmin = quantile(v, PORTAL_Q_LO);
    if (!(vmax > 0)) continue;
    // el pico toca el Nyquist: se recorta (la PF baja) o se pliega al otro lado (se leería como inversión)
    if (vmax >= PORTAL_CLIP_NYQUIST * nyquistCms) clipped = true;
    if (vmin <= floorCms || portalGapIntoWallFilter(inBeat, oriented, floorCms + cmsOf(binHz))) wallCut = true;
    maxs.push(vmax);
    mins.push(vmin);
    pfs.push(portalPulsatilityFraction(vmax, vmin));
    measured.push(b);
    mark(marks, inBeat, [b.tR, b.tR + b.rr], vmax, anterogradeSign, 'Vmáx');
    mark(marks, inBeat, [b.tR, b.tR + b.rr], vmin, anterogradeSign, 'Vmín');
  }
  // un flujo «invertido» más allá de medio Nyquist es el pico plegado, no una porta hepatófuga (que crece desde la base)
  const wrapped = trace.some((p) => p.vScreen * anterogradeSign < -PORTAL_WRAP_NYQUIST * nyquistCms);
  const present = new Set(trace.filter((p) => Number.isFinite(p.vScreen)).map((p) => p.t));
  // la calidad juzga lo mismo que se trazó: una columna vale si tiene traza (el clutter simétrico no es flujo). Sin ningún
  // latido trazable la captura se devuelve igual, con su motivo (con aliasing fuerte, «suba la escala»), no en blanco
  const quality = qualityOf(columns, beats, opts, 'both', undefined, undefined, (c) => present.has(c.t));
  if (clipped || wrapped) quality.issue = 'aliasing';
  else if (wallCut && (quality.issue === null || quality.issue === 'intermittent')) quality.issue = 'wall-filter';
  if (!maxs.length && quality.issue === null) quality.issue = 'few-beats';
  return {
    kind: 'portal',
    quality,
    vMax: median(maxs),
    vMin: median(mins),
    pulsatilityFraction: median(pfs),
    beats: maxs.length,
    measuredBeats: measured,
    marks,
    anterogradeSign,
    trace,
  };
}

/**
 * ¿La traza del latido se hunde en la banda del filtro de pared? Un hueco de ≥ WALL_GAP_S junto a un valor a menos de
 * `edgeCms`: el valle de la onda está por debajo del corte y el hueco no es una caída de señal. Con el filtro a 300 Hz el
 * valle del grave desaparecía y Vmín se tomaba en el borde del hueco: PF 30–49 % con una verdad de 76 % (revisión
 * adversarial de la decisión 93). Con Vmín en la banda de transición (`floorCms`), lo mismo sin hueco.
 */
function portalGapIntoWallFilter(inBeat: readonly { t: number }[], oriented: readonly number[], edgeCms: number): boolean {
  let i = 0;
  while (i < oriented.length) {
    if (Number.isFinite(oriented[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < oriented.length && !Number.isFinite(oriented[j])) j++;
    const t0 = inBeat[i].t;
    const t1 = j < inBeat.length ? inBeat[j].t : inBeat[inBeat.length - 1].t;
    const before = i > 0 ? oriented[i - 1] : Number.NaN;
    const after = j < oriented.length ? oriented[j] : Number.NaN;
    if (t1 - t0 >= WALL_GAP_S && (before <= edgeCms || after <= edgeCms)) return true;
    i = j;
  }
  return false;
}

/**
 * Vena interlobar. La puerta recoge a la vez la arteria (hacia la corteza) y la vena
 * (hacia el hilio), en lados opuestos de la línea de base; la vena se lee en su lado, con su
 * magnitud como velocidad anterógrada. Qué lado es la vena, como lo decide el operador:
 *  - si un lado domina la potencia (≥ SIDE_DOMINANCE_DB), es el vaso sobre el que se puso la
 *    puerta, la vena; la arteria vecina solo asoma. Medido en la cadena del alumno: la arteria
 *    queda 19–25 dB por debajo en el sano y en FA, y su traza, rozando el umbral, sale plana e
 *    intermitente: compararla por su forma elegía una u otra al azar;
 *  - si los dos lados son comparables (la puerta abarca los dos vasos; en la congestión grave la
 *    vena monofásica pasa media sístole sin flujo y queda solo 3–4 dB por encima), la arteria es
 *    el lado de mayor relación sístole/diástole (PSV ≫ EDV).
 * Si solo un lado tiene señal, ese es la vena. Un flujo venoso invertido se confundiría con la
 * arteria y no se mide aquí (vMin ≥ 0).
 */
/** Diferencia de potencia (dB) a partir de la cual un lado del espectro es el vaso de la puerta. */
const SIDE_DOMINANCE_DB = 6;

/**
 * Energía de flujo de cada lado de la línea de base (dB, relativa al suelo), sobre el espectro
 * suavizado: bins por encima del suelo + margen, fuera de la banda del filtro de pared y unilaterales
 * (≥ MIRROR_MARGIN_DB sobre su espejo, contando solo el exceso: decisión 93). El clutter simétrico del
 * tejido sumaba lo mismo a los dos lados y acercaba la vena renal a su arteria (4 dB en vez de 20).
 */
export function sideEnergyDb(columns: readonly SpectralColumn[], opts: MeasureOptions): { pos: number; neg: number } {
  const margin = opts.thresholdMarginDb ?? 12;
  const mirrorRatio = Math.pow(10, MIRROR_MARGIN_DB / 10);
  let pos = 1e-12;
  let neg = 1e-12;
  const smoothed = smoothSpectrum(columns);
  const floors = captureNoiseFloorsDb(smoothed);
  for (const [i, col] of smoothed.entries()) {
    const N = col.powerDb.length;
    const floor = floors[i];
    const floorLin = Math.pow(10, floor / 10);
    const fMin = flowBandMinHz(opts.wallFilterHz ?? 25, col.prfHz, N);
    for (let k = 1; k < N; k++) {
      const f = ((k - N / 2) / N) * col.prfHz;
      if (Math.abs(f) < fMin || col.powerDb[k] <= floor + margin) continue;
      const lin = Math.pow(10, col.powerDb[k] / 10);
      const mirror = Math.pow(10, col.powerDb[N - k] / 10);
      if (lin <= mirrorRatio * mirror) continue;
      const p = (lin - Math.max(floorLin, mirror)) / floorLin;
      if (f > 0) pos += p;
      else neg += p;
    }
  }
  return { pos: 10 * Math.log10(pos), neg: 10 * Math.log10(neg) };
}

/**
 * Mínimo que se sostiene `width` s en la ventana `w`: el menor de los máximos locales de ±width/2 (solo valores finitos),
 * como `resolvableMinimum` de la verdad.
 */
function resolvableMinimumFinite(series: readonly { t: number; v: number }[], w: TimeWindow, width: number): number {
  let best = Number.NaN;
  for (const p of series) {
    if (!(p.t >= w[0] && p.t <= w[1]) || !Number.isFinite(p.v)) continue;
    let localMax = -Infinity;
    for (const q of series) if (Math.abs(q.t - p.t) <= width / 2 && Number.isFinite(q.v)) localMax = Math.max(localMax, q.v);
    if (Number.isNaN(best) || localMax < best) best = localMax;
  }
  return best;
}

/** Velocidad rotulada (cm/s) del borde de la banda de flujo: por debajo, la traza es línea de base. */
export function renalFloorCms(columns: readonly SpectralColumn[], opts: MeasureOptions): number {
  const prf = columns.length ? columns[columns.length - 1].prfHz : 0;
  const hz = flowBandMinHz(opts.wallFilterHz ?? 25, prf, opts.fftSize);
  const v = velocityFromShiftMmS(hz, opts.f0Hz, opts.angleCorrectionRad) / 10;
  return Number.isFinite(v) ? v : 0;
}

export function measureObservedRenal(columns: readonly SpectralColumn[], beats: Beat[], opts: MeasureOptions): ObservedRenal | null {
  const tr = observedSideTraces(columns, opts);
  if (tr.t.length < 10) return null;
  const at = (side: number[]) => tr.t.map((t, i) => ({ t, vScreen: side[i] }));
  const pos = at(tr.pos);
  const neg = at(tr.neg);
  const sdRatio = (side: { t: number; vScreen: number }[]) => {
    let s = 0;
    let d = 0;
    for (const b of beats) {
      const w = beatWindows(b);
      const sv = extreme(side, w.sWindow, (v) => v);
      const dv = extreme(side, w.dWindow, (v) => v);
      if (Number.isFinite(sv)) s += sv;
      if (Number.isFinite(dv)) d += dv;
    }
    return { s, d, total: s + d, ratio: s / Math.max(1e-6, d) };
  };
  const rp = sdRatio(pos);
  const rn = sdRatio(neg);
  const MIN_SIGNAL = 2 * Math.max(1, beats.length); // cm/s acumulados: por debajo, el lado está vacío
  const energy = sideEnergyDb(columns, opts);
  let veinSign: 1 | -1;
  if (rp.total < MIN_SIGNAL) veinSign = -1;
  else if (rn.total < MIN_SIGNAL) veinSign = 1;
  else if (Math.abs(energy.pos - energy.neg) >= SIDE_DOMINANCE_DB) veinSign = energy.pos > energy.neg ? 1 : -1;
  else veinSign = rp.ratio > rn.ratio ? -1 : 1; // el lado con sístole dominante es la arteria
  const vein = veinSign === 1 ? pos : neg;
  const anterogradeSign = (opts.invert ? -1 : 1) * veinSign;
  const trace: ObservedTracePoint[] = vein.map((p) => ({ t: p.t, vScreen: p.vScreen * veinSign * (opts.invert ? -1 : 1), powerDb: 0 }));
  const sList: number[] = [];
  const dList: number[] = [];
  const measured: Beat[] = [];
  for (const b of beats) {
    const w = beatWindows(b);
    const s = extreme(vein, w.sWindow, (v) => v);
    const d = extreme(vein, w.dWindow, (v) => v);
    if (Number.isNaN(s) || Number.isNaN(d)) continue;
    sList.push(s);
    dList.push(d);
    measured.push(b);
  }
  if (!sList.length) return null;
  const sPeak = median(sList);
  const dPeak = median(dList);
  // «Sin flujo» es lo que cae en la banda del filtro de pared: el mismo corte en Hz, así que el patrón
  // no cambia con la corrección angular ni con la PRF.
  const floorCms = renalFloorCms(columns, opts);
  const baseline = Math.max(floorCms, RENAL_INTERRUPTION_FRACTION * Math.max(sPeak, dPeak));
  // Mínimo exacto de la traza (el cuantil robusto descartaba ~26 ms por latido, lo justo para esconder
  // una pausa real), pero solo de columnas creíbles: si la traza cae a la línea de base con sangre en
  // el lado de la vena (la misma prueba de presencia que la calidad), es el detector el que se hunde
  // (a PRF ≤ 2600 Hz, en el pico de la vena, 3–6 columnas con +20 dB), no una pausa.
  const veinFlow = veinSign === 1 ? tr.posFlow : tr.negFlow;
  const credible = vein.map((p, i) => p.vScreen > baseline || !veinFlow[i]);
  const veinFlowAt = new Map(tr.t.map((t, i) => [t, veinFlow[i]]));
  // …y sostenido al menos RENAL_GAP_MIN_S, la pausa que cuenta la verdad (decisión 93): con la envolvente unilateral, a
  // PRF alta una columna suelta sin flujo (el clutter de enfrente tapaba la base de la vena) hacía «bifásico» al sano
  const credibleSeries = vein.map((p, i) => ({ t: p.t, v: credible[i] ? p.vScreen : Number.NaN }));
  const minList: number[] = [];
  const marks: CaptureMark[] = [];
  for (const [i, b] of measured.entries()) {
    const w = beatWindows(b);
    mark(marks, trace, w.sWindow, sList[i], anterogradeSign, 'S');
    mark(marks, trace, w.dWindow, dList[i], anterogradeSign, 'D');
    const mn = resolvableMinimumFinite(credibleSeries, [b.tR, b.tR + b.rr], RENAL_GAP_MIN_S);
    if (!Number.isFinite(mn)) continue;
    minList.push(mn);
    mark(
      marks,
      credibleSeries.map((p) => ({ t: p.t, vScreen: p.v * anterogradeSign })),
      [b.tR, b.tR + b.rr],
      mn,
      anterogradeSign,
      'mín',
    );
  }
  const vMin = minList.length ? median(minList) : Number.NaN;
  return {
    kind: 'renal',
    // la arteria vecina siempre da señal: la calidad se juzga en el lado de la vena
    // …y la vena monofásica solo lleva flujo en diástole: el latido vale si la sangre cubre su ventana
    // diastólica y se repite igual en todos (C10)
    quality: qualityOf(
      columns,
      beats,
      opts,
      veinSign === 1 ? 'pos' : 'neg',
      undefined,
      (b) => beatWindows(b).dWindow,
      (c) => veinFlowAt.get(c.t) === true,
    ),
    sPeak,
    dPeak,
    vMin,
    pattern: renalPatternFromPeaks(sPeak, dPeak, vMin, floorCms),
    beats: sList.length,
    measuredBeats: measured,
    marks,
    anterogradeSign,
    trace,
  };
}
