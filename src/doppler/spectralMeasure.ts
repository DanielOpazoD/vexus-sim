import { extremeInWindow, median, type TimeWindow } from '../core/series';
import { velocityFromShiftMmS } from '../core/units';
import type { Beat } from '../physiology/rhythm';
import { beatWindows, systolicPeak } from '../vexus/measurements';
import {
  hepaticPatternFromPeaks,
  portalPulsatilityFraction,
  renalPatternFromPeaks,
  type HepaticPattern,
  type RenalPattern,
} from '../vexus/classification';
import { columnEnvelope, noiseFloorDb, type SpectralColumn } from './spectral';

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
  vMax: number;
  vMin: number;
  pulsatilityFraction: number;
  beats: number;
  anterogradeSign: number;
  trace: ObservedTracePoint[];
}

export interface ObservedRenal {
  kind: 'renal';
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
}

export function observedTrace(columns: readonly SpectralColumn[], opts: MeasureOptions): ObservedTracePoint[] {
  const margin = opts.thresholdMarginDb ?? 12;
  const out: ObservedTracePoint[] = [];
  for (const col of columns) {
    const floor = noiseFloorDb(col);
    const env = columnEnvelope(col, opts.fftSize, floor + margin);
    const f = env.fEnvelope;
    const vMm = velocityFromShiftMmS(f, opts.f0Hz, opts.angleCorrectionRad);
    const v = (Number.isFinite(vMm) ? vMm / 10 : 0) * (opts.invert ? -1 : 1);
    out.push({ t: col.t, vScreen: v, powerDb: Math.max(env.powerPosDb, env.powerNegDb) });
  }
  return out;
}

const extreme = (trace: readonly { t: number; vScreen: number }[], w: TimeWindow, pick: (v: number) => number): number =>
  extremeInWindow(
    trace,
    w,
    (p) => p.t,
    (p) => p.vScreen,
    pick,
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
    const s = systolicPeak(oriented, w.sWindow, (p) => p.vScreen);
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
    vMax: median(maxs),
    vMin: median(mins),
    pulsatilityFraction: median(pfs),
    beats: maxs.length,
    anterogradeSign,
    trace,
  };
}

/**
 * Vena interlobar: el sentido anterógrado (hacia el hilio) se toma como el signo
 * dominante, igual que en la porta; S y D en las ventanas mecánicas del ECG.
 */
export function measureObservedRenal(columns: readonly SpectralColumn[], beats: Beat[], opts: MeasureOptions): ObservedRenal | null {
  const trace = observedTrace(columns, opts);
  if (trace.length < 10) return null;
  const meanV = trace.reduce((a, p) => a + p.vScreen, 0) / trace.length;
  const anterogradeSign = meanV >= 0 ? 1 : -1;
  const oriented = trace.map((p) => ({ t: p.t, vScreen: p.vScreen * anterogradeSign, powerDb: p.powerDb }));
  const sList: number[] = [];
  const dList: number[] = [];
  const minList: number[] = [];
  for (const b of beats) {
    const w = beatWindows(b);
    const cyc: [number, number] = [b.tR, b.tR + b.rr];
    const s = extreme(oriented, w.sWindow, (v) => v);
    const d = extreme(oriented, w.dWindow, (v) => v);
    const mn = extreme(oriented, cyc, (v) => -v);
    if ([s, d, mn].some((x) => Number.isNaN(x))) continue;
    sList.push(s);
    dList.push(d);
    minList.push(mn);
  }
  if (!sList.length) return null;
  const sPeak = median(sList);
  const dPeak = median(dList);
  const vMin = median(minList);
  return {
    kind: 'renal',
    sPeak,
    dPeak,
    vMin,
    pattern: renalPatternFromPeaks(sPeak, dPeak, vMin),
    beats: sList.length,
    anterogradeSign,
    trace,
  };
}
