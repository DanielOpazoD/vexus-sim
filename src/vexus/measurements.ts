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
  /**
   * Vena interlobar (cm/s, positivo = hacia el hilio): picos S y D y mínimo resoluble del ciclo
   * (el valle sostenido `RENAL_GAP_MIN_S`, `resolvableMinimum`).
   */
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
 * retrógrado apreciable (≤ −2 cm/s y ≥ 50 % del máximo anterógrado) se
 * informa como S invertida (valor negativo); si no, el máximo anterógrado.
 * El 50 % (antes 25 %, decisión 5 → 44) distingue la inversión de la onda S de
 * la muesca retrógrada breve de la onda C al inicio de la sístole: con 25 % una
 * muesca de FA pasaba por «S invertida» al medirla sobre la envolvente
 * (≈ 1,5× la velocidad media). Regla [EXTRAPOLACIÓN PROPIA] coherente con A.1.
 */
/** Fracción del pico anterógrado que debe alcanzar el retrógrado sistólico para «S invertida». */
export const S_REVERSAL_FRACTION = 0.5;

export function systolicPeak<T extends { t: number }>(samples: readonly T[], w: TimeWindow, get: (s: T) => number, q = 1): number {
  // q < 1: extremos robustos (cuantiles q y 1 − q) para trazas medidas sobre el espectro
  const vals: number[] = [];
  for (const s of samples) {
    if (!(s.t >= w[0] && s.t <= w[1])) continue; // ventana NaN = vacía
    vals.push(get(s));
  }
  if (!vals.length) return Number.NaN;
  vals.sort((a, b) => a - b);
  const at = (f: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(f * (vals.length - 1) + 0.5)))];
  const vmax = at(q);
  const vmin = at(1 - q);
  if (vmin <= -2 && -vmin >= S_REVERSAL_FRACTION * Math.max(0, vmax)) return vmin;
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

/**
 * Duración mínima de una interrupción del flujo renal para que cuente (s). Una pausa más breve no
 * llega a la línea de base en el espectro: la ventana de análisis (128 muestras, 21–49 ms a
 * 6000–2600 Hz), el suavizado y la mediana de la traza mezclan el flujo de sus bordes. 20 ms es lo
 * que resuelve la captura a ~4 kHz (IQ sintética por la cadena real, cuatro semillas); a 1,5–2,6 kHz
 * se pierden pausas de 20–30 ms y a 6 kHz se ven las de 10 ms (`renal-pause-resolution-prf`). La
 * verdad usa esa resolución para decir lo mismo que la medición [EXTRAPOLACIÓN PROPIA].
 */
export const RENAL_GAP_MIN_S = 0.02;

/**
 * Mínimo resoluble en la ventana `w`: el mínimo del máximo móvil de ancho `width` (s). Es el valle
 * que un análisis con esa ventana puede mostrar; una pausa más breve que `width` no llega a cero.
 * Las muestras deben estar ordenadas por tiempo; el máximo móvil puede asomarse fuera de `w`.
 */
export function resolvableMinimum<T extends { t: number }>(
  samples: readonly T[],
  w: TimeWindow,
  get: (s: T) => number,
  width: number,
): number {
  const half = width / 2;
  let best = Number.NaN;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = samples[i].t;
    if (!(t >= w[0] && t <= w[1])) continue;
    while (lo < samples.length && samples[lo].t < t - half) lo++;
    while (hi < samples.length && samples[hi].t <= t + half) hi++;
    let localMax = -Infinity;
    for (let j = lo; j < hi; j++) localMax = Math.max(localMax, get(samples[j]));
    if (Number.isNaN(best) || localMax < best) best = localMax;
  }
  return best;
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
    rvMinList.push(resolvableMinimum(all, cyc, rv, RENAL_GAP_MIN_S));
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
