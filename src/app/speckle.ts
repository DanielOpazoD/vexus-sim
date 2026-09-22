import { Tissue } from '../anatomy/tissues';
import { pointOnLine } from '../probe/probe';
import type { Simulator } from './simulator';

/**
 * Estadística del speckle del modo B (Fase 3), como guarda de fidelidad de imagen: sobre la
 * envolvente detectada (antes de la compresión) en parénquima hepático lejos de interfaces
 * (≥ 6 mm en la anatomía TS), la relación señal/ruido media/desviación de un speckle plenamente
 * desarrollado es la de Rayleigh, √(π/(4−π)) ≈ 1,91 (Burckhardt 1978; Wagner 1983).
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
 * SNR media de los parches cuyas nueve muestras de control (esquinas, centros de lado y centro)
 * cumplen `inside(línea, muestra)`. Pura: la prueban campos sintéticos sin WebGL.
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
      for (const u of [u0, u0 + ((LAT - 1) >> 1), u0 + LAT - 1])
        for (const v of [v0, v0 + (AX >> 1), v0 + AX - 1]) if (ok && !inside(u, v)) ok = false;
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

/** SNR del speckle en hígado profundo del plano actual del simulador. */
export function speckleStats(sim: Simulator, env: EnvelopeFrame, opts: SpeckleOptions = {}): SpeckleStats {
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  return patchSnr(
    env,
    (u, v) => {
      const theta = -tr.halfSector + (2 * tr.halfSector * (u + 0.5)) / env.lines;
      const r = ((v + 0.5) / env.samples) * depth;
      const q = sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, theta, r), sim.sample);
      return q.tissue === Tissue.Liver && q.boundaryDistance >= 6;
    },
    opts,
  );
}
