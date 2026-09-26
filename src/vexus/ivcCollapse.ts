import type { PhysiologySample } from '../physiology/engine';

/**
 * Colapsabilidad de la VCI (decisión 80): el índice (máx − mín)/máx en %, el de dos calibres del modo M (el
 * orden no importa) y la verdad del motor en una ventana: el diámetro AP de `sample.ivc` a lo largo del ciclo
 * respiratorio, latido incluido, como lo recorre la franja M.
 */
export interface IvcCollapse {
  maxMm: number;
  minMm: number;
  ciPct: number;
}

export function collapsibilityIndex(maxMm: number, minMm: number): number {
  return maxMm > 0 ? (100 * (maxMm - minMm)) / maxMm : Number.NaN;
}

/** Dos diámetros (mm) medidos con los calibres del modo M. */
export function ivcFromCalipers(d1: number, d2: number): IvcCollapse {
  const maxMm = Math.max(d1, d2);
  const minMm = Math.min(d1, d2);
  return { maxMm, minMm, ciPct: collapsibilityIndex(maxMm, minMm) };
}

/** Verdad en [t0, t1] (null sin muestras en la ventana). */
export function ivcTruth(samples: readonly PhysiologySample[], t0: number, t1: number): IvcCollapse | null {
  let maxMm = -Infinity;
  let minMm = Infinity;
  for (const s of samples) {
    if (s.t < t0 || s.t > t1) continue;
    maxMm = Math.max(maxMm, s.ivc.dApMm);
    minMm = Math.min(minMm, s.ivc.dApMm);
  }
  return Number.isFinite(maxMm) ? { maxMm, minMm, ciPct: collapsibilityIndex(maxMm, minMm) } : null;
}
