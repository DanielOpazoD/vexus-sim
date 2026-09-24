import { Tissue } from '../anatomy/tissues';
import { pointOnLine } from '../probe/probe';
import { clearLiverGrid } from './fidelity';
import type { Simulator } from './simulator';

/**
 * Estadística del speckle del modo B (Fase 3), como guarda de fidelidad de imagen: sobre la
 * envolvente detectada (antes de la compresión) en parénquima hepático lejos de interfaces (en la
 * anatomía TS, ≥ 6 mm de cualquier otro tejido en el plano, vasos incluidos, y ≥ 6 mm del borde del
 * hígado en 3D), la relación señal/ruido media/desviación de un speckle plenamente desarrollado es la
 * de Rayleigh, √(π/(4−π)) ≈ 1,91 (Burckhardt 1978; Wagner 1983).
 *
 * Se estima por parches (muestras × líneas) y se promedia. El tamaño importa: un segmento de
 * 16 muestras en una sola línea abarca ~4 células de speckle axiales y la desviación sale
 * sesgada a la baja (SNR ≈ 2,5 sobre la misma imagen); parches grandes mezclan la TGC, el foco
 * y la heterogeneidad lenta del parénquima (SNR < 1,7). 16 × 8 (≈ 2,8 mm × 8 líneas a 18 cm)
 * queda en 1,7–2,05 en los cuatro puntos de partida.
 */
export const RAYLEIGH_SNR = Math.sqrt(Math.PI / (4 - Math.PI));

/** Parche por defecto: 16 muestras de profundidad × 8 líneas. */
export const SPECKLE_PATCH = { axial: 16, lateral: 8 } as const;
/**
 * Distancia mínima (mm) del parche a cualquier tejido que no sea hígado: en el plano, vasos incluidos
 * (`clearLiverGrid`), y al borde del hígado en 3D (`boundaryDistance`, que no cuenta los vasos).
 */
export const SPECKLE_CLEARANCE_MM = 6;

export interface SpeckleStats {
  /** Muestras de parénquima usadas. */
  samples: number;
  /** SNR = media/desviación promedio de los parches. */
  snr: number;
  /** Parches que entraron en el promedio. */
  patches: number;
}

export interface SpeckleOptions {
  /** Muestras en profundidad por parche. */
  axial?: number;
  /** Líneas por parche. */
  lateral?: number;
}

/** Envolvente de un cuadro: `data[muestra · lines + línea]`. */
export interface EnvelopeFrame {
  lines: number;
  samples: number;
  data: Float32Array;
}

/**
 * SNR media de los parches cuyas muestras cumplen TODAS `inside(línea, muestra)`. Antes bastaban
 * nueve de control (esquinas, centros de lado y centro) y un vaso de 2 mm entre ellas entraba en el
 * parche. Pura: la prueban campos sintéticos sin WebGL.
 */
export function patchSnr(env: EnvelopeFrame, inside: (line: number, sample: number) => boolean, opts: SpeckleOptions = {}): SpeckleStats {
  const AX = opts.axial ?? SPECKLE_PATCH.axial;
  const LAT = opts.lateral ?? SPECKLE_PATCH.lateral;
  let snrSum = 0;
  let patches = 0;
  let used = 0;
  for (let u0 = 0; u0 + LAT <= env.lines; u0 += LAT) {
    for (let v0 = 0; v0 + AX <= env.samples; v0 += AX) {
      let ok = true;
      for (let u = u0; ok && u < u0 + LAT; u++) for (let v = v0; ok && v < v0 + AX; v++) if (!inside(u, v)) ok = false;
      if (!ok) continue;
      let m = 0;
      let m2 = 0;
      for (let u = u0; u < u0 + LAT; u++)
        for (let v = v0; v < v0 + AX; v++) {
          const x = env.data[v * env.lines + u];
          m += x;
          m2 += x * x;
        }
      const n = AX * LAT;
      m /= n;
      const sd = Math.sqrt(Math.max(1e-30, m2 / n - m * m));
      snrSum += m / sd;
      patches++;
      used += n;
    }
  }
  return { samples: used, snr: patches ? snrSum / patches : Number.NaN, patches };
}

/**
 * Máscara de la guarda de Rayleigh en el plano actual: la muestra (línea u, muestra v) está en hígado a
 * ≥ 6 mm de cualquier otro tejido en el plano (`clearLiverGrid`: rejilla de líneas × 0,5 mm, vasos
 * incluidos, lo de fuera del sector cuenta como otro tejido) y a ≥ 6 mm del borde del hígado en 3D
 * (`boundaryDistance` en la propia muestra: la rejilla no ve una frontera fuera del plano). Con las dos,
 * es más estricta que la de antes (9 puntos de control con la condición 3D).
 */
export function speckleMask(sim: Simulator, env: EnvelopeFrame): (line: number, sample: number) => boolean {
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  const clear = clearLiverGrid(sim, env.lines, SPECKLE_CLEARANCE_MM);
  return (u, v) => {
    const r = ((v + 0.5) / env.samples) * depth;
    if (!clear.at(u, r)) return false;
    const theta = -tr.halfSector + (2 * tr.halfSector * (u + 0.5)) / env.lines;
    const q = sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, theta, r), sim.sample);
    return q.tissue === Tissue.Liver && q.boundaryDistance >= SPECKLE_CLEARANCE_MM;
  };
}

/** SNR del speckle en hígado profundo del plano actual del simulador, con la máscara de `speckleMask`. */
export function speckleStats(sim: Simulator, env: EnvelopeFrame, opts: SpeckleOptions = {}): SpeckleStats {
  return patchSnr(env, speckleMask(sim, env), opts);
}
