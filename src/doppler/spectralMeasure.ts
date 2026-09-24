import { median, robustExtremeInWindow, type TimeWindow } from '../core/series';
import { velocityFromShiftMmS } from '../core/units';
import type { Beat } from '../physiology/rhythm';
import { beatWindows, systolicPeak } from '../vexus/measurements';
import {
  RENAL_INTERRUPTION_FRACTION,
  hepaticPatternFromPeaks,
  portalPulsatilityFraction,
  renalPatternFromPeaks,
  type HepaticPattern,
  type RenalPattern,
} from '../vexus/classification';
import { assessQuality, bloodInColumn, flowBandMinHz, type MeasurementQuality } from './measureQuality';
import { captureNoiseFloorsDb, columnBandEnvelopes, columnEnvelope, columnPercentileEnvelope, type SpectralColumn } from './spectral';

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

export interface ObservedHepatic {
  kind: 'hepatic';
  /** Control de calidad de la captura: si hay problema, el patrón no debe entrar en el grado. */
  quality: MeasurementQuality;
  sPeak: number;
  dPeak: number;
  aPeak: number;
  pattern: HepaticPattern;
  beats: number;
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
}

const qualityOf = (
  columns: readonly SpectralColumn[],
  beats: Beat[],
  opts: MeasureOptions,
  side: 'both' | 'pos' | 'neg',
  waves?: { s: readonly number[]; d: readonly number[] },
) =>
  assessQuality(smoothSpectrum(columns), beats, { wallFilterHz: opts.wallFilterHz ?? 25, marginDb: opts.thresholdMarginDb, side }, waves);

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
): { t: number[]; pos: number[]; neg: number[] } {
  const margin = opts.thresholdMarginDb ?? 12;
  const t: number[] = [];
  const pos: number[] = [];
  const neg: number[] = [];
  const smoothed = smoothSpectrum(columns);
  const floors = captureNoiseFloorsDb(smoothed);
  for (const [i, col] of smoothed.entries()) {
    const b = columnBandEnvelopes(col, opts.fftSize, floors[i], margin);
    const toCm = (hz: number) => {
      const v = velocityFromShiftMmS(hz, opts.f0Hz, opts.angleCorrectionRad) / 10;
      return Number.isFinite(v) ? v : 0;
    };
    t.push(col.t);
    pos.push(toCm(b.posHz));
    neg.push(toCm(b.negHz));
  }
  return { t, pos: medianFilter(pos), neg: medianFilter(neg) };
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
    anterogradeSign,
    trace,
  };
}

export function measureObservedPortal(columns: readonly SpectralColumn[], beats: Beat[], opts: MeasureOptions): ObservedPortal | null {
  const trace = observedTrace(columns, opts);
  if (trace.length < 10) return null;
  const meanV = trace.reduce((a, p) => a + p.vScreen, 0) / trace.length;
  const anterogradeSign = meanV >= 0 ? 1 : -1;
  const oriented = trace.map((p) => ({ t: p.t, vScreen: p.vScreen * anterogradeSign, powerDb: p.powerDb }));
  const maxs: number[] = [];
  const mins: number[] = [];
  const pfs: number[] = [];
  for (const b of beats) {
    const cyc: [number, number] = [b.tR, b.tR + b.rr];
    const vmax = extreme(oriented, cyc, (v) => v);
    const vmin = extreme(oriented, cyc, (v) => -v);
    if (Number.isNaN(vmax) || Number.isNaN(vmin)) continue;
    maxs.push(vmax);
    mins.push(vmin);
    pfs.push(portalPulsatilityFraction(vmax, vmin));
  }
  if (!maxs.length) return null;
  return {
    kind: 'portal',
    quality: qualityOf(columns, beats, opts, 'both'),
    vMax: median(maxs),
    vMin: median(mins),
    pulsatilityFraction: median(pfs),
    beats: maxs.length,
    anterogradeSign,
    trace,
  };
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
 * suavizado: bins por encima del suelo + margen, fuera de la banda del filtro de pared.
 */
export function sideEnergyDb(columns: readonly SpectralColumn[], opts: MeasureOptions): { pos: number; neg: number } {
  const margin = opts.thresholdMarginDb ?? 12;
  let pos = 1e-12;
  let neg = 1e-12;
  const smoothed = smoothSpectrum(columns);
  const floors = captureNoiseFloorsDb(smoothed);
  for (const [i, col] of smoothed.entries()) {
    const N = col.powerDb.length;
    const floor = floors[i];
    const fMin = flowBandMinHz(opts.wallFilterHz ?? 25, col.prfHz, N);
    for (let k = 0; k < N; k++) {
      const f = ((k - N / 2) / N) * col.prfHz;
      if (Math.abs(f) < fMin || col.powerDb[k] <= floor + margin) continue;
      const p = Math.pow(10, (col.powerDb[k] - floor) / 10);
      if (f > 0) pos += p;
      else neg += p;
    }
  }
  return { pos: 10 * Math.log10(pos), neg: 10 * Math.log10(neg) };
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
  const smoothed = smoothSpectrum(columns);
  const floors = captureNoiseFloorsDb(smoothed);
  const presence = {
    wallFilterHz: opts.wallFilterHz ?? 25,
    marginDb: opts.thresholdMarginDb,
    side: veinSign === 1 ? ('pos' as const) : ('neg' as const),
  };
  const credible = vein.map((p, i) => p.vScreen > baseline || !bloodInColumn(smoothed[i], presence, floors[i]).present);
  const minList: number[] = [];
  for (const b of measured) {
    let mn = Infinity;
    for (let i = 0; i < vein.length; i++)
      if (credible[i] && vein[i].t >= b.tR && vein[i].t <= b.tR + b.rr) mn = Math.min(mn, vein[i].vScreen);
    if (Number.isFinite(mn)) minList.push(mn);
  }
  const vMin = minList.length ? median(minList) : Number.NaN;
  return {
    kind: 'renal',
    // la arteria vecina siempre da señal: la calidad se juzga en el lado de la vena
    quality: qualityOf(columns, beats, opts, veinSign === 1 ? 'pos' : 'neg'),
    sPeak,
    dPeak,
    vMin,
    pattern: renalPatternFromPeaks(sPeak, dPeak, vMin, floorCms),
    beats: sList.length,
    anterogradeSign,
    trace,
  };
}
