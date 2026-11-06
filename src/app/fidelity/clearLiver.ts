import { pointOnLine } from '../../probe/probe';
import type { Simulator } from '../simulator';
import { curtainLines } from './curtain';
import { CURTAIN_LIVER_MAX_AIR, GRID_STEP_MM, LIVER, LUNG, clearanceMask } from './grid';

/**
 * Hígado despejado del plano: la máscara de la envolvente del banco, que la guarda de Rayleigh (`../speckle.ts`) usa con
 * la distancia 3D al borde del hígado.
 */

/** Hígado despejado de un plano: celdas de hígado lejos de cualquier otro tejido, vasos incluidos. */
export interface ClearGrid {
  lines: number;
  nr: number;
  stepMm: number;
  ok: Uint8Array;
  /** ¿Es hígado despejado la línea `u` a la profundidad `r` (mm)? */
  at: (u: number, r: number) => boolean;
}

/**
 * Hígado a ≥ `mm` de cualquier tejido que no sea hígado EN EL PLANO actual (vasos incluidos: la
 * `boundaryDistance` del hígado no cuenta los tubos; fuera del sector cuenta como otro tejido), sobre la
 * rejilla de `lines` líneas × 0,5 mm del banco. Es la máscara de la envolvente del banco; la guarda de
 * Rayleigh (`speckleStats`) le añade la distancia 3D al borde del hígado, que la rejilla no ve.
 */
export function clearLiverGrid(sim: Simulator, lines: number, mm: number): ClearGrid {
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  const dTheta = (2 * tr.halfSector) / lines;
  const nr = Math.floor(depth / GRID_STEP_MM);
  const tissue = new Uint8Array(lines * nr);
  // bajo la pleura de la cortina (decisión 61), también en su borde blando, no hay hígado puro: pulmón
  const curtain = curtainLines(sim, lines);
  for (let u = 0; u < lines; u++) {
    const theta = -tr.halfSector + dTheta * (u + 0.5);
    const c = curtain[u];
    const lungFrom = c && c.fAir >= CURTAIN_LIVER_MAX_AIR ? c.D : Infinity;
    for (let k = 0; k < nr; k++) {
      const r = (k + 0.5) * GRID_STEP_MM;
      tissue[u * nr + k] = r >= lungFrom ? LUNG : sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, theta, r), sim.sample).tissue;
    }
  }
  const ok = clearanceMask(tissue, lines, nr, GRID_STEP_MM, (k) => (tr.curvatureRadius + (k + 0.5) * GRID_STEP_MM) * dTheta, mm, LIVER);
  return {
    lines,
    nr,
    stepMm: GRID_STEP_MM,
    ok,
    at: (u, r) => {
      const k = Math.floor(r / GRID_STEP_MM);
      return u >= 0 && u < lines && k >= 0 && k < nr && ok[u * nr + k] === 1;
    },
  };
}
