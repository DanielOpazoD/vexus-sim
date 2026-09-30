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

/** Intervalo por cuantización: cada borde ±medio píxel CSS; no incluye selección de pared ni error físico. */
export function ivcPixelInterval(maxMm: number, minMm: number, pixelMm: number): [number, number] {
  return [
    maxMm > pixelMm ? Math.max(0, collapsibilityIndex(maxMm - pixelMm, minMm + pixelMm)) : 0,
    collapsibilityIndex(maxMm + pixelMm, Math.max(0, minMm - pixelMm)),
  ];
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

/** Un ciclo observado continuo en la ventana, desde la señal respiratoria, no desde diámetros ocultos. */
export function hasRespiratoryCycle(
  samples: readonly { t: number; resp: { cycling: boolean; phase: number; volume: number } }[],
  t0: number,
  t1: number,
): boolean {
  let previous: number | null = null;
  let travel = 0;
  let min = 1;
  let max = 0;
  for (const s of samples) {
    if (s.t < t0 || s.t > t1) continue;
    if (!s.resp.cycling) {
      previous = null;
      travel = 0;
      min = 1;
      max = 0;
      continue;
    }
    if (previous !== null) {
      const step = (s.resp.phase - previous + 1) % 1;
      // Un salto mayor a 1/8 de ciclo no acredita cobertura continua.
      if (step > 0.125) {
        travel = 0;
        min = 1;
        max = 0;
      } else travel += step;
    }
    previous = s.resp.phase;
    min = Math.min(min, s.resp.volume);
    max = Math.max(max, s.resp.volume);
    // 1e-9 solo absorbe redondeo de fase; 0.05/0.95 cubren los extremos del trazado normalizado.
    if (travel >= 1 - 1e-9 && min <= 0.05 && max >= 0.95) return true;
  }
  return false;
}
