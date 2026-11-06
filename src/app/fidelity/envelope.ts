import type { EnvelopeFrame } from '../speckle';

/**
 * Banco de fidelidad, primer nivel (decisión 52): la textura de la envolvente antes de la compresión, la física del
 * moteado (SNR, grano, lóbulo secundario, fracción oscura e índice de grietas).
 */

/** Geometría de la envolvente para pasar de muestras y líneas a mm. */
export interface EnvelopeGeometry {
  depthMm: number;
  halfSector: number;
  curvatureRadius: number;
}

export interface EnvelopeTexture {
  patches: number;
  /** Profundidad media de los parches (mm). */
  depthMm: number;
  /** Media/desviación de la envolvente (Rayleigh: 1,91). */
  snr: number;
  /** FWHM de la autocovarianza de la envolvente: tamaño del grano. */
  fwhmAxialMm: number;
  fwhmLateralMm: number;
  /** Máximo de la autocovarianza tras su primer mínimo: ≈ 0 sin periodicidad. */
  secondaryLobeAxial: number;
  secondaryLobeLateral: number;
  /** Fracción de muestras por debajo de `DARK_LEVEL` × la media del parche. */
  darkFraction: number;
  /** Fracción de las muestras oscuras en componentes de al menos `CRACK_GRAINS` granos de largo. */
  crackIndex: number;
}

/** Parche por defecto: 48 muestras (≈ 8 mm a 18 cm) × 16 líneas (≈ 13 mm a 7 cm). */
export const TEXTURE_PATCH = { axial: 48, lateral: 16 } as const;
const LAG_AXIAL = 20;
const LAG_LATERAL = 8;

/** Umbral de «oscuro» como fracción de la media local de la envolvente. */
export const DARK_LEVEL = 0.3;
/** Fracción oscura de un moteado de Rayleigh: P(A < 0,3·μ) = 1 − exp(−0,3²·π/4) ≈ 0,068. */
export const RAYLEIGH_DARK_FRACTION = 1 - Math.exp((-DARK_LEVEL * DARK_LEVEL * Math.PI) / 4);
/** Longitud mínima, en granos (FWHM), de un componente oscuro que cuenta como grieta. */
export const CRACK_GRAINS = 2;

const EMPTY_TEXTURE: EnvelopeTexture = {
  patches: 0,
  depthMm: Number.NaN,
  snr: Number.NaN,
  fwhmAxialMm: Number.NaN,
  fwhmLateralMm: Number.NaN,
  secondaryLobeAxial: Number.NaN,
  secondaryLobeLateral: Number.NaN,
  darkFraction: Number.NaN,
  crackIndex: Number.NaN,
};

/**
 * Textura de la envolvente en los parches cuyas muestras cumplen todas `inside(línea, muestra)`
 * (el predicado debe ser barato: se consulta en cada muestra). La autocovarianza se promedia entre
 * parches (cada uno normalizado por su varianza) y la topología de lo oscuro se mide con
 * componentes conexos (vecindad 4) dentro de cada parche, con la longitud en granos de ese
 * promedio. Si el grano no se puede medir (la autocovarianza no baja de 0,5 dentro del parche), el
 * índice de grietas y los lóbulos son NaN, no 0.
 */
export function envelopeTexture(
  env: EnvelopeFrame,
  inside: (line: number, sample: number) => boolean,
  geom: EnvelopeGeometry,
  patch: { axial: number; lateral: number } = TEXTURE_PATCH,
): EnvelopeTexture {
  const AX = patch.axial;
  const LAT = patch.lateral;
  const at = (u: number, v: number): number => env.data[v * env.lines + u];
  const dr = geom.depthMm / env.samples;
  const dTheta = (2 * geom.halfSector) / env.lines;
  const lagAx = Math.min(LAG_AXIAL, AX - 1);
  const lagLat = Math.min(LAG_LATERAL, LAT - 1);
  const accAx = new Float64Array(lagAx + 1);
  const accLat = new Float64Array(lagLat + 1);
  const chosen: { u0: number; v0: number; mean: number }[] = [];
  let snrSum = 0;
  let depthSum = 0;
  let spacingSum = 0;
  for (let u0 = 0; u0 + LAT <= env.lines; u0 += LAT) {
    for (let v0 = 0; v0 + AX <= env.samples; v0 += AX) {
      let ok = true;
      for (let u = u0; ok && u < u0 + LAT; u++) for (let v = v0; ok && v < v0 + AX; v++) if (!inside(u, v)) ok = false;
      if (!ok) continue;
      let m = 0;
      let m2 = 0;
      for (let u = u0; u < u0 + LAT; u++)
        for (let v = v0; v < v0 + AX; v++) {
          const x = at(u, v);
          m += x;
          m2 += x * x;
        }
      const n = AX * LAT;
      m /= n;
      const variance = m2 / n - m * m;
      if (!(variance > 0)) continue;
      for (let l = 0; l <= lagAx; l++) {
        let c = 0;
        let k = 0;
        for (let u = u0; u < u0 + LAT; u++)
          for (let v = v0; v + l < v0 + AX; v++) {
            c += (at(u, v) - m) * (at(u, v + l) - m);
            k++;
          }
        accAx[l] += c / k / variance;
      }
      for (let l = 0; l <= lagLat; l++) {
        let c = 0;
        let k = 0;
        for (let u = u0; u + l < u0 + LAT; u++)
          for (let v = v0; v < v0 + AX; v++) {
            c += (at(u, v) - m) * (at(u + l, v) - m);
            k++;
          }
        accLat[l] += c / k / variance;
      }
      snrSum += m / Math.sqrt(variance);
      const rMid = (v0 + AX / 2) * dr;
      depthSum += rMid;
      spacingSum += (geom.curvatureRadius + rMid) * dTheta;
      chosen.push({ u0, v0, mean: m });
    }
  }
  const P = chosen.length;
  if (!P) return { ...EMPTY_TEXTURE };
  const acfAx = Array.from(accAx, (a) => a / P);
  const acfLat = Array.from(accLat, (a) => a / P);
  const grainAx = 2 * halfWidth(acfAx); // muestras
  const grainLat = 2 * halfWidth(acfLat); // líneas

  let dark = 0;
  let darkLong = 0;
  const mask = new Uint8Array(AX * LAT);
  const seen = new Uint8Array(AX * LAT);
  const stack: number[] = [];
  for (const { u0, v0, mean } of chosen) {
    mask.fill(0);
    seen.fill(0);
    for (let b = 0; b < AX; b++) for (let a = 0; a < LAT; a++) if (at(u0 + a, v0 + b) < DARK_LEVEL * mean) mask[b * LAT + a] = 1;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || seen[i]) continue;
      let size = 0;
      let aMin = LAT;
      let aMax = -1;
      let bMin = AX;
      let bMax = -1;
      seen[i] = 1;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop()!;
        const a = j % LAT;
        const b = (j - a) / LAT;
        size++;
        aMin = Math.min(aMin, a);
        aMax = Math.max(aMax, a);
        bMin = Math.min(bMin, b);
        bMax = Math.max(bMax, b);
        if (a > 0) visit(j - 1);
        if (a < LAT - 1) visit(j + 1);
        if (b > 0) visit(j - LAT);
        if (b < AX - 1) visit(j + LAT);
      }
      dark += size;
      const grains = Math.hypot((aMax - aMin + 1) / grainLat, (bMax - bMin + 1) / grainAx);
      if (grains >= CRACK_GRAINS) darkLong += size;
    }
  }
  function visit(k: number): void {
    if (mask[k] && !seen[k]) {
      seen[k] = 1;
      stack.push(k);
    }
  }

  return {
    patches: P,
    depthMm: depthSum / P,
    snr: snrSum / P,
    fwhmAxialMm: grainAx * dr,
    fwhmLateralMm: grainLat * (spacingSum / P),
    secondaryLobeAxial: secondaryLobe(acfAx),
    secondaryLobeLateral: secondaryLobe(acfLat),
    darkFraction: dark / (P * AX * LAT),
    crackIndex: Number.isFinite(grainAx) && Number.isFinite(grainLat) ? (dark ? darkLong / dark : 0) : Number.NaN,
  };
}

/** Grano (FWHM de la autocovarianza, mm) a lo largo del haz y a través de él, y cuántas ventanas lo miden. */
export interface GrainMm {
  patches: number;
  axialMm: number;
  lateralMm: number;
}

/**
 * Grano de la envolvente comprimida (20·log10): los mismos parches y la misma autocovarianza que `envelopeTexture`,
 * sobre el nivel en dB. Es la textura que queda tras la compresión logarítmica del equipo; la de la envolvente lineal
 * es la de la PSF (Wagner, Smith y Sandrik 1983, IEEE Trans Sonics Ultrason 30:156).
 */
export function logEnvelopeGrain(
  env: EnvelopeFrame,
  inside: (line: number, sample: number) => boolean,
  geom: EnvelopeGeometry,
  patch: { axial: number; lateral: number } = TEXTURE_PATCH,
): GrainMm {
  const data = new Float32Array(env.data.length);
  for (let i = 0; i < data.length; i++) data[i] = 20 * Math.log10(Math.max(env.data[i], 1e-7));
  const t = envelopeTexture({ ...env, data }, inside, geom, patch);
  return { patches: t.patches, axialMm: t.fwhmAxialMm, lateralMm: t.fwhmLateralMm };
}

/** Desfase (en muestras o líneas) donde la autocovarianza normalizada cae a 0,5; NaN si no cae. */
export function halfWidth(acf: readonly number[]): number {
  for (let l = 1; l < acf.length; l++) if (acf[l] < 0.5) return l - 1 + (acf[l - 1] - 0.5) / (acf[l - 1] - acf[l]);
  return Number.NaN;
}

/**
 * Máximo de la autocovarianza después de su primer mínimo local: 0 si decae sin rebote, NaN si no
 * llega a bajar de 0,5 (grano mayor que el parche).
 */
export function secondaryLobe(acf: readonly number[]): number {
  let l = 1;
  while (l < acf.length && acf[l] >= 0.5) l++;
  if (l >= acf.length) return Number.NaN;
  while (l + 1 < acf.length && acf[l + 1] < acf[l]) l++;
  let best = 0;
  for (let k = l + 1; k < acf.length; k++) best = Math.max(best, acf[k]);
  return best;
}
