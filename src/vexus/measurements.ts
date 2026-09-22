import type { PhysiologyEngine, PhysiologySample } from '../physiology/engine';
import { extremeInWindow as extremeOf, median, type TimeWindow } from '../core/series';
import { mmsToCms } from '../core/units';
import {
  hepaticPatternFromPeaks,
  portalPulsatilityFraction,
  renalPatternFromPeaks,
  type HepaticPattern,
  type RenalPattern,
} from './classification';

/**
 * Mediciones sobre la VERDAD fisiológica (referencia del caso). Son distintas
 * de las mediciones sobre la señal adquirida (espectro observado), que viven
 * en doppler/spectralMeasure.ts. Ambas comparten las mismas ventanas
 * temporales ancladas a eventos mecánicos (D.2, D.3).
 */
export interface TruthMeasurements {
  pRaMin: number;
  pRaMax: number;
  pHepMean: number;
  pSpMean: number;
  pIvcMean: number;
  ptmIvcMean: number;
  ivcMaxMm: number;
  ivcMinMm: number;
  ivcCollapse: number;
  /** Picos suprahepáticos (cm/s, positivo = hacia AD), mediana por latido. */
  hvS: number;
  hvD: number;
  hvA: number;
  hvSD: number;
  hepaticPattern: HepaticPattern;
  pvMax: number;
  pvMin: number;
  portalPF: number;
  haPsv: number;
  haEdv: number;
  /** Vena interlobar (cm/s, positivo = hacia el hilio): picos S y D y mínimo del ciclo. */
  rvS: number;
  rvD: number;
  rvMin: number;
  renalPattern: RenalPattern;
  raPsv: number;
  raEdv: number;
  qHvMean: number;
  qPvMean: number;
  qHaMean: number;
  beats: number;
}

export interface BeatWindows {
  sWindow: [number, number];
  vWindow: [number, number];
  dWindow: [number, number];
  aWindow: [number, number];
}

/**
 * Pico sistólico con signo: si durante la sístole mecánica existe flujo
 * retrógrado apreciable (≤ −2 cm/s y ≥ 25 % del máximo anterógrado) se
 * informa como S invertida (valor negativo); si no, el máximo anterógrado.
 * Regla de lectura [EXTRAPOLACIÓN PROPIA] coherente con A.1 («S retrógrada»).
 */
export function systolicPeak<T extends { t: number }>(samples: readonly T[], w: TimeWindow, get: (s: T) => number): number {
  let vmax = Number.NaN;
  let vmin = Number.NaN;
  for (const s of samples) {
    if (!(s.t >= w[0] && s.t <= w[1])) continue; // ventana NaN = vacía
    const v = get(s);
    if (Number.isNaN(vmax) || v > vmax) vmax = v;
    if (Number.isNaN(vmin) || v < vmin) vmin = v;
  }
  if (Number.isNaN(vmax)) return Number.NaN;
  if (vmin <= -2 && -vmin >= 0.25 * Math.max(0, vmax)) return vmin;
  return vmax;
}

/** Ventanas mecánicas de un latido a partir de sus eventos (s absolutos). */
export function beatWindows(b: { tR: number; rr: number; tX: number; tV: number; tY: number; tAtrialContraction: number }): BeatWindows {
  const s = Math.sqrt(b.rr / 0.8);
  return {
    sWindow: [b.tX - 0.06 * s, b.tV - 0.02 * s],
    vWindow: [b.tV - 0.04 * s, b.tV + 0.04 * s],
    dWindow: [b.tY - 0.07 * s, Math.min(b.tY + 0.22 * s, b.tR + b.rr - 0.02)],
    aWindow: [b.tAtrialContraction - 0.08, b.tAtrialContraction + 0.09],
  };
}

const extremeInWindow = (
  samples: readonly PhysiologySample[],
  w: TimeWindow,
  pick: (v: number) => number,
  get: (s: PhysiologySample) => number,
): number => extremeOf(samples, w, (s) => s.t, get, pick);

export function measurePhysiologyTruth(engine: PhysiologyEngine, range: { fromT: number; toT: number }): TruthMeasurements {
  const all = engine.samples.filter((s) => s.t >= range.fromT && s.t <= range.toT);
  if (all.length < 10) throw new Error('Historial insuficiente para medir');
  const mean = (get: (s: PhysiologySample) => number) => all.reduce((a, s) => a + get(s), 0) / all.length;
  const hv = (s: PhysiologySample) => mmsToCms(s.velocities.hvRight);
  const pv = (s: PhysiologySample) => mmsToCms(s.velocities.pvTrunk);
  const ha = (s: PhysiologySample) => mmsToCms(s.velocities.hepaticArtery);
  const rv = (s: PhysiologySample) => mmsToCms(s.velocities.interlobarVein2);
  const ra = (s: PhysiologySample) => mmsToCms(s.velocities.interlobarArtery2);

  const beatIdx = new Set(all.map((s) => s.beatIndex));
  const sList: number[] = [];
  const dList: number[] = [];
  const aList: number[] = [];
  const pfList: number[] = [];
  const pvMaxList: number[] = [];
  const pvMinList: number[] = [];
  const psvList: number[] = [];
  const edvList: number[] = [];
  const rvSList: number[] = [];
  const rvDList: number[] = [];
  const rvMinList: number[] = [];
  const raPsvList: number[] = [];
  const raEdvList: number[] = [];
  for (const idx of beatIdx) {
    const first = all.find((s) => s.beatIndex === idx)!;
    const beat = engine.rhythm.currentBeat(first.lastR + 1e-6);
    if (beat.index !== idx) continue;
    if (beat.tR < range.fromT || beat.tR + beat.rr > range.toT) continue;
    const w = beatWindows(beat);
    const sPeak = systolicPeak(all, w.sWindow, hv);
    const dPeak = extremeInWindow(all, w.dWindow, (v) => v, hv);
    const aPeak = extremeInWindow(all, w.aWindow, (v) => -v, hv);
    // La onda A puede no existir (fibrilación auricular: ventana indefinida); S y D son obligatorias
    if (Number.isNaN(sPeak) || Number.isNaN(dPeak)) continue;
    sList.push(sPeak);
    dList.push(dPeak);
    if (!Number.isNaN(aPeak)) aList.push(aPeak);
    const cyc: [number, number] = [beat.tR, beat.tR + beat.rr];
    const vmax = extremeInWindow(all, cyc, (v) => v, pv);
    const vmin = extremeInWindow(all, cyc, (v) => -v, pv);
    pvMaxList.push(vmax);
    pvMinList.push(vmin);
    pfList.push(portalPulsatilityFraction(vmax, vmin));
    psvList.push(extremeInWindow(all, cyc, (v) => v, ha));
    edvList.push(extremeInWindow(all, cyc, (v) => -v, ha));
    // Renal: S en la ventana sistólica, D en la diastólica (mismas ventanas mecánicas)
    rvSList.push(extremeInWindow(all, w.sWindow, (v) => v, rv));
    rvDList.push(extremeInWindow(all, w.dWindow, (v) => v, rv));
    rvMinList.push(extremeInWindow(all, cyc, (v) => -v, rv));
    raPsvList.push(extremeInWindow(all, cyc, (v) => v, ra));
    raEdvList.push(extremeInWindow(all, cyc, (v) => -v, ra));
  }
  const hvS = median(sList);
  const hvD = median(dList);
  const ivcMax = Math.max(...all.map((s) => s.ivc.dApMm));
  const ivcMin = Math.min(...all.map((s) => s.ivc.dApMm));
  return {
    pRaMin: Math.min(...all.map((s) => s.pRa)),
    pRaMax: Math.max(...all.map((s) => s.pRa)),
    pHepMean: mean((s) => s.pHepatic),
    pSpMean: mean((s) => s.pSplanchnic),
    pIvcMean: mean((s) => s.pIvc),
    ptmIvcMean: mean((s) => s.pIvcTransmural),
    ivcMaxMm: ivcMax,
    ivcMinMm: ivcMin,
    ivcCollapse: (ivcMax - ivcMin) / ivcMax,
    hvS,
    hvD,
    hvA: median(aList),
    hvSD: hvS / hvD,
    hepaticPattern: hepaticPatternFromPeaks(hvS, hvD),
    pvMax: median(pvMaxList),
    pvMin: median(pvMinList),
    portalPF: median(pfList),
    haPsv: median(psvList),
    haEdv: median(edvList),
    rvS: median(rvSList),
    rvD: median(rvDList),
    rvMin: median(rvMinList),
    renalPattern: renalPatternFromPeaks(median(rvSList), median(rvDList), median(rvMinList)),
    raPsv: median(raPsvList),
    raEdv: median(raEdvList),
    qHvMean: mean((s) => s.qHepaticVein),
    qPvMean: mean((s) => s.qPortal),
    qHaMean: mean((s) => s.qHepaticArtery),
    beats: sList.length,
  };
}
