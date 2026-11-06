import type { EnvelopeFrame } from '../speckle';
import { TEXTURE_PATCH, envelopeTexture, type EnvelopeGeometry, type EnvelopeTexture } from './envelope';
import type { TransmissionFrame } from './grid';
import { pearson } from './statistics';

/**
 * Composición espacial en el banco (decisión 58): las miradas del anillo, su correlación, la textura del compuesto por
 * banda y la costura.
 */

/**
 * Miradas del anillo tras llenarlo (composición espacial, decisión 58), en el orden de adquisición: su θ,
 * su envolvente (la ranura del anillo) y su transmisión (pasada A del cuadro que la formó: la de la mirada 0
 * o la del camino dirigido que llega a cada celda).
 */
export interface LookFrames {
  thetas: readonly number[];
  envelopes: readonly EnvelopeFrame[];
  transmissions: readonly TransmissionFrame[];
}

/**
 * Correlación de la intensidad entre miradas en una máscara (decisión 58): la media de parches (48 × 16)
 * de la correlación de Pearson de |env|² con la compensación nominal (la envolvente de la GPU lleva la
 * atenuación: su tendencia común inflaría ρ). Un valor por par (i < j, en orden: con 0, +θ, −θ, los pares
 * (0,+), (0,−) y (+,−)).
 */
export function lookCorrelations(
  looks: readonly EnvelopeFrame[],
  inside: (line: number, sample: number) => boolean,
  depthMm: number,
  tgcDbPerCm: number,
  patch: { axial: number; lateral: number } = TEXTURE_PATCH,
  beamGain: (r: number) => number = () => 1,
): { patches: number; pairs: number[] } {
  const n = looks.length;
  const { lines, samples } = looks[0];
  const dr = depthMm / samples;
  // la intensidad a la misma escala en la profundidad: sin la atenuación nominal ni la ganancia focal (`envelopeLine`)
  const gain2 = Float64Array.from(
    { length: samples },
    (_, v) => Math.pow(10, (tgcDbPerCm * ((v + 0.5) * dr)) / 100) / beamGain((v + 0.5) * dr) ** 2,
  );
  const acc = new Float64Array((n * (n - 1)) / 2);
  let patches = 0;
  const I = looks.map(() => new Float64Array(patch.axial * patch.lateral));
  for (let u0 = 0; u0 + patch.lateral <= lines; u0 += patch.lateral)
    for (let v0 = 0; v0 + patch.axial <= samples; v0 += patch.axial) {
      let ok = true;
      for (let u = u0; ok && u < u0 + patch.lateral; u++) for (let v = v0; ok && v < v0 + patch.axial; v++) if (!inside(u, v)) ok = false;
      if (!ok) continue;
      looks.forEach((e, k) => {
        let i = 0;
        for (let v = v0; v < v0 + patch.axial; v++)
          for (let u = u0; u < u0 + patch.lateral; u++) {
            const x = e.data[v * lines + u];
            I[k][i++] = x * x * gain2[v];
          }
      });
      let p = 0;
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) acc[p++] += pearson(I[a], I[b]);
      patches++;
    }
  return { patches, pairs: Array.from(acc, (x) => (patches ? x / patches : Number.NaN)) };
}

/** Media de la envolvente en las muestras de la máscara (NaN sin muestras). */
export function maskedMean(env: EnvelopeFrame, inside: (line: number, sample: number) => boolean): number {
  let s = 0;
  let n = 0;
  for (let v = 0; v < env.samples; v++)
    for (let u = 0; u < env.lines; u++)
      if (inside(u, v)) {
        s += env.data[v * env.lines + u];
        n++;
      }
  return n ? s / n : Number.NaN;
}

/**
 * Composición espacial en una banda de hígado puro con las tres miradas (decisión 58): la textura del
 * compuesto y de cada mirada en la misma máscara, la ganancia de SNR, la razón de grano (compuesto/mirada
 * 0: 0,9–1,1, no es un filtro de suavizado, §23), la correlación entre miradas frente a la ley gaussiana
 * con la σ del grano lateral medido de la mirada 0, y N_eff = N²/Σρ_ij.
 */
export interface CompoundBand {
  r0: number;
  r1: number;
  compound: EnvelopeTexture;
  look0: EnvelopeTexture;
  /** Cada mirada (en el orden del anillo) y su media respecto a la de la mirada 0. */
  perLook: (EnvelopeTexture & { meanRatio: number })[];
  snrGain: number;
  grainRatioLateral: number;
  grainRatioAxial: number;
  correlationPatches: number;
  /** ρ_I de los pares (0,+), (0,−) y (+,−), y la ley con β y 2β a la profundidad media de la banda. */
  rho0p: number;
  rho0m: number;
  rhoPm: number;
  law1: number;
  law2: number;
  nEff: number;
  nEffLaw: number;
}

/**
 * Costura del compuesto (decisión 58): SNR de la envolvente compuesta en parches de 8 líneas × 48 muestras
 * (`SEAM_PATCH`) enteros en la banda de dos miradas (la 0 y una dirigida: el borde del arreglo de la otra)
 * frente a los de tres miradas, en la misma banda de profundidad y en hígado puro. `ratio` = SNR₂/SNR₃, NaN
 * con < 5 parches en alguna de las dos. Con parches de 16 líneas nunca cabría uno en la costura (5–15 líneas).
 */
export interface SeamStats {
  r0: number;
  r1: number;
  patches2: number;
  patches3: number;
  snr2: number;
  snr3: number;
  ratio: number;
}

/** Parche de la costura: 8 líneas × 48 muestras. */
export const SEAM_PATCH = { axial: 48, lateral: 8 } as const;
/** Parches mínimos por lado para dar la razón de la costura. */
export const SEAM_MIN_PATCHES = 5;

/** `SeamStats` de una banda con las máscaras de dos y de tres miradas. */
export function seamStats(
  env: EnvelopeFrame,
  inside2: (line: number, sample: number) => boolean,
  inside3: (line: number, sample: number) => boolean,
  geom: EnvelopeGeometry,
  band: { r0: number; r1: number },
): SeamStats {
  const t2 = envelopeTexture(env, inside2, geom, SEAM_PATCH);
  const t3 = envelopeTexture(env, inside3, geom, SEAM_PATCH);
  const ok = t2.patches >= SEAM_MIN_PATCHES && t3.patches >= SEAM_MIN_PATCHES;
  return {
    ...band,
    patches2: t2.patches,
    patches3: t3.patches,
    snr2: t2.snr,
    snr3: t3.snr,
    ratio: ok ? t2.snr / t3.snr : Number.NaN,
  };
}

/** Composición espacial del plano (decisión 58): por banda de profundidad y en la costura. */
export interface CompoundStats {
  thetas: number[];
  bands: CompoundBand[];
  seam: SeamStats[];
}
