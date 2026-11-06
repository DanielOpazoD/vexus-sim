import { levelOfGrey } from '../../ultrasound/greyMap';
import { type DisplayFrame } from '../../ultrasound/renderer';
import { halfWidth, type GrainMm } from './envelope';

/**
 * Banco de fidelidad, segundo nivel (decisión 52): la imagen mostrada, con el gris y su dispersión, el grano del gris en
 * los ejes del haz y el perfil del nivel en profundidad.
 */

/** Ventana del grano de la imagen mostrada (mm): a lo largo del haz × a través de él. */
export const DISPLAY_GRAIN_WINDOW_MM = { axial: 8, lateral: 12 } as const;

/** Vértice del sector en píxeles y píxeles por mm de la imagen mostrada (`SectorLayout`). */
export interface DisplayAxes {
  apexX: number;
  apexY: number;
  scale: number;
}

/**
 * Grano de la imagen mostrada (FWHM de la autocovarianza del gris, mm) en los ejes locales del haz: ventanas de `win`
 * mm con el centro en una rejilla de medio lado menor, remuestreadas (bilineal, un píxel por paso) a lo largo del radio
 * desde el vértice del sector (axial) y de su perpendicular (lateral); solo cuentan las ventanas con todas sus muestras
 * (cada tres) dentro de `inside`. La autocovarianza se normaliza por ventana y se promedia, como en `envelopeTexture`.
 * Mide lo que ve el ojo: la PSF, la conversión de barrido entre líneas que divergen y la compresión, juntas.
 */
export function displayGrain(
  img: DisplayFrame,
  inside: (x: number, y: number) => boolean,
  axes: DisplayAxes,
  win: { axial: number; lateral: number } = DISPLAY_GRAIN_WINDOW_MM,
): GrainMm {
  const na = Math.max(8, Math.round(win.axial * axes.scale));
  const nl = Math.max(8, Math.round(win.lateral * axes.scale));
  const lagA = Math.floor(na / 2);
  const lagL = Math.floor(nl / 2);
  const accA = new Float64Array(lagA + 1);
  const accL = new Float64Array(lagL + 1);
  const stride = Math.max(4, Math.round(Math.min(na, nl) / 2));
  const reach = Math.ceil(Math.hypot(na, nl) / 2);
  const v = new Float64Array(na * nl);
  const bilinear = (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const g = (xx: number, yy: number): number => img.gray[yy * img.width + xx];
    return (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
  };
  let windows = 0;
  for (let cy = reach; cy < img.height - reach - 1; cy += stride)
    for (let cx = reach; cx < img.width - reach - 1; cx += stride) {
      if (!inside(cx, cy)) continue;
      const dx = cx - axes.apexX;
      const dy = cy - axes.apexY;
      const rho = Math.hypot(dx, dy);
      if (rho < 1) continue;
      const ax = dx / rho;
      const ay = dy / rho;
      // lateral: perpendicular al radio
      const lx = -ay;
      const ly = ax;
      const at = (i: number, j: number): [number, number] => {
        const a = i - (na - 1) / 2;
        const l = j - (nl - 1) / 2;
        return [cx + a * ax + l * lx, cy + a * ay + l * ly];
      };
      let ok = true;
      for (let i = 0; ok && i < na; i += 3)
        for (let j = 0; ok && j < nl; j += 3) {
          const [x, y] = at(i, j);
          if (!inside(Math.round(x), Math.round(y))) ok = false;
        }
      for (const [i, j] of [
        [na - 1, 0],
        [0, nl - 1],
        [na - 1, nl - 1],
      ] as const) {
        const [x, y] = at(i, j);
        if (ok && !inside(Math.round(x), Math.round(y))) ok = false;
      }
      if (!ok) continue;
      let m = 0;
      for (let i = 0; i < na; i++)
        for (let j = 0; j < nl; j++) {
          const [x, y] = at(i, j);
          const g = bilinear(x, y);
          v[i * nl + j] = g;
          m += g;
        }
      m /= na * nl;
      let variance = 0;
      for (let k = 0; k < na * nl; k++) variance += (v[k] - m) ** 2;
      variance /= na * nl;
      if (!(variance > 0)) continue;
      for (let l = 0; l <= lagA; l++) {
        let c = 0;
        for (let i = 0; i + l < na; i++) for (let j = 0; j < nl; j++) c += (v[i * nl + j] - m) * (v[(i + l) * nl + j] - m);
        accA[l] += c / ((na - l) * nl) / variance;
      }
      for (let l = 0; l <= lagL; l++) {
        let c = 0;
        for (let i = 0; i < na; i++) for (let j = 0; j + l < nl; j++) c += (v[i * nl + j] - m) * (v[i * nl + j + l] - m);
        accL[l] += c / (na * (nl - l)) / variance;
      }
      windows++;
    }
  if (!windows) return { patches: 0, axialMm: Number.NaN, lateralMm: Number.NaN };
  const acfA = Array.from(accA, (a) => a / windows);
  const acfL = Array.from(accL, (a) => a / windows);
  return { patches: windows, axialMm: (2 * halfWidth(acfA)) / axes.scale, lateralMm: (2 * halfWidth(acfL)) / axes.scale };
}

export interface DisplayStats {
  pixels: number;
  mean: number;
  sd: number;
  p05: number;
  p50: number;
  p95: number;
  /** Fracción de píxeles por debajo de la mitad de la media: huecos del moteado a la vista. */
  darkFraction: number;
}

/** Gris (0–255) de la imagen mostrada en los píxeles que cumplen `inside`, cada `step` píxeles. */
export function displayStats(img: DisplayFrame, inside: (x: number, y: number) => boolean, step = 1): DisplayStats {
  const hist = new Uint32Array(256);
  let n = 0;
  let s = 0;
  let s2 = 0;
  for (let y = 0; y < img.height; y += step)
    for (let x = 0; x < img.width; x += step) {
      if (!inside(x, y)) continue;
      const g = img.gray[y * img.width + x];
      hist[g]++;
      n++;
      s += g;
      s2 += g * g;
    }
  if (!n)
    return { pixels: 0, mean: Number.NaN, sd: Number.NaN, p05: Number.NaN, p50: Number.NaN, p95: Number.NaN, darkFraction: Number.NaN };
  const mean = s / n;
  const percentile = (p: number): number => {
    let acc = 0;
    for (let g = 0; g < 256; g++) {
      acc += hist[g];
      if (acc >= p * n) return g;
    }
    return 255;
  };
  let dark = 0;
  for (let g = 0; g < 256 && g < 0.5 * mean; g++) dark += hist[g];
  return {
    pixels: n,
    mean,
    sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)),
    p05: percentile(0.05),
    p50: percentile(0.5),
    p95: percentile(0.95),
    darkFraction: dark / n,
  };
}

export interface DepthBand {
  r0: number;
  r1: number;
  /** Nivel mostrado medio (dB bajo el techo del rango dinámico). */
  db: number;
  pixels: number;
}

export interface DepthProfile {
  bands: DepthBand[];
  /** Pendiente del nivel mostrado con la profundidad (dB/cm): 0 = compensación bien ajustada. */
  slopeDbPerCm: number;
}

/**
 * Perfil en profundidad del nivel mostrado: invierte la curva de grises píxel a píxel (dB bajo el
 * techo del rango dinámico) y lo promedia por bandas de `bandMm`; la pendiente es la recta de
 * mínimos cuadrados, ponderada por píxeles, sobre las bandas con al menos `minPixels`.
 */
export function depthProfile(
  img: DisplayFrame,
  depthOf: (x: number, y: number) => number | null,
  dynamicRangeDb: number,
  bandMm = 10,
  step = 2,
  minPixels = 150,
): DepthProfile {
  const acc = new Map<number, { s: number; n: number }>();
  for (let y = 0; y < img.height; y += step)
    for (let x = 0; x < img.width; x += step) {
      const r = depthOf(x, y);
      if (r === null) continue;
      const k = Math.floor(r / bandMm);
      const db = (levelOfGrey(img.gray[y * img.width + x] / 255) - 1) * dynamicRangeDb;
      const a = acc.get(k) ?? { s: 0, n: 0 };
      a.s += db;
      a.n++;
      acc.set(k, a);
    }
  const bands = [...acc.entries()]
    .filter(([, a]) => a.n >= minPixels)
    .sort(([a], [b]) => a - b)
    .map(([k, a]) => ({ r0: k * bandMm, r1: (k + 1) * bandMm, db: a.s / a.n, pixels: a.n }));
  if (bands.length < 2) return { bands, slopeDbPerCm: Number.NaN };
  let w = 0;
  let mx = 0;
  let my = 0;
  for (const b of bands) {
    w += b.pixels;
    mx += b.pixels * ((b.r0 + b.r1) / 20); // cm
    my += b.pixels * b.db;
  }
  mx /= w;
  my /= w;
  let sxy = 0;
  let sxx = 0;
  for (const b of bands) {
    const dx = (b.r0 + b.r1) / 20 - mx;
    sxy += b.pixels * dx * (b.db - my);
    sxx += b.pixels * dx * dx;
  }
  return { bands, slopeDbPerCm: sxy / sxx };
}
