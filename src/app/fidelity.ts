import { TISSUES, Tissue, attenuationDbPerCm } from '../anatomy/tissues';
import { Interface } from '../anatomy/interfaces';
import { WALL, wallArc, wallDepths } from '../anatomy/organs/wall';
import { torsoDepth, torsoNormal } from '../anatomy/primitives';
import type { FaceGeometry } from '../anatomy/scene';
import { warpAt, warpNormal } from '../anatomy/compression';
import { dot, normalize, type Vec3 } from '../core/vec3';
import { VESSEL_META } from '../physiology/vessels';
import { contactCoupling } from '../probe/contact';
import { lineDirection, pointOnLine } from '../probe/probe';
import { lateralFwhmMm, lateralSigmaMm } from '../ultrasound/beamModel';
import { effectiveLooks, lookCorrelationLaw, lookWeight } from '../ultrasound/compound';
import { IFACE_REACH_MM, IFACE_SHIFT_MM } from '../ultrasound/interfaceEcho';
import { lookWavenumber, steerBeta } from '../ultrasound/steering';
import { levelOfGrey } from '../ultrasound/greyMap';
import { CURTAIN_MIN_AIR, curtainAirFractionAt, edgeWidth1090Mm, elevSigmaMm, normalCdf } from '../ultrasound/pleura';
import { COARSE_DEPTH, nominalTgcDbPerCm, type DisplayFrame } from '../ultrasound/renderer';
import { beamToPixel, pixelToBeam } from '../ultrasound/sectorGeometry';
import { mirrorCrossing, pleuraCrossingLine } from '../ultrasound/transmission';
import { fatSeptum, muscleStriation, wallOrientation } from '../ultrasound/wallTexture';
import type { EnvelopeFrame } from './speckle';
import type { Simulator } from './simulator';

/**
 * Banco de fidelidad del modo B (decisión 52): métricas reproducibles para comparar la imagen del
 * simulador con la física y con ecografías reales, en dos niveles.
 *
 *  - Envolvente (física del moteado, antes de la compresión): SNR, tamaño del grano (FWHM de la
 *    autocovarianza axial y lateral, comparable con la PSF de `beamModel.ts`), lóbulo secundario
 *    (periodicidad de una retícula), fracción oscura e índice de grietas (topología de los ceros:
 *    en un moteado plenamente desarrollado los ceros son puntos aislados; en una red de grietas,
 *    líneas).
 *  - Imagen mostrada (cadena del equipo: TGC, rango dinámico, curva de grises, persistencia):
 *    gris del hígado y su dispersión, perfil en profundidad (dB/cm) y el banco de interfaces: pared
 *    anterior de VCI, suprahepáticas y porta, cápsula hepática, diafragma con la pleura y su espejo
 *    y Morison, por tramos de incidencia sobre la normal real de cada cara (cociente, huecos,
 *    rosario, anchura del eco, costura y desfase del espejo).
 *
 * Las funciones puras trabajan sobre la envolvente o la imagen con un predicado «dentro» y se
 * prueban con campos sintéticos sin WebGL (`validation/fidelity.test.ts`); `fidelityStats` las
 * aplica al plano actual del simulador.
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

/** Mediana (NaN si vacío). */
function medianOf(a: readonly number[]): number {
  if (!a.length) return Number.NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
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

/**
 * Contraste de una interfaz (pared anterior de un vaso o cara de un órgano) en un tramo de incidencia
 * (ángulo entre el haz y su normal). Cada línea que cruza la interfaz da un registro (`FaceSample`).
 */
export interface WallBin {
  fromDeg: number;
  toDeg: number;
  /** Paredes medidas en el tramo (una por línea que entra del tejido previo a la interfaz). */
  walls: number;
  /** Mediana del cociente gris del pico / mediana del hígado de referencia (sin eco, el moteado da ~1,1). */
  ratio: number;
  /** Lo mismo en nivel mostrado (dB, invirtiendo la curva de grises). */
  deltaDb: number;
  /** Fracción de líneas con el pico a < 6 dB (nivel mostrado) sobre la mediana del hígado: huecos. */
  gapFraction: number;
  /** Hueco más largo a lo largo de la pared (mm): líneas de hueco consecutivas × paso de línea en el borde. */
  longestGapMm: number;
  /**
   * Rosario: coeficiente de variación del pico de envolvente de cada línea dividido por la mediana de
   * sus vecinas a ±3 líneas de la misma pared (quita la tendencia del lóbulo y de la profundidad).
   */
  beading: number;
  /** Anchura del eco a −6 dB alrededor de su pico en la envolvente (mm, mediana). */
  echoFwhmMm: number;
  /**
   * Pico sobre la mediana del hígado de referencia (dB, mediana), en la envolvente con la compensación
   * nominal (`envelopeLine`): sin ella, la atenuación de ida y vuelta entre la cara y su referencia, a
   * 3–10 mm, restaba ~2 dB con la referencia encima y los sumaba con ella debajo.
   */
  peakDb: number;
}

/** Cara hepática del diafragma y línea pleural con su espejo. */
export interface DiaphragmBin extends WallBin {
  /** Línea pleural: pico de envolvente a ±1,5 mm del cruce exacto con el pulmón, sobre el hígado (dB, mediana). */
  lineDb: number;
  /** Desviación típica (mm) de la posición de ese pico respecto al cruce exacto de la CPU. */
  positionSdMm: number;
  /** Líneas con una racha ≥ 0,3 mm de envolvente < hígado − 15 dB en [pleura; pleura + 2,5 mm]: costura. */
  seamFraction: number;
  /**
   * p95 de |espejo de la GPU − pleura de la CPU| (mm); NaN sin la transmisión de la GPU. Incluye el error
   * de colocación de la pasada A (`mirrorFloorMm`): no baja de él aunque la geometría sea exacta.
   */
  mirrorOffsetMm: number;
  /**
   * Suelo de `mirrorOffsetMm` con la colocación de la pasada A: p95 de |espejo de A0 − pleura| (mm), con
   * A0 (`FRAG_TRANS_HITS`: marcha de paso profundidad/`COARSE_DEPTH` y bisección de
   * `MIRROR_BISECTION_STEPS` pasos, `mirrorCrossing`) emulada en la CPU. Con la bisección (decisión 57)
   * es ≤ 0,009 mm; con la marcha gruesa sola caía en [0; paso), ~1 mm de p95.
   */
  mirrorFloorMm: number;
}

/**
 * Tramos de incidencia (°): una pared especular brilla a 0–20° y se apaga hacia 60°. El de 60–80° solo
 * se informa (la cápsula oblicua de la subxifoidea, decisiones 60 y 64); a ≥ 80° no se agrega nada.
 */
export const WALL_INCIDENCE_BINS_DEG = [0, 20, 40, 60, 80] as const;

/** Sistemas venosos con banco de pared propio. */
export type WallSystem = 'ivc' | 'hepaticVein' | 'portal';
export const WALL_SYSTEMS: readonly WallSystem[] = ['ivc', 'hepaticVein', 'portal'];
/** Paredes de la tabla histórica del banco (decisión 52): VCI y suprahepáticas juntas. */
export const HISTORIC_WALL_SYSTEMS: readonly WallSystem[] = ['ivc', 'hepaticVein'];
/**
 * Caras de órgano del banco de interfaces: cápsula hepática, la línea del peritoneo parietal sobre la
 * cápsula (decisión 62), diafragma (con la pleura) y Morison.
 */
export type OrganFace = 'capsule' | 'peritoneum' | 'diaphragm' | 'renalCapsule';
/** Interfaz de un registro del banco: el sistema de la pared o la cara del órgano. */
export type FaceKind = WallSystem | OrganFace;

/** Ventana del pico: desde 1,5 mm antes del borde hasta 0,5 mm después del objetivo. */
export const PEAK_BEFORE_MM = 1.5;
export const PEAK_AFTER_MM = 0.5;
/** Paso de la envolvente para el pico y su anchura (mm). */
export const ECHO_STEP_MM = 0.05;
/** Hasta dónde se busca el −6 dB a cada lado del pico (mm). */
const ECHO_SEARCH_MM = 3;
/** Un pico a menos de esto (dB, nivel mostrado) sobre el hígado es un hueco de la pared. */
export const GAP_DB = 6;
/** Vecinas a cada lado de la línea para el rosario, y cuántas (con ella) hacen falta. */
const BEADING_HALF_LINES = 3;
const BEADING_MIN_LINES = 5;
/** Ventana de la línea pleural alrededor del cruce exacto (mm). */
const PLEURA_LINE_MM = 1.5;
/** Costura: envolvente bajo el hígado − 15 dB en [pleura; pleura + 2,5 mm], en rachas ≥ 0,3 mm. */
export const SEAM_DB = -15;
const SEAM_SPAN_MM = 2.5;
export const SEAM_MIN_MM = 0.3;
const SEAM_STEP_MM = 0.02;

/** Una línea de imagen alrededor de una interfaz (`measureFaceLine`): la prueban líneas pintadas sin WebGL. */
export interface FaceLine {
  /** Envolvente detectada a la profundidad r (mm), sin tendencia con la profundidad (`envelopeLine`). */
  env: (r: number) => number;
  /** Gris mostrado (0–255) a la profundidad r; NaN fuera de la imagen. */
  gray: (r: number) => number;
  /** ¿Hay hígado en r? Solo el hígado entra en la referencia. */
  liver: (r: number) => boolean;
}

/** Dónde está la interfaz en la línea (mm). */
export interface FaceLineGeometry {
  /** Borde: primera celda que ya no es el tejido previo. */
  rb: number;
  /** Primera celda del objetivo (luz, cápsula o cápsula renal) o, en el diafragma, el cruce exacto con la pleura. */
  rTarget: number;
  /** Referencia de hígado: [rb − 10; rb − 3] encima o [rTarget + 3; rTarget + 10] debajo. */
  ref: 'above' | 'below';
  /** Solo el diafragma: el objetivo es la pleura y se miden su línea, su posición y la costura. */
  pleura?: boolean;
  /** Inicio de la ventana del pico si no es rb − `PEAK_BEFORE_MM` (la línea del peritoneo). */
  peakFrom?: number;
}

/** Medida de una línea en una interfaz. */
export interface FaceLineMeasure {
  ratio: number;
  deltaDb: number;
  peakDb: number;
  echoFwhmMm: number;
  /** Gris (0–255) de la cresta: el pico de `ratio`, sin dividir (contraste y CVc en gris, `contourStats`). */
  crestGray: number;
  /** Mediana del gris del hígado de referencia de la línea. */
  refGray: number;
  lineDb?: number;
  positionErrMm?: number;
  seamMm?: number;
}

/**
 * Registro del banco de interfaces: una línea que cruza una pared o una cara, con su incidencia. Con
 * `fidelityStats(…, { samples: true })` se devuelven todos y `summarizeFaces` los agrega entre poses.
 */
export interface FaceSample extends FaceLineMeasure {
  kind: FaceKind;
  /** Pared a la que pertenece la línea en su pose (líneas contiguas enlazadas por su borde). */
  wall: number;
  u: number;
  rb: number;
  /** Paso lateral entre líneas a la profundidad del borde (mm). */
  pitchMm: number;
  incidenceDeg: number;
  /** Solo el diafragma: |espejo de la GPU − pleura de la CPU| (mm). */
  mirrorOffsetMm?: number;
  /** Solo el diafragma: |espejo de la marcha gruesa emulada en la CPU − pleura de la CPU| (mm). */
  mirrorFloorMm?: number;
}

/** Tramos de incidencia de cada interfaz, agregados sobre uno o más planos. */
export interface FaceSummary {
  /** VCI y suprahepáticas juntas: la tabla histórica del banco. */
  walls: WallBin[];
  wallSystems: Record<WallSystem, WallBin[]>;
  /** Cápsula hepática sin la cara interna de la pared en la ventana del pico: su eco solo. */
  capsule: WallBin[];
  /** Cápsula con el peritoneo parietal en la ventana (`PERITONEUM_REACH_MM`): la línea de los dos. */
  peritoneum: WallBin[];
  diaphragm: DiaphragmBin[];
  renalCapsule: WallBin[];
}

/** Recorre [r0; r1] en pasos de `step` sin acumular error de coma flotante. */
function* stepsMm(r0: number, r1: number, step: number): Generator<number> {
  for (let i = 0; r0 + i * step <= r1 + 1e-9; i++) yield r0 + i * step;
}

/**
 * Envolvente de la línea `u` a la profundidad r (mm), interpolada entre los centros de muestra y con
 * la compensación nominal de la pasada de escaneo, `tgcDbPerCm`·r (`nominalTgcDbPerCm`; sin la TGC del
 * usuario ni su techo). La envolvente de la GPU lleva la atenuación de ida y vuelta (~3 dB/cm en el
 * hígado a 2,5 MHz) y el banco compara cada cara con el hígado a 3–10 mm: sin quitar la tendencia, el
 * mismo eco medía ~4 dB distinto con la referencia encima (pared) o debajo (cápsula), la línea pleural
 * ~3 dB de menos y la costura contaba huecos del moteado de un diafragma sin costura.
 */
export function envelopeLine(env: EnvelopeFrame, depthMm: number, tgcDbPerCm: number): (u: number, r: number) => number {
  const dr = depthMm / env.samples;
  const gain = Float64Array.from({ length: env.samples }, (_, v) => Math.pow(10, (tgcDbPerCm * ((v + 0.5) * dr)) / 200));
  return (u, r) => {
    const x = Math.min(env.samples - 1, Math.max(0, r / dr - 0.5));
    const v = Math.min(env.samples - 2, Math.floor(x));
    const f = x - v;
    return env.data[v * env.lines + u] * gain[v] * (1 - f) + env.data[(v + 1) * env.lines + u] * gain[v + 1] * f;
  };
}

/**
 * Anchura (mm) a −6 dB (mitad de la amplitud) alrededor del pico `rPeak` de `f`, con los cruces
 * interpolados entre pasos de `stepMm`; NaN si a `maxMm` de un lado no baja de la mitad.
 */
export function echoWidthMm(f: (r: number) => number, rPeak: number, stepMm = ECHO_STEP_MM, maxMm = ECHO_SEARCH_MM): number {
  const top = f(rPeak);
  const half = top / 2;
  const edge = (dir: 1 | -1): number => {
    let prev = top;
    for (let i = 1; i * stepMm <= maxMm + 1e-9; i++) {
      const v = f(rPeak + dir * i * stepMm);
      if (v < half) return (i - 1 + (prev - half) / (prev - v)) * stepMm;
      prev = v;
    }
    return Number.NaN;
  };
  return edge(1) + edge(-1);
}

/** Racha más larga (mm) de `f` por debajo de `threshold` en [r0; r1], en pasos de `stepMm`. */
export function longestRunBelowMm(f: (r: number) => number, r0: number, r1: number, threshold: number, stepMm = SEAM_STEP_MM): number {
  let run = 0;
  let best = 0;
  for (const r of stepsMm(r0, r1, stepMm)) {
    if (f(r) < threshold) {
      run += stepMm;
      best = Math.max(best, run);
    } else run = 0;
  }
  return best;
}

/**
 * Mide una línea en una interfaz: pico de gris y de envolvente en [rb − 1,5; rTarget + 0,5] frente a
 * la mediana del hígado de referencia (≥ 8 muestras cada 0,25 mm, si no null), anchura del eco a −6 dB
 * y, en el diafragma, la línea pleural (±1,5 mm del cruce), su posición y la costura.
 */
export function measureFaceLine(line: FaceLine, g: FaceLineGeometry, dynamicRangeDb: number): FaceLineMeasure | null {
  const [a, b] = g.ref === 'above' ? [g.rb - 10, g.rb - 3] : [g.rTarget + 3, g.rTarget + 10];
  const refGray: number[] = [];
  const refEnv: number[] = [];
  for (const r of stepsMm(a, b, 0.25)) {
    const gr = line.gray(r);
    if (!Number.isFinite(gr) || !line.liver(r)) continue;
    refGray.push(gr);
    refEnv.push(line.env(r));
  }
  if (refGray.length < 8) return null;
  const med = medianOf(refGray);
  const medEnv = medianOf(refEnv);
  if (!(med > 0) || !(medEnv > 0)) return null;
  const w0 = g.peakFrom ?? g.rb - PEAK_BEFORE_MM;
  const w1 = g.rTarget + PEAK_AFTER_MM;
  let peak = 0;
  for (const r of stepsMm(w0, w1, 0.1)) peak = Math.max(peak, line.gray(r) || 0);
  let peakEnv = 0;
  let rPeak = w0;
  for (const r of stepsMm(w0, w1, ECHO_STEP_MM)) {
    const e = line.env(r);
    if (e > peakEnv) {
      peakEnv = e;
      rPeak = r;
    }
  }
  const out: FaceLineMeasure = {
    ratio: peak / med,
    deltaDb: (levelOfGrey(peak / 255) - levelOfGrey(med / 255)) * dynamicRangeDb,
    peakDb: 20 * Math.log10(peakEnv / medEnv),
    echoFwhmMm: echoWidthMm(line.env, rPeak),
    crestGray: peak,
    refGray: med,
  };
  if (g.pleura) {
    let top = 0;
    let rTop = g.rTarget;
    for (const r of stepsMm(g.rTarget - PLEURA_LINE_MM, g.rTarget + PLEURA_LINE_MM, SEAM_STEP_MM)) {
      const e = line.env(r);
      if (e > top) {
        top = e;
        rTop = r;
      }
    }
    out.lineDb = 20 * Math.log10(top / medEnv);
    out.positionErrMm = rTop - g.rTarget;
    out.seamMm = longestRunBelowMm(line.env, g.rTarget, g.rTarget + SEAM_SPAN_MM, medEnv * Math.pow(10, SEAM_DB / 20));
  }
  return out;
}

/** Percentil `p` (0–1) por rango (NaN si vacío). */
function percentileOf(a: readonly number[], p: number): number {
  if (!a.length) return Number.NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** Desviación típica poblacional (NaN si vacío). */
function sdOf(a: readonly number[]): number {
  if (!a.length) return Number.NaN;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}

type KeyedSample = FaceSample & { key: string };

/** Hueco más largo (mm) entre líneas consecutivas de una misma pared con el pico bajo `GAP_DB`. */
function longestGapMm(sel: readonly KeyedSample[]): number {
  if (!sel.length) return Number.NaN;
  let best = 0;
  const byWall = new Map<string, KeyedSample[]>();
  for (const s of sel) byWall.set(s.key, [...(byWall.get(s.key) ?? []), s]);
  for (const list of byWall.values()) {
    list.sort((x, y) => x.u - y.u);
    let run = 0;
    let lastU = Number.NaN;
    for (const s of list) {
      if (s.deltaDb < GAP_DB) {
        run = s.u === lastU + 1 ? run + s.pitchMm : s.pitchMm;
        best = Math.max(best, run);
      } else run = 0;
      lastU = s.u;
    }
  }
  return best;
}

/** Rosario: CV del pico de envolvente de cada línea / mediana de sus vecinas a ±3 líneas (misma pared y tramo). */
function beadingOf(sel: readonly KeyedSample[]): number {
  const amp = new Map<string, Map<number, number>>();
  for (const s of sel) {
    const m = amp.get(s.key) ?? new Map<number, number>();
    m.set(s.u, Math.pow(10, s.peakDb / 20));
    amp.set(s.key, m);
  }
  const ratios: number[] = [];
  for (const s of sel) {
    const m = amp.get(s.key)!;
    const nb: number[] = [];
    for (let du = -BEADING_HALF_LINES; du <= BEADING_HALF_LINES; du++) {
      const a = m.get(s.u + du);
      if (a !== undefined) nb.push(a);
    }
    if (nb.length >= BEADING_MIN_LINES) ratios.push(m.get(s.u)! / medianOf(nb));
  }
  if (!ratios.length) return Number.NaN;
  const mean = ratios.reduce((x, y) => x + y, 0) / ratios.length;
  return sdOf(ratios) / mean;
}

function wallBin(sel: readonly KeyedSample[], fromDeg: number, toDeg: number): WallBin {
  return {
    fromDeg,
    toDeg,
    walls: sel.length,
    ratio: medianOf(sel.map((s) => s.ratio)),
    deltaDb: medianOf(sel.map((s) => s.deltaDb)),
    gapFraction: sel.length ? sel.filter((s) => s.deltaDb < GAP_DB).length / sel.length : Number.NaN,
    longestGapMm: longestGapMm(sel),
    beading: beadingOf(sel),
    echoFwhmMm: medianOf(sel.map((s) => s.echoFwhmMm).filter(Number.isFinite)),
    peakDb: medianOf(sel.map((s) => s.peakDb)),
  };
}

/**
 * Agrega los registros del banco de interfaces por tipo y tramo de incidencia. Cada elemento de
 * `poses` es un plano (una llamada a `fidelityStats` con `samples`): las paredes, los huecos y el
 * rosario se enlazan dentro de su plano y los tramos juntan todos los planos (`bench --sweep`).
 */
export function summarizeFaces(poses: readonly (readonly FaceSample[])[]): FaceSummary {
  const all: KeyedSample[] = poses.flatMap((list, p) => list.map((s) => ({ ...s, key: `${p}:${s.kind}:${s.wall}` })));
  const nBins = WALL_INCIDENCE_BINS_DEG.length - 1;
  const binsOf = (kinds: readonly FaceKind[]): KeyedSample[][] =>
    Array.from({ length: nBins }, (_, j) =>
      all.filter(
        (s) => kinds.includes(s.kind) && s.incidenceDeg >= WALL_INCIDENCE_BINS_DEG[j] && s.incidenceDeg < WALL_INCIDENCE_BINS_DEG[j + 1],
      ),
    );
  const wallBins = (kinds: readonly FaceKind[]): WallBin[] =>
    binsOf(kinds).map((sel, j) => wallBin(sel, WALL_INCIDENCE_BINS_DEG[j], WALL_INCIDENCE_BINS_DEG[j + 1]));
  const finite = (sel: readonly KeyedSample[], f: (s: KeyedSample) => number | undefined): number[] =>
    sel.map(f).filter((x): x is number => x !== undefined && Number.isFinite(x));
  const diaphragm = binsOf(['diaphragm']).map((sel, j): DiaphragmBin => {
    const seams = finite(sel, (s) => s.seamMm);
    return {
      ...wallBin(sel, WALL_INCIDENCE_BINS_DEG[j], WALL_INCIDENCE_BINS_DEG[j + 1]),
      lineDb: medianOf(finite(sel, (s) => s.lineDb)),
      positionSdMm: sdOf(finite(sel, (s) => s.positionErrMm)),
      seamFraction: seams.length ? seams.filter((x) => x >= SEAM_MIN_MM).length / seams.length : Number.NaN,
      mirrorOffsetMm: percentileOf(
        finite(sel, (s) => s.mirrorOffsetMm),
        0.95,
      ),
      mirrorFloorMm: percentileOf(
        finite(sel, (s) => s.mirrorFloorMm),
        0.95,
      ),
    };
  });
  return {
    walls: wallBins(HISTORIC_WALL_SYSTEMS),
    wallSystems: { ivc: wallBins(['ivc']), hepaticVein: wallBins(['hepaticVein']), portal: wallBins(['portal']) },
    capsule: wallBins(['capsule']),
    peritoneum: wallBins(['peritoneum']),
    diaphragm,
    renalCapsule: wallBins(['renalCapsule']),
  };
}

/** Registros mínimos de un tramo para que el banco con GPU lo evalúe (plan de la tanda 1.5, §6.3). */
export const GATED_MIN_RECORDS = 10;

/**
 * Tramos que vigila el banco con GPU de los ecos de interfaz (decisión 57): solo los que el barrido llena
 * en alguna vista (docs/fidelity/README.md, «Qué llena el barrido»). La pared de la VCI a 0–20°, la VSH a
 * 20–40° y 40–60° (su caída), la porta a 20–40°, la línea del hígado bajo la pared (peritoneo y cápsula) y
 * Morison a 0–20° y el diafragma a 40–60°. La VSH y el diafragma a 0–20° no llegan a 10 registros en
 * ninguna vista y no se vigilan; desde la decisión 62 tampoco la cápsula sola: bajo la pared siempre tiene
 * la grasa preperitoneal y el peritoneo encima, en su ventana (su eco lo vigila el gemelo, `wallTwin.test.ts`).
 */
export const GATED_FACE_BINS: readonly { label: string; kind: FaceKind; fromDeg: number }[] = [
  { label: 'VCI', kind: 'ivc', fromDeg: 0 },
  { label: 'VSH', kind: 'hepaticVein', fromDeg: 20 },
  { label: 'VSH', kind: 'hepaticVein', fromDeg: 40 },
  { label: 'porta', kind: 'portal', fromDeg: 20 },
  { label: 'peritoneo', kind: 'peritoneum', fromDeg: 0 },
  { label: 'diafragma', kind: 'diaphragm', fromDeg: 40 },
  { label: 'Morison', kind: 'renalCapsule', fromDeg: 0 },
];

/**
 * Tramos vigilados (`GATED_FACE_BINS`) que el resumen no llena: menos de `min` registros, o sin rosario
 * medible (ninguna pared con 5 líneas a ±3 en el tramo). Cada uno como «VSH 0–20°: 3 registros»; vacío si
 * todos se pueden evaluar. El banco lo escribe por escena para que las puertas no se salten en silencio.
 */
export function thinGatedBins(summary: FaceSummary, min = GATED_MIN_RECORDS): string[] {
  const bins = (kind: FaceKind): WallBin[] =>
    kind === 'ivc' || kind === 'hepaticVein' || kind === 'portal' ? summary.wallSystems[kind] : summary[kind];
  const out: string[] = [];
  for (const g of GATED_FACE_BINS) {
    const b = bins(g.kind).find((x) => x.fromDeg === g.fromDeg);
    if (!b) continue;
    const name = `${g.label} ${b.fromDeg}–${b.toDeg}°`;
    if (b.walls < min) out.push(`${name}: ${b.walls} registros`);
    else if (!Number.isFinite(b.beading)) out.push(`${name}: ${b.walls} registros, sin rosario`);
  }
  return out;
}

// ——— Contorno de las caras de órgano (PR 0 de las decisiones 60 y 64): métricas solo informadas ———

/** σ_L: vecinas a cada lado de la mediana corta (7 líneas) y de la larga (41), y registros mínimos. */
export const SIGMA_L_SHORT_HALF = 3;
export const SIGMA_L_LONG_HALF = 20;
export const SIGMA_L_MIN_LINES = 10;
/** Desviaciones mínimas del CVc: con menos, su DE no dice nada (con una sola sería 0, un CVc 0 falso). */
export const CVC_MIN_LINES = 10;
/** Extremo brusco de la cápsula: la mediana de 3 líneas cae ≥ 10 dB en ≤ 1 mm de pared desde ≥ +6 dB. */
export const CAPSULE_END_DROP_DB = 10;
export const CAPSULE_END_SPAN_MM = 1;

/** Un tramo de incidencia de una cara, en el dominio del gris y de la envolvente. */
export interface ContourBin {
  fromDeg: number;
  toDeg: number;
  walls: number;
  /** Mediana de (gris de la cresta − gris mediano del hígado de referencia) de cada línea. */
  contrastGrey: number;
  /**
   * CVc: DE de (cresta − mediana de las crestas a ±3 líneas de la misma pared, ≥ 5 con ella) / `contrastGrey`.
   * Casi no depende de la pendiente gris/dB del equipo (numerador y denominador escalan igual): la métrica
   * con que se comparan las referencias reales, cuya curva de grises no se conoce. Sin techo: premiaría
   * suavizar la línea (antipatrón §23 de la guía). NaN con < `CVC_MIN_LINES` desviaciones.
   */
  cvc: number;
  /** Desviaciones de las que sale el CVc (líneas con ≥ 5 vecinas a ±3 en su pared). */
  cvcLines: number;
  /**
   * σ_L (dB): DE de [mediana del pico de envolvente en 7 líneas − mediana en 41] a lo largo de la pared, en
   * las líneas con sus 41 vecinas en el tramo: la variación a escala de centímetros («línea dibujada»); la
   * mediana corta quita buena parte del rosario de línea a línea y la larga, la tendencia del lóbulo y de la
   * profundidad. NaN con < 10 líneas. Frágil entre realizaciones (la cápsula del gemelo a 0–20° va de 0,90
   * a 1,54 dB según la semilla): se promedia sobre ≥ 8.
   */
  sigmaLDb: number;
}

/** Contorno de la cápsula hepática y de Morison en uno o más planos (`contourStats`). */
export interface ContourStats {
  capsule: ContourBin[];
  renalCapsule: ContourBin[];
  /**
   * Extremos bruscos de la cápsula: veces que la mediana de 3 líneas vecinas de una pared cae ≥ 10 dB (nivel
   * mostrado sobre el hígado) en ≤ 1 mm de pared (paso lateral entre líneas) desde ≥ +6 dB, en cualquiera de
   * los dos sentidos. Una caída que arranca a ≤ 1 mm de donde aterrizó la anterior es el mismo corte (la
   * PSF lo reparte en una escalera de varias líneas). Cuenta también los cortes por cambio de dueño (la cara
   * pasa a ser del diafragma o de la grasa perirrenal y la cápsula deja de dibujarla), que en la imagen son
   * el mismo corte. NaN si no se evaluó ninguna mediana de 3 (`capsuleEndLines` 0): una vista sin
   * registros de la cápsula no aprueba en silencio una puerta de 0.
   */
  capsuleEnds: number;
  /** Líneas (medianas de 3, en tramos de ≥ 3 líneas seguidas de una pared) en las que se buscaron extremos. */
  capsuleEndLines: number;
  /** p99 del salto de incidencia (°) entre líneas contiguas de una misma pared de la cápsula. */
  incidenceJumpP99Deg: number;
  /**
   * El mayor de esos saltos (°), la puerta de la decisión 60. Con más de 100 pares el p99 ya no ve una arista
   * sola: la subxifoidea de la congestión da p99 2,5° con un salto de 29°, y la del sano, con dos aristas en
   * 115 pares, da de p99 la segunda.
   */
  incidenceJumpMaxDeg: number;
  /** Pares de líneas contiguas de las que sale el salto. */
  incidencePairs: number;
}

/** Registros de cada pared (misma clave), ordenados por línea. */
function byWall(sel: readonly KeyedSample[]): KeyedSample[][] {
  const m = new Map<string, KeyedSample[]>();
  for (const s of sel) m.set(s.key, [...(m.get(s.key) ?? []), s]);
  return [...m.values()].map((list) => [...list].sort((a, b) => a.u - b.u));
}

/** Tramos de líneas consecutivas (sin saltos de línea) de una pared ordenada. */
function consecutiveRuns(list: readonly KeyedSample[]): KeyedSample[][] {
  const runs: KeyedSample[][] = [];
  for (const s of list) {
    const last = runs[runs.length - 1];
    if (last && s.u === last[last.length - 1].u + 1) last.push(s);
    else runs.push([s]);
  }
  return runs;
}

/** Mediana de `f` en las líneas u − h … u + h de la pared, o null si falta alguna. */
function windowMedian(byU: ReadonlyMap<number, KeyedSample>, u: number, h: number, f: (s: KeyedSample) => number): number | null {
  const v: number[] = [];
  for (let du = -h; du <= h; du++) {
    const x = byU.get(u + du);
    if (!x) return null;
    v.push(f(x));
  }
  return medianOf(v);
}

function contourBin(sel: readonly KeyedSample[], fromDeg: number, toDeg: number): ContourBin {
  const contrastGrey = medianOf(sel.map((s) => s.crestGray - s.refGray));
  const dev: number[] = [];
  const longScale: number[] = [];
  for (const list of byWall(sel)) {
    const byU = new Map(list.map((s) => [s.u, s]));
    for (const s of list) {
      const nb: number[] = [];
      for (let du = -BEADING_HALF_LINES; du <= BEADING_HALF_LINES; du++) {
        const x = byU.get(s.u + du);
        if (x) nb.push(x.crestGray);
      }
      if (nb.length >= BEADING_MIN_LINES) dev.push(s.crestGray - medianOf(nb));
      const short = windowMedian(byU, s.u, SIGMA_L_SHORT_HALF, (x) => x.peakDb);
      const long = windowMedian(byU, s.u, SIGMA_L_LONG_HALF, (x) => x.peakDb);
      if (short !== null && long !== null) longScale.push(short - long);
    }
  }
  return {
    fromDeg,
    toDeg,
    walls: sel.length,
    contrastGrey,
    cvc: dev.length >= CVC_MIN_LINES && contrastGrey > 0 ? sdOf(dev) / contrastGrey : Number.NaN,
    cvcLines: dev.length,
    sigmaLDb: longScale.length >= SIGMA_L_MIN_LINES ? sdOf(longScale) : Number.NaN,
  };
}

/**
 * Caídas bruscas de `level` (mediana de 3 líneas) recorriendo un tramo en un sentido: desde ≥ `GAP_DB`, a
 * ≤ nivel − `CAPSULE_END_DROP_DB` antes de `CAPSULE_END_SPAN_MM` de pared. Cada corte se cuenta una vez:
 * la caída que arranca a ≤ `CAPSULE_END_SPAN_MM` de donde aterrizó la anterior lo continúa (la PSF reparte
 * un corte en una escalera de 3–4 líneas: 30 → 19 → 8 → −3 dB es un corte, no tres), y la siguiente exige
 * volver a ≥ `GAP_DB`.
 */
function abruptDrops(level: readonly number[], pos: readonly number[]): number {
  const span = CAPSULE_END_SPAN_MM + 1e-9;
  let events = 0;
  let landed = -1;
  let i = 0;
  while (i < level.length) {
    if (!(level[i] >= GAP_DB)) {
      i++;
      continue;
    }
    let hit = -1;
    for (let j = i + 1; j < level.length && Math.abs(pos[j] - pos[i]) <= span && hit < 0; j++)
      if (level[j] <= level[i] - CAPSULE_END_DROP_DB) hit = j;
    if (hit < 0) {
      i++;
      continue;
    }
    if (landed < 0 || Math.abs(pos[i] - pos[landed]) > span) events++;
    landed = hit;
    i = hit;
    while (i < level.length && !(level[i] >= GAP_DB)) i++;
  }
  return events;
}

/** Extremos bruscos de la cápsula en todas sus paredes y medianas evaluadas (ver `ContourStats.capsuleEnds`). */
function capsuleEndsOf(sel: readonly KeyedSample[]): { ends: number; lines: number } {
  let ends = 0;
  let lines = 0;
  for (const list of byWall(sel))
    for (const run of consecutiveRuns(list)) {
      if (run.length < 3) continue;
      // mediana de 3 líneas en las interiores y posición a lo largo de la pared (paso lateral en el borde)
      const level: number[] = [];
      const pos: number[] = [];
      let x = 0;
      for (let i = 1; i + 1 < run.length; i++) {
        x += run[i].pitchMm;
        level.push(medianOf([run[i - 1].deltaDb, run[i].deltaDb, run[i + 1].deltaDb]));
        pos.push(x);
      }
      lines += level.length;
      ends += abruptDrops(level, pos) + abruptDrops([...level].reverse(), [...pos].reverse());
    }
  return { ends: lines ? ends : Number.NaN, lines };
}

/**
 * Métricas del contorno de la cápsula y de Morison sobre uno o más planos (como `summarizeFaces`: las
 * paredes se enlazan dentro de su plano). Solo se informan (banco con GPU, bloque `contour`); las puertas
 * llegan con las decisiones 60 (`capsuleEnds`, `incidenceJumpMaxDeg`) y 61 (cápsula a 20–60°). El contorno
 * del hígado es el de la cápsula y el de la línea del peritoneo con ella (decisión 62, `peritoneum`): la misma
 * pared, que bajo la pared abdominal se ve como esa línea.
 */
export function contourStats(poses: readonly (readonly FaceSample[])[]): ContourStats {
  const all: KeyedSample[] = poses.flatMap((list, p) =>
    list.map((s) => {
      const kind: FaceKind = s.kind === 'peritoneum' ? 'capsule' : s.kind;
      return { ...s, kind, key: `${p}:${kind}:${s.wall}` };
    }),
  );
  const bins = (kind: FaceKind): ContourBin[] =>
    WALL_INCIDENCE_BINS_DEG.slice(0, -1).map((b0, j) => {
      const b1 = WALL_INCIDENCE_BINS_DEG[j + 1];
      return contourBin(
        all.filter((s) => s.kind === kind && s.incidenceDeg >= b0 && s.incidenceDeg < b1),
        b0,
        b1,
      );
    });
  const capsule = all.filter((s) => s.kind === 'capsule');
  const jumps: number[] = [];
  for (const list of byWall(capsule))
    for (const run of consecutiveRuns(list))
      for (let i = 1; i < run.length; i++) jumps.push(Math.abs(run[i].incidenceDeg - run[i - 1].incidenceDeg));
  const ends = capsuleEndsOf(capsule);
  return {
    capsule: bins('capsule'),
    renalCapsule: bins('renalCapsule'),
    capsuleEnds: ends.ends,
    capsuleEndLines: ends.lines,
    incidenceJumpP99Deg: percentileOf(jumps, 0.99),
    incidenceJumpMaxDeg: jumps.length ? Math.max(...jumps) : Number.NaN,
    incidencePairs: jumps.length,
  };
}

/**
 * Sombra ósea en la imagen mostrada: tejido blando 10–40 mm detrás del primer hueso de la línea.
 * El núcleo son las líneas cuya vecindad ±3 también toca hueso; el perfil del borde da el nivel
 * (dB bajo el techo) a −4…+4 líneas del borde geométrico de cada sombra (negativo = fuera, 0 = la
 * primera línea que toca hueso), promediado entre bordes: un escalón es una sombra de un solo
 * rayo; una rampa, la penumbra de la apertura.
 */
export interface ShadowStats {
  coreLines: number;
  /** Nivel del hígado puro menos el del núcleo de la sombra (dB): una sombra limpia llega al suelo. */
  coreDbBelowLiver: number;
  coreGray: number;
  edgeProfileDb: number[];
  /**
   * Fin de la umbra (mm tras la cara del hueso) en la transmisión de la pasada A, sin ruido: la mediana
   * sobre las líneas del núcleo, en pasos de 1 mm, de la transmisión con apertura respecto a la del hígado
   * (la del rayo justo antes del hueso con la atenuación del hígado desde ahí) sube de −40 dB (`umbraEndMm`).
   * De la mirada 0 y, con las miradas del anillo (decisión 58), del compuesto (media de sus transmisiones);
   * `umbraShiftMm` = mirada 0 − compuesto, NaN si la mirada 0 no sale de −40 dB antes de 40 mm.
   */
  umbraEndLook0Mm: number;
  umbraEndCompoundMm: number;
  umbraShiftMm: number;
}

/** Nivel respecto al hígado que marca el fin de la umbra (dB) y alcance de la búsqueda tras el hueso (mm). */
export const UMBRA_DB = -40;
export const UMBRA_SEARCH_MM = 40;

/**
 * Fin de la umbra en un perfil (dB respecto al hígado cada 1 mm tras el hueso, desde 0): el primer cruce de
 * `UMBRA_DB` hacia arriba, interpolado en dB; NaN si no sale de la umbra (o nunca estuvo en ella).
 */
export function umbraEndMm(profileDb: readonly number[], stepMm = 1, threshold = UMBRA_DB): number {
  for (let i = 1; i < profileDb.length; i++) {
    const a = profileDb[i - 1];
    const b = profileDb[i];
    if (a < threshold && b >= threshold) return (i - 1 + (threshold - a) / (b - a)) * stepMm;
  }
  return Number.NaN;
}

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
): { patches: number; pairs: number[] } {
  const n = looks.length;
  const { lines, samples } = looks[0];
  const dr = depthMm / samples;
  const gain2 = Float64Array.from({ length: samples }, (_, v) => Math.pow(10, (tgcDbPerCm * ((v + 0.5) * dr)) / 100));
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

function pearson(x: Float64Array, y: Float64Array): number {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    sxy += a * b;
    sxx += a * a;
    syy += b * b;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** Media de la envolvente en las muestras de la máscara (NaN sin muestras). */
function maskedMean(env: EnvelopeFrame, inside: (line: number, sample: number) => boolean): number {
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

export interface FidelityBand extends EnvelopeTexture {
  r0: number;
  r1: number;
  /** FWHM lateral de la PSF de dos vías a la profundidad media de la banda (`beamModel.ts`). */
  beamFwhmMm: number;
}

export interface FidelityStats {
  /** La envolvente medida: la de la mirada 0 o, con las miradas del anillo (decisión 58), la compuesta. */
  envelope: EnvelopeTexture;
  bands: FidelityBand[];
  /** Con las miradas del anillo (`opts.looks`): la composición espacial por banda y en la costura. */
  compound?: CompoundStats;
  /**
   * Imagen mostrada; `colorOn` avisa de que la caja de color estaba encendida (el gris leído es el
   * canal rojo y los píxeles con color no son modo B).
   */
  display: {
    liver: DisplayStats;
    /** El mismo hígado puro por bandas de profundidad (`DEPTH_BANDS_MM`). */
    liverBands: (DisplayStats & { r0: number; r1: number })[];
    /**
     * El centro de la luz: sangre de VCI, suprahepáticas y porta a ≥ 1,5 mm de su pared en el plano y a ≥ 1,5 mm
     * más la σ elevacional en 3D (toda la rodaja es sangre). La mediana debe quedar casi negra.
     */
    lumen: DisplayStats;
    /** Fracción de los píxeles del diafragma saturados (≥ 250); NaN si no hay diafragma a la vista. */
    diaphragmSaturated: number;
    /** Sombra ósea (costillas, columna): ver `ShadowStats`. */
    shadow: ShadowStats;
    profile: DepthProfile;
    /** Pared anterior de VCI y suprahepáticas juntas (la tabla histórica del banco). */
    walls: WallBin[];
    /** Banco de interfaces por sistema: VCI, suprahepáticas y porta. */
    wallSystems: Record<WallSystem, WallBin[]>;
    /**
     * Cápsula hepática bajo la pared (músculo o grasa → cápsula; referencia, el hígado de debajo), sin la
     * cara interna de la pared en la ventana del pico.
     */
    capsule: WallBin[];
    /**
     * Los mismos registros con el peritoneo parietal en la ventana (decisión 62): la grasa preperitoneal →
     * hígado. Sus ecos (0,35 mm a cada lado del cruce) se funden en una línea, la que se ve en la imagen y
     * la que medía la cápsula de la decisión 57 (referencias 1,3–2,1 a 0–20°).
     */
    peritoneum: WallBin[];
    /** Hígado → diafragma → pulmón: cara hepática, línea pleural, costura y espejo. */
    diaphragm: DiaphragmBin[];
    /** Morison: hígado → grasa perirrenal → cápsula renal. */
    renalCapsule: WallBin[];
    /** Fracción de píxeles saturados (≥ 250) a ≤ 1 mm de cada cara; NaN si no está a la vista. */
    faceSaturated: { diaphragm: number; morison: number; gallbladder: number };
    /** Pared torácica y abdominal (decisión 62): líneas brillantes, capas y cortical costal. */
    wall: WallStats;
    colorOn: boolean;
  } | null;
  /** Con `opts.samples`: un registro por línea y pared medida, para agregar planos con `summarizeFaces`. */
  faceSamples?: FaceSample[];
}

/** Bandas de profundidad (mm) en que se compara el grano lateral con la PSF. */
export const DEPTH_BANDS_MM = [
  [20, 60],
  [60, 100],
  [100, 140],
  [140, 180],
] as const;

// ——— Pared (decisión 62) ———

/** Una línea brillante de la pared está ≥ esto (dB) sobre la mediana local de su perfil. */
export const WALL_LINE_DB = 6;
/** Semiancho (mm) de la ventana de la mediana local del perfil de la pared. */
export const WALL_LINE_WINDOW_MM = 4;
/** Dos tramos sobre el umbral separados por menos de esto (mm) son la misma línea. */
export const WALL_LINE_MERGE_MM = 1;
/** Paso (mm) del perfil de la pared en profundidad bajo la piel. */
export const WALL_PROFILE_STEP_MM = 0.1;
/**
 * Líneas con incidencia sobre la piel por debajo de esto (°) pueden formar el perfil de la pared (se toman
 * las `WALL_PROFILE_LINES` más normales): las vistas de partida bascularan o inclinan la sonda (la
 * subxifoidea 26° en el plano, el flanco 11° fuera de él) y a 25° una fascia (s 0,3) pierde 3,5 dB.
 */
export const WALL_NORMAL_DEG = 25;
/** Como mucho, tantas líneas (las de menor incidencia) en el perfil: ~7 mm de piel a 10 mm. */
export const WALL_PROFILE_LINES = 17;
/**
 * Interior de una capa: a ≥ esto (mm) de toda cara de la pared, fuera de la falda de sus ecos (con la PSF
 * axial, σ ≈ 0,3 mm, un eco de +20 dB sobre el hígado cae a 1 mm 48 dB: 20 dB bajo el músculo).
 */
export const WALL_INTERIOR_MM = 1;
/** Las capas se miden en las líneas a menos de esto (°) de la normal a la piel. */
export const WALL_LAYER_DEG = 15;

export interface BrightLines {
  /** Número de líneas distintas. */
  count: number;
  /** Profundidad (mm, en el eje del perfil) y exceso (dB) sobre la mediana local del pico de cada una. */
  depthsMm: number[];
  excessDb: number[];
}

/**
 * Líneas brillantes de un perfil en dB a paso `stepMm` (NaN = sin dato): tramos ≥ `WALL_LINE_DB` sobre la
 * mediana del perfil en ±`WALL_LINE_WINDOW_MM`, fundidos si los separan < `WALL_LINE_MERGE_MM`. Un moteado
 * de Rayleigh supera 6 dB sobre su mediana en el 6 % de las muestras: el perfil debe ser la mediana lateral
 * de varias líneas (así una línea es continua a lo ancho, no un grano).
 */
export function brightLines(profileDb: readonly number[], stepMm: number): BrightLines {
  const n = profileDb.length;
  const half = Math.round(WALL_LINE_WINDOW_MM / stepMm);
  const runs: { end: number; peak: number; excess: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(profileDb[i])) continue;
    const win: number[] = [];
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) if (Number.isFinite(profileDb[k])) win.push(profileDb[k]);
    const excess = profileDb[i] - medianOf(win);
    if (excess < WALL_LINE_DB) continue;
    const last = runs[runs.length - 1];
    if (last && (i - last.end) * stepMm < WALL_LINE_MERGE_MM) {
      last.end = i;
      if (excess > last.excess) {
        last.excess = excess;
        last.peak = i;
      }
    } else runs.push({ end: i, peak: i, excess });
  }
  return { count: runs.length, depthsMm: runs.map((r) => r.peak * stepMm), excessDb: runs.map((r) => r.excess) };
}

/** Banco de la pared de un plano (decisión 62). */
export interface WallStats {
  /** Líneas con incidencia < `WALL_NORMAL_DEG` sobre la piel y las usadas en el perfil (≤ `WALL_PROFILE_LINES`). */
  normalLines: number;
  profileLines: number;
  /** Líneas brillantes del perfil de la pared (piel → peritoneo + 1 mm) y las de dentro (0,5 mm → peritoneo − 1 mm). */
  lines: BrightLines;
  linesInside: number;
  /** Perfil (dB de envolvente compensada sobre el hígado) cada `WALL_PROFILE_STEP_MM` desde la piel. */
  profileDb: number[];
  /**
   * Gris mediano del interior de los lóbulos de grasa (lejos de septos y caras) y del músculo entre estrías,
   * en las líneas a menos de `WALL_LAYER_DEG` de la normal a la piel.
   */
  fatGray: number;
  muscleGray: number;
  /** Los mismos sobre el gris mediano del hígado (objetivo de la grasa: ≤ 0,6). */
  fatToLiver: number;
  muscleToLiver: number;
  /**
   * Septos y estrías de frente (peso > 0,7, brillo de orientación > 0,7) sobre la mediana de su capa (dB de
   * envolvente), los dos a ≥ `WALL_INTERIOR_MM` de toda cara (sin la falda de sus ecos).
   */
  septumDb: number;
  striationDb: number;
  septumSamples: number;
  striationSamples: number;
  /** Pico de la cortical costal en [hueso − 1,5; hueso + 0,5] mm sobre el hígado (dB de envolvente compensada), mediana de las líneas. */
  ribPeakDb: number;
  ribLines: number;
  /**
   * Las líneas de la pared en la imagen (las de `lines` dentro de ella), en las líneas a menos de `WALL_NORMAL_DEG`
   * de la normal: `lineLevelDb`, el pico (±0,6 mm de su profundidad, sin hueso delante) sobre el hígado, mediana
   * (objetivo +6 a +14 dB: gris-blanca, sin saturar y bajo la pleura y la cortical); `lineSaturated`, la fracción
   * de esos picos con gris ≥ 250 (objetivo ≈ 0); `lineCv`, el coeficiente de variación del pico (lineal) a lo
   * largo de cada línea con ≥ 5 líneas del haz, mediana de las líneas (su brillo fluctúa a lo largo de la cara:
   * objetivo ≥ 0,3). W7 de `docs/fidelity/README.md`.
   */
  lineLevelDb: number;
  lineSaturated: number;
  lineCv: number;
}

/** Paso radial (mm) de la rejilla de clasificación en CPU. */
export const GRID_STEP_MM = 0.5;
/** Tejidos que pueden separar el hígado de la luz en el borde de un vaso. */
const WALL_TISSUES: ReadonlySet<number> = new Set([Tissue.VesselWallThin, Tissue.VesselWallPortal]);
/** La rejilla guarda el tejido como número (Uint8Array). */
const LIVER: number = Tissue.Liver;
const BLOOD: number = Tissue.Blood;
const DIAPHRAGM: number = Tissue.Diaphragm;
const AIR: number = Tissue.Air;
const CAPSULE: number = Tissue.LiverCapsule;
const LUNG: number = Tissue.Lung;
const MUSCLE: number = Tissue.Muscle;
const FAT: number = Tissue.Fat;
const PERIRENAL: number = Tissue.PerirenalFat;
const RENAL_CAPSULE: number = Tissue.RenalCapsule;
/** Celdas seguidas de tejido previo que exige una interfaz (3 mm). */
const MIN_BEFORE_CELLS = 6;
/**
 * Alcance del eco del peritoneo parietal hacia la grasa (mm): desplazamiento más alcance del perfil de una
 * cara de un solo lado. Si la cara interna de la pared cae en la ventana del pico de la cápsula ensanchada
 * por él, el registro es de la línea del peritoneo y la cápsula (`peritoneum`), no de la cápsula sola, y su
 * ventana empieza a este alcance por encima del cruce exacto con el peritoneo (no 1,5 mm sobre el borde:
 * ahí está la transversalis).
 */
export const PERITONEUM_REACH_MM = IFACE_SHIFT_MM + IFACE_REACH_MM;
/**
 * La transversalis, al menos a esto (mm de profundidad) por encima del inicio de esa ventana: con el pulso
 * (anchura del eco de una cara ~0,75 mm a −6 dB), su eco llega ~24 dB más bajo. Donde la grasa
 * preperitoneal es más fina, la línea del peritoneo no se mide (su pico sería el de la transversalis).
 */
export const TRANSVERSALIS_CLEAR_MM = 0.7;
/** Enlace de una pared entre líneas vecinas: su borde no se mueve más que esto (mm). */
const WALL_LINK_MM = 3;
/** Pasos de la bisección del cruce exacto con la pleura (0,5 mm / 2²⁰). */
const PLEURA_BISECTION_STEPS = 20;
/** Saturación de una cara: píxeles ≥ 250 a ≤ 1 mm de ella. */
const FACE_SATURATION_MM = 1;
/** Distancia mínima (mm) de la sangre a su pared para medir el centro de la luz (en 3D, más la σ elevacional). */
const LUMEN_CLEARANCE_MM = 1.5;
/** Acoplamiento mínimo de una línea para medir su textura (el mal contacto la oscurece entera). */
const MIN_COUPLING = 0.95;
/** Líneas vecinas que también deben estar despejadas: la PSF lateral arrastra la sombra ~2σ. */
const CLEAR_ERODE_LINES = 2;
/** Margen (mm) antes del primer tejido que hace sombra o refuerza. */
const CLEAR_MARGIN_MM = 2;
/** Distancia mínima (mm) a cualquier tejido que no sea hígado (vasos incluidos). */
const ENVELOPE_CLEARANCE_MM = 6;
const DISPLAY_CLEARANCE_MM = 3;
/**
 * Diferencia de atenuación acumulada (dB, ida y vuelta) respecto al hígado a partir de la cual el
 * hígado de detrás ya no es «puro» para el nivel mostrado: el refuerzo tras un vaso de 2–3 mm.
 */
const MAX_PATH_EXCESS_DB = 0.5;
/**
 * Fracción de aire de la cortina (decisión 61) a partir de la cual, bajo la pleura, el hígado ya no es puro:
 * con 0,01 el hígado pierde 0,09 dB y la réplica de orden 2 de la línea pleural queda ≤ −12 dB bajo él (gemelo:
 * +28 dB con la cortina entera); con 10⁻³, el umbral de la imagen, el borde se come la mitad del hígado de la
 * ventana intercostal sin cambiarlo.
 */
export const CURTAIN_LIVER_MAX_AIR = 0.01;
/**
 * Pérdida por la penumbra de la apertura (dB, transmisión con apertura frente a la de un solo rayo)
 * a partir de la cual el hígado ya no es «puro»: junto a una costilla el cono queda tapado en parte
 * aunque la línea no lo esté (decisión 54), y ese tejido más oscuro es física, no el nivel del hígado.
 */
const MAX_PENUMBRA_DB = 0.5;

/**
 * Transmisión de ida y vuelta de la pasada A (`readTransmission`): un solo rayo, con apertura y la
 * profundidad del espejo (mm, −1 sin espejo hasta esa fila).
 */
export interface TransmissionFrame {
  lines: number;
  samples: number;
  single: Float32Array;
  aperture: Float32Array;
  mirrorHit: Float32Array;
}
/** Paso (mm) de las diferencias centrales de `faceSdf` para la normal de una cara. */
export const NORMAL_EPS_MM = 0.02;

/**
 * Gradiente por diferencias centrales (paso `eps`) de un campo que puede no estar definido (null):
 * null si alguna evaluación no lo está. Normal de las caras del banco y de la e2e de normales.
 */
export function centralGradient(f: (p: Vec3) => number | null, p: Vec3, eps = NORMAL_EPS_MM): Vec3 | null {
  const g: Vec3 = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const plus: Vec3 = [p[0], p[1], p[2]];
    const minus: Vec3 = [p[0], p[1], p[2]];
    plus[a] += eps;
    minus[a] -= eps;
    const dp = f(plus);
    const dm = f(minus);
    if (dp === null || dm === null) return null;
    g[a] = (dp - dm) / (2 * eps);
  }
  return g;
}

/**
 * Celdas de `kind` a ≥ `mm` de cualquier celda de otro tejido en una rejilla líneas × `stepMm`
 * (distancia euclídea en el plano; `spacingAt(k)` es el paso lateral entre líneas en la fila k). Lo que
 * cae fuera de la rejilla (fuera del sector o del campo) no se conoce y cuenta como otro tejido: una
 * celda a < `mm` del borde de la imagen no está despejada.
 */
export function clearanceMask(
  tissue: Uint8Array,
  lines: number,
  nr: number,
  stepMm: number,
  spacingAt: (k: number) => number,
  mm: number,
  kind: number,
): Uint8Array {
  const ok = new Uint8Array(lines * nr);
  const K = Math.ceil(mm / stepMm);
  for (let u = 0; u < lines; u++)
    for (let k = 0; k < nr; k++) {
      if (tissue[u * nr + k] !== kind) continue;
      const spacing = spacingAt(k);
      const U = Math.ceil(mm / spacing);
      let clear = true;
      for (let du = -U; clear && du <= U; du++) {
        const uu = u + du;
        for (let dk = -K; dk <= K; dk++) {
          const kk = k + dk;
          const inGrid = uu >= 0 && uu < lines && kk >= 0 && kk < nr;
          if (inGrid && tissue[uu * nr + kk] === kind) continue;
          if (Math.hypot(du * spacing, dk * stepMm) <= mm) {
            clear = false;
            break;
          }
        }
      }
      ok[u * nr + k] = clear ? 1 : 0;
    }
  return ok;
}

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

/**
 * Métricas del plano actual sobre una rejilla de clasificación en CPU (líneas × 0,5 mm, ~1–3 s).
 * La textura se mide en hígado «despejado»: en líneas bien acopladas, antes de cualquier tejido que
 * haga sombra (gas o hueso, como la pasada A) en la línea y en sus dos vecinas, fuera de la penumbra
 * de la apertura (con `transmission`: ≤ 0,5 dB bajo la de un solo rayo), y a ≥ 6 mm de
 * cualquier tejido que no sea hígado en el plano (≥ 3 mm en la imagen mostrada; los vasos cuentan,
 * aunque la `boundaryDistance` del hígado no los incluya, y lo de fuera del sector cuenta como otro
 * tejido). El gris y el perfil en profundidad, además, solo en hígado «puro»: sin más de 0,5 dB de
 * atenuación distinta de la del hígado en el camino (el refuerzo tras un vaso es física correcta, no
 * un defecto de la TGC). Con `img`, también el banco de interfaces por tramos de incidencia sobre la
 * normal real de cada cara (`FaceSummary`), sobre la envolvente con la compensación nominal
 * (`envelopeLine`), y la saturación junto a las caras; con `samples`, además, un registro por línea y
 * pared (`faceSamples`) para agregar varios planos con `summarizeFaces`.
 *
 * Con `looks` (composición espacial, decisión 58), `env` es la envolvente compuesta y el hígado puro es el
 * de las tres miradas: cada dirigida con su peso entero y con su transmisión con apertura a ≤ 0,5 dB del
 * rayo de la mirada 0 (ni su sombra, ni su penumbra, ni otro tejido en su camino: el AND de las penumbras);
 * la costura (la 0 y una sola dirigida) se mide aparte (`seamStats`), y `compound` da por banda la
 * composición (`CompoundBand`) y la umbra de las costillas del compuesto.
 */
export function fidelityStats(
  sim: Simulator,
  env: EnvelopeFrame,
  img: DisplayFrame | null = null,
  opts: { colorOn?: boolean; transmission?: TransmissionFrame; samples?: boolean; looks?: LookFrames } = {},
): FidelityStats {
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  const geom: EnvelopeGeometry = { depthMm: depth, halfSector: tr.halfSector, curvatureRadius: tr.curvatureRadius };
  const lines = env.lines;
  const dTheta = (2 * tr.halfSector) / lines;
  const thetaOf = (u: number): number => -tr.halfSector + dTheta * (u + 0.5);
  const fB = sim.profile.bEffectiveMHz;
  const alphaLiver = attenuationDbPerCm(Tissue.Liver, fB);

  // Rejilla: tejido, sistema de la sangre (1 + índice en WALL_SYSTEMS), primera sombra, primer gas,
  // primer hueso y primer desvío de atenuación.
  const nr = Math.floor(depth / GRID_STEP_MM);
  const tissue = new Uint8Array(lines * nr);
  const system = new Uint8Array(lines * nr);
  const bloodDepth = new Float32Array(lines * nr);
  const shadowAt = new Float32Array(lines).fill(Infinity);
  const gasAt = new Float32Array(lines).fill(Infinity);
  const boneAt = new Float32Array(lines).fill(Infinity);
  const impureAt = new Float32Array(lines).fill(Infinity);
  const coupled = new Uint8Array(lines);
  for (let u = 0; u < lines; u++) {
    const theta = thetaOf(u);
    coupled[u] = contactCoupling(sim.contact, theta) >= MIN_COUPLING ? 1 : 0;
    let entered = false;
    let inLiver = false;
    let excessDb = 0;
    for (let k = 0; k < nr; k++) {
      const r = (k + 0.5) * GRID_STEP_MM;
      const q = sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, theta, r), sim.sample);
      const i = u * nr + k;
      tissue[i] = q.tissue;
      if (q.tissue === Tissue.Blood && q.vessel) system[i] = 1 + (WALL_SYSTEMS as readonly string[]).indexOf(VESSEL_META[q.vessel].system);
      if (q.tissue === Tissue.Blood) bloodDepth[i] = q.boundaryDistance;
      // el aire antes de la piel es el gel de acoplamiento (la pasada A también lo salta)
      if (q.tissue !== Tissue.Air) entered = true;
      if (entered && r < shadowAt[u] && (TISSUES[q.tissue].gas || TISSUES[q.tissue].bone)) shadowAt[u] = r;
      if (entered && r < gasAt[u] && TISSUES[q.tissue].gas) gasAt[u] = r;
      if (entered && r < boneAt[u] && TISSUES[q.tissue].bone) boneAt[u] = r;
      if (q.tissue === Tissue.Liver) inLiver = true;
      else if (inLiver) {
        excessDb += 2 * (alphaLiver - attenuationDbPerCm(q.tissue, fB)) * (GRID_STEP_MM / 10);
        if (Math.abs(excessDb) > MAX_PATH_EXCESS_DB && r < impureAt[u]) impureAt[u] = r;
      }
    }
  }
  // la pleura de la cortina y su borde blando (decisión 61): bajo ella la línea es pulmón en la fracción fAir
  const curtain = curtainLines(sim, lines);
  const curtainFrom = Float32Array.from(curtain, (c) => (c && c.fAir >= CURTAIN_MIN_AIR ? c.D : Infinity));
  for (let u = 0; u < lines; u++) {
    const c = curtain[u];
    if (!c || c.fAir < CURTAIN_LIVER_MAX_AIR) continue;
    shadowAt[u] = Math.min(shadowAt[u], c.D);
    gasAt[u] = Math.min(gasAt[u], c.D);
  }
  // profundidad despejada (y pura) de cada línea: la menor de ella y de sus vecinas, con margen
  const erode = (at: Float32Array, needCoupling: boolean): Float32Array => {
    const out = new Float32Array(lines);
    for (let u = 0; u < lines; u++) {
      let c = Infinity;
      for (let du = -CLEAR_ERODE_LINES; du <= CLEAR_ERODE_LINES; du++) {
        const uu = u + du;
        if (uu < 0 || uu >= lines) continue;
        c = Math.min(c, needCoupling && !coupled[uu] ? 0 : at[uu]);
      }
      out[u] = c - CLEAR_MARGIN_MM;
    }
    return out;
  };
  const clearUntil = erode(shadowAt, true);
  const pureUntil = erode(impureAt, false);
  // la cara del diafragma llega hasta su propio pulmón: solo el hueso (en la línea y sus vecinas) la tapa
  const boneClearUntil = erode(boneAt, true);
  // celdas de `kind` a ≥ `mm` de cualquier celda de otro tejido (distancia euclídea en la rejilla)
  const spacingAt = (k: number): number => (tr.curvatureRadius + (k + 0.5) * GRID_STEP_MM) * dTheta;
  const clearance = (mm: number, kind: number = LIVER): Uint8Array => clearanceMask(tissue, lines, nr, GRID_STEP_MM, spacingAt, mm, kind);
  // penumbra de la apertura (solo con la transmisión de la GPU; la imagen pintada en CPU no la tiene)
  const looks = opts.looks;
  const tx = opts.transmission ?? looks?.transmissions[0];
  if (looks && !tx) throw new Error('fidelityStats: las miradas del anillo exigen la transmisión de la mirada 0');
  const penumbraMin = Math.pow(10, -MAX_PENUMBRA_DB / 20);
  const txAt = (t: TransmissionFrame, field: 'single' | 'aperture', u: number, r: number): number => {
    const k = Math.min(t.samples - 1, Math.max(0, Math.floor((r / depth) * t.samples)));
    return t[field][k * t.lines + u];
  };
  const outOfPenumbra = (u: number, r: number): boolean => {
    if (!tx) return true;
    const s = txAt(tx, 'single', u, r);
    return s > 1e-6 && txAt(tx, 'aperture', u, r) >= penumbraMin * s;
  };
  const envClear = clearance(ENVELOPE_CLEARANCE_MM);
  const cellOf = (u: number, r: number): number => {
    const k = Math.floor(r / GRID_STEP_MM);
    return k < 0 || k >= nr ? -1 : u * nr + k;
  };
  // Miradas limpias de cada celda de la rejilla (decisión 58): la 0 (su penumbra la mira `outOfPenumbra`)
  // y las dirigidas con peso entero y transmisión a ≤ 0,5 dB del rayo de la mirada 0; una dirigida a medias
  // o sucia deja la celda fuera. Sin miradas, todas son «de tres».
  const nLooks = looks ? looks.thetas.length : 1;
  const lookRegion = new Uint8Array(lines * nr).fill(nLooks);
  if (looks && tx) {
    const wGeom = { curvatureRadius: tr.curvatureRadius, halfSector: tr.halfSector, lines };
    for (let u = 0; u < lines; u++)
      for (let k = 0; k < nr; k++) {
        const r = (k + 0.5) * GRID_STEP_MM;
        const ref = penumbraMin * txAt(tx, 'single', u, r);
        let clean = 1;
        let absent = 0;
        for (let j = 1; j < nLooks; j++) {
          const w = lookWeight(thetaOf(u), tr.curvatureRadius + r, looks.thetas[j], wGeom);
          if (w <= 0) absent++;
          else if (w >= 1 && txAt(looks.transmissions[j], 'aperture', u, r) >= ref) clean++;
        }
        lookRegion[u * nr + k] = clean + absent === nLooks ? clean : 0;
      }
  }

  const inBandWith =
    (looksWanted: number) =>
    (r0: number, r1: number) =>
    (u: number, v: number): boolean => {
      const r = ((v + 0.5) / env.samples) * depth;
      if (r < r0 || r >= r1 || r >= clearUntil[u] || !outOfPenumbra(u, r)) return false;
      const i = cellOf(u, r);
      return i >= 0 && envClear[i] === 1 && lookRegion[i] === looksWanted;
    };
  const inBand = inBandWith(nLooks);
  const inSeam = inBandWith(nLooks - 1);
  const tgcNominal = nominalTgcDbPerCm(fB);

  /** Composición espacial por banda y en la costura (`CompoundBand`, `SeamStats`). */
  function compoundOf(lf: LookFrames): CompoundStats {
    const k2 = lookWavenumber(sim.profile.beam);
    const R = tr.curvatureRadius;
    const n = lf.thetas.length;
    const out: CompoundBand[] = [];
    const seam: SeamStats[] = [];
    for (const [r0, r1] of DEPTH_BANDS_MM) {
      if (r0 >= depth) continue;
      const mask = inBand(r0, r1);
      const c = envelopeTexture(env, mask, geom);
      const per = lf.envelopes.map((e) => envelopeTexture(e, mask, geom));
      const m0 = maskedMean(lf.envelopes[0], mask);
      const corr = lookCorrelations(lf.envelopes, mask, depth, tgcNominal);
      // la ley de cada par con la diferencia de dirección de sus haces en el punto (β de cada mirada) y la
      // σ del grano lateral medido de la mirada 0
      const sigma = per[0].fwhmLateralMm / 2.3548;
      const rho = R + (Number.isFinite(per[0].depthMm) ? per[0].depthMm : (r0 + r1) / 2);
      const beta = lf.thetas.map((th) => steerBeta(rho, th, R));
      const laws: number[] = [];
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) laws.push(lookCorrelationLaw(beta[a] - beta[b], sigma, k2));
      out.push({
        r0,
        r1,
        compound: c,
        look0: per[0],
        perLook: per.map((t, i) => ({ ...t, meanRatio: maskedMean(lf.envelopes[i], mask) / m0 })),
        snrGain: c.snr / per[0].snr,
        grainRatioLateral: c.fwhmLateralMm / per[0].fwhmLateralMm,
        grainRatioAxial: c.fwhmAxialMm / per[0].fwhmAxialMm,
        correlationPatches: corr.patches,
        rho0p: corr.pairs[0],
        rho0m: corr.pairs[1],
        rhoPm: corr.pairs[2],
        law1: laws[0],
        law2: laws[2],
        nEff: effectiveLooks(n, corr.pairs),
        nEffLaw: effectiveLooks(n, laws),
      });
      seam.push(seamStats(env, inSeam(r0, r1), mask, geom, { r0, r1 }));
    }
    return { thetas: [...lf.thetas], bands: out, seam };
  }
  const envelope = envelopeTexture(env, inBand(0, Infinity), geom);
  const bands = DEPTH_BANDS_MM.filter(([r0]) => r0 < depth).map(([r0, r1]) => {
    const t = envelopeTexture(env, inBand(r0, r1), geom);
    const rMid = Number.isFinite(t.depthMm) ? t.depthMm : (r0 + r1) / 2;
    return { ...t, r0, r1, beamFwhmMm: lateralFwhmMm(rMid, sim.bmode.focusMm, sim.profile.beam) };
  });
  const compound = looks ? compoundOf(looks) : undefined;
  if (!img || img.width === 0) return { envelope, bands, ...(compound ? { compound } : {}), display: null };

  const dispClear = clearance(DISPLAY_CLEARANCE_MM);
  const layout = sim.renderer.display;
  /** Profundidad del píxel si cae en hígado despejado y puro; null si no. */
  const pureLiverDepth = (x: number, y: number): number | null => {
    const b = pixelToBeam(layout, tr, depth, x, y);
    if (!b) return null;
    const u = Math.round((b.theta + tr.halfSector) / dTheta - 0.5);
    if (u < 0 || u >= lines || b.r >= clearUntil[u] || b.r >= pureUntil[u] || !outOfPenumbra(u, b.r)) return null;
    const i = cellOf(u, b.r);
    return i >= 0 && dispClear[i] === 1 && lookRegion[i] === nLooks ? b.r : null;
  };
  const liver = displayStats(img, (x, y) => pureLiverDepth(x, y) !== null, 2);
  const liverBands = DEPTH_BANDS_MM.filter(([r0]) => r0 < depth).map(([r0, r1]) => ({
    r0,
    r1,
    ...displayStats(
      img,
      (x, y) => {
        const r = pureLiverDepth(x, y);
        return r !== null && r >= r0 && r < r1;
      },
      2,
    ),
  }));
  const profile = depthProfile(img, pureLiverDepth, sim.bmode.dynamicRangeDb);
  // centro de la luz: sangre de las venas del banco (VCI, suprahepáticas y porta) a ≥ 1,5 mm de su pared en el
  // plano y, en 3D, a ≥ 1,5 mm + la σ elevacional del haz, sin sombra delante (decisión 62). La rodaja entera es
  // sangre: una vena fina u oblicua al plano tiene su pared y el hígado dentro del grosor de corte y su «luz» es
  // gris (en la intercostal por el 8.º espacio las suprahepáticas, a 1,2–1,9 mm de su pared en 3D, daban una
  // mediana de 45–52). La aorta y los vasos renales no cuentan: la aorta asoma al fondo de alguna vista, donde
  // manda el ruido del receptor.
  const lumenClear = clearance(LUMEN_CLEARANCE_MM, BLOOD);
  const cellAt = (x: number, y: number): number => {
    const b = pixelToBeam(layout, tr, depth, x, y);
    if (!b) return -1;
    const u = Math.round((b.theta + tr.halfSector) / dTheta - 0.5);
    if (u < 0 || u >= lines || b.r >= clearUntil[u]) return -1;
    return cellOf(u, b.r);
  };
  const lumen = displayStats(
    img,
    (x, y) => {
      const i = cellAt(x, y);
      if (i < 0 || lumenClear[i] !== 1 || system[i] === 0) return false;
      const r = ((i % nr) + 0.5) * GRID_STEP_MM;
      return bloodDepth[i] >= LUMEN_CLEARANCE_MM + elevSigmaMm(r, tr.elevationFocusMm);
    },
    2,
  );
  // diafragma saturado: fracción de sus píxeles en el blanco (≥ 250)
  let diaphragmPx = 0;
  let diaphragmSat = 0;
  for (let y = 0; y < img.height; y += 2)
    for (let x = 0; x < img.width; x += 2) {
      const i = cellAt(x, y);
      if (i < 0 || tissue[i] !== DIAPHRAGM) continue;
      diaphragmPx++;
      if (img.gray[y * img.width + x] >= 250) diaphragmSat++;
    }
  const diaphragmSaturated = diaphragmPx ? diaphragmSat / diaphragmPx : Number.NaN;

  // Sombra ósea: nivel por línea del tejido blando 10–40 mm detrás del hueso (el de la línea o, fuera
  // de la sombra, el de la línea con hueso más cercana a ±6 para comparar a la misma profundidad).
  const levelDb = (g: number): number => (levelOfGrey(g / 255) - 1) * sim.bmode.dynamicRangeDb;
  const refBone = new Float32Array(lines).fill(Infinity);
  for (let u = 0; u < lines; u++)
    for (let d = 0; d <= 6 && !Number.isFinite(refBone[u]); d++)
      for (const uu of [u - d, u + d]) if (uu >= 0 && uu < lines && Number.isFinite(boneAt[uu])) refBone[u] = boneAt[uu];
  const perLine: number[][] = Array.from({ length: lines }, () => []);
  const perLineGray: number[][] = Array.from({ length: lines }, () => []);
  for (let y = 0; y < img.height; y += 2)
    for (let x = 0; x < img.width; x += 2) {
      const b = pixelToBeam(layout, tr, depth, x, y);
      if (!b) continue;
      const u = Math.round((b.theta + tr.halfSector) / dTheta - 0.5);
      if (u < 0 || u >= lines || !Number.isFinite(refBone[u]) || b.r < refBone[u] + 10 || b.r > refBone[u] + 40) continue;
      const i = cellOf(u, b.r);
      if (i < 0) continue;
      const t = TISSUES[tissue[i]];
      if (t.gas || t.bone || tissue[i] === AIR) continue;
      const g = img.gray[y * img.width + x];
      perLine[u].push(levelDb(g));
      perLineGray[u].push(g);
    }
  const lineLevel = perLine.map((a) => medianOf(a));
  const hit = (u: number): boolean => u >= 0 && u < lines && Number.isFinite(boneAt[u]);
  const isCore = (u: number): boolean => {
    for (let du = -3; du <= 3; du++) if (!hit(u + du)) return false;
    return true;
  };
  const core: number[] = [];
  const coreGray: number[] = [];
  let coreLines = 0;
  for (let u = 0; u < lines; u++) {
    if (isCore(u) && perLine[u].length) {
      coreLines++;
      core.push(...perLine[u]);
      coreGray.push(...perLineGray[u]);
    }
  }
  const edgeAcc = Array.from({ length: 9 }, () => [] as number[]);
  for (let u = 0; u < lines; u++) {
    if (!hit(u)) continue;
    let v = u;
    while (hit(v + 1)) v++;
    if (v - u + 1 >= 7)
      for (let o = -4; o <= 4; o++) {
        for (const line of [u + o, v - o]) {
          const lvl = line >= 0 && line < lines ? lineLevel[line] : Number.NaN;
          if (Number.isFinite(lvl)) edgeAcc[o + 4].push(lvl);
        }
      }
    u = v;
  }
  // Umbra en la transmisión de la pasada A (sin ruido: la umbra a −40 dB queda bajo el suelo de la imagen)
  // en las líneas del núcleo, cada 1 mm tras la cara del hueso, respecto al hígado: el rayo de la mirada 0
  // justo antes del hueso con la atenuación del hígado desde ahí (decisión 58)
  const txLerp = (t: TransmissionFrame, field: 'single' | 'aperture', u: number, r: number): number => {
    const x = Math.min(t.samples - 1, Math.max(0, (r / depth) * t.samples - 0.5));
    const k = Math.min(t.samples - 2, Math.floor(x));
    const f = x - k;
    return t[field][k * t.lines + u] * (1 - f) + t[field][(k + 1) * t.lines + u] * f;
  };
  const umbraProfile = (T: (u: number, r: number) => number): number[] => {
    const prof: number[] = [];
    for (let d = 0; d <= UMBRA_SEARCH_MM; d++) {
      const vals: number[] = [];
      for (let u = 0; u < lines; u++) {
        if (!tx || !isCore(u)) continue;
        const rRef = Math.max(0, boneAt[u] - 1);
        const r = boneAt[u] + d;
        if (r >= depth) continue;
        const ref = txLerp(tx, 'single', u, rRef) * Math.pow(10, (-tgcNominal * (r - rRef)) / 200);
        if (ref > 0) vals.push(20 * Math.log10(Math.max(T(u, r), 1e-12) / ref));
      }
      prof.push(vals.length ? medianOf(vals) : Number.NaN);
    }
    return prof;
  };
  const umbraEndLook0Mm = tx ? umbraEndMm(umbraProfile((u, r) => txLerp(tx, 'aperture', u, r))) : Number.NaN;
  let umbraEndCompoundMm = Number.NaN;
  if (looks) {
    const wGeom = { curvatureRadius: tr.curvatureRadius, halfSector: tr.halfSector, lines };
    umbraEndCompoundMm = umbraEndMm(
      umbraProfile((u, r) => {
        let sum = 0;
        let wsum = 0;
        looks.thetas.forEach((th, j) => {
          const w = lookWeight(thetaOf(u), tr.curvatureRadius + r, th, wGeom);
          sum += w * txLerp(looks.transmissions[j], 'aperture', u, r);
          wsum += w;
        });
        return sum / wsum;
      }),
    );
  }
  const shadow: ShadowStats = {
    coreLines,
    coreDbBelowLiver: liver.pixels && core.length ? levelDb(liver.p50) - medianOf(core) : Number.NaN,
    coreGray: medianOf(coreGray),
    edgeProfileDb: edgeAcc.map((a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : Number.NaN)),
    umbraEndLook0Mm,
    umbraEndCompoundMm,
    umbraShiftMm: umbraEndLook0Mm - umbraEndCompoundMm,
  };

  // Banco de interfaces. Cada línea que pasa de ≥ 3 mm de tejido previo a su objetivo (con, a lo sumo,
  // los tejidos admitidos en medio) da un registro: pico de gris y de envolvente en [rb − 1,5;
  // rObjetivo + 0,5] frente a la mediana del hígado de referencia de la misma línea, con la incidencia
  // sobre la normal real de la cara (gradiente de `faceSdf`, la cantidad que decide la clasificación).
  const grayAt = (u: number, r: number): number => {
    const p = beamToPixel(layout, tr, thetaOf(u), r);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return Number.NaN;
    return img.gray[y * img.width + x];
  };
  // la envolvente sin la atenuación del hígado: la cara y su referencia, a la misma escala
  const envAt = envelopeLine(env, depth, nominalTgcDbPerCm(fB));
  const faceLine = (u: number): FaceLine => ({
    env: (r) => envAt(u, r),
    gray: (r) => grayAt(u, r),
    liver: (r) => {
      const i = cellOf(u, r);
      return i >= 0 && tissue[i] === LIVER;
    },
  });
  const faceCosine = (u: number, r: number, face: FaceGeometry): number | null => {
    const theta = thetaOf(u);
    const g = centralGradient((p) => sim.anatomy.faceSdfWorld(p, sim.sample, face), pointOnLine(sim.frame, tr, theta, r));
    const len = g ? Math.hypot(g[0], g[1], g[2]) : 0;
    return g && len > 0 ? Math.abs(dot(g, lineDirection(sim.frame, theta))) / len : null;
  };
  // Espejo de la pasada A (A0, `FRAG_TRANS_HITS`): la marcha de paso profundidad/COARSE_DEPTH halla el
  // primer segmento cuyo punto medio es pulmón, sobre la línea recta (antes del espejo no se refleja), y la
  // bisección (`mirrorCrossing`) lo lleva al cruce. La GPU lo publica en `mirrorHit`; es el suelo de
  // `mirrorOffsetMm` con esa colocación.
  const coarseStep = depth / COARSE_DEPTH;
  const passAMirror = new Map<number, number>();
  const passAMirrorAt = (u: number): number => {
    let hit = passAMirror.get(u);
    if (hit === undefined) {
      hit = -1;
      const isLung = (r: number) => sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, thetaOf(u), r), sim.sample).tissue === Tissue.Lung;
      for (let s = 0; s < COARSE_DEPTH && hit < 0; s++) {
        const r = (s + 0.5) * coarseStep;
        if (isLung(r)) hit = mirrorCrossing(isLung, r, coarseStep);
      }
      passAMirror.set(u, hit);
    }
    return hit;
  };
  /** Grosor (mm, hasta `coarseStep`) del pulmón que empieza en la profundidad r de la línea u. */
  const lungRunMm = (u: number, r: number): number => {
    const isLung = (q: number) => sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, thetaOf(u), q), sim.sample).tissue === Tissue.Lung;
    let d = 0.05;
    while (d < coarseStep && isLung(r + d)) d += 0.05;
    return d;
  };
  /** Cruce exacto con el pulmón entre dos profundidades de la línea recta (bisección). */
  const pleuraCrossing = (u: number, rOut: number, rIn: number): number => {
    let lo = rOut;
    let hi = rIn;
    for (let it = 0; it < PLEURA_BISECTION_STEPS; it++) {
      const mid = 0.5 * (lo + hi);
      if (sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, thetaOf(u), mid), sim.sample).tissue === Tissue.Lung) hi = mid;
      else lo = mid;
    }
    return 0.5 * (lo + hi);
  };
  // Cruce exacto de la línea u con la cara interna de la pared (el peritoneo parietal, −torsoDepth = pared)
  // entre r0 (dentro de la pared) y r1 (fuera), o null; y cuánto más honda que la transversalis está la
  // muestra r (mm de profundidad bajo la piel)
  const torso = sim.anatomy.scene.torso;
  const innerWallMm = torso.skinMm + torso.fatMm + torso.muscleMm;
  const materialAt = (u: number, r: number): Vec3 =>
    sim.anatomy.deformation.toMaterial(pointOnLine(sim.frame, tr, thetaOf(u), r), sim.sample.resp);
  const wallDepthAt = (u: number, r: number): number => -torsoDepth(materialAt(u, r), torso);
  const peritoneumCrossing = (u: number, r0: number, r1: number): number | null => {
    if (!(wallDepthAt(u, r0) < innerWallMm && wallDepthAt(u, r1) >= innerWallMm)) return null;
    let lo = r0;
    let hi = r1;
    for (let it = 0; it < PLEURA_BISECTION_STEPS; it++) {
      const mid = 0.5 * (lo + hi);
      if (wallDepthAt(u, mid) >= innerWallMm) hi = mid;
      else lo = mid;
    }
    return 0.5 * (lo + hi);
  };
  const belowTransversalisMm = (u: number, r: number): number => {
    const m = materialAt(u, r);
    return -torsoDepth(m, torso) - wallDepths(torso, wallArc(m, torso), m[2]).transversalis;
  };
  const tissueIn =
    (...ts: number[]) =>
    (i: number): boolean =>
      ts.includes(tissue[i]);
  const specs: InterfaceSpec[] = [
    ...WALL_SYSTEMS.map((sys, j): InterfaceSpec => ({
      kind: sys,
      before: tissueIn(LIVER),
      target: (i) => tissue[i] === BLOOD && system[i] === j + 1,
      between: (i) => WALL_TISSUES.has(tissue[i]),
      maxCells: 4,
      minBetween: 0,
      ref: 'above',
      face: 'tube',
    })),
    // cápsula bajo la pared: la referencia es el hígado de debajo
    {
      kind: 'capsule',
      before: tissueIn(MUSCLE, FAT),
      target: tissueIn(CAPSULE),
      between: () => true,
      maxCells: 4,
      minBetween: 0,
      ref: 'below',
      face: 'liverSurface',
    },
    // hígado → diafragma → pulmón: el objetivo es el cruce exacto con la pleura
    {
      kind: 'diaphragm',
      before: tissueIn(LIVER, CAPSULE),
      target: tissueIn(LUNG),
      between: tissueIn(DIAPHRAGM),
      maxCells: 10,
      minBetween: 1,
      ref: 'above',
      face: 'dome',
    },
    // Morison: hígado → grasa perirrenal → cápsula renal
    {
      kind: 'renalCapsule',
      before: tissueIn(LIVER, CAPSULE),
      target: tissueIn(RENAL_CAPSULE),
      between: tissueIn(PERIRENAL),
      maxCells: 12,
      minBetween: 1,
      ref: 'above',
      face: 'kidneyOuter',
    },
  ];
  const faceSamples: FaceSample[] = [];
  let nextWall = 0;
  let prevLine = new Map<FaceKind, { rb: number; wall: number; used: boolean }[]>();
  for (let u = 0; u < lines; u++) {
    const curLine = new Map<FaceKind, { rb: number; wall: number; used: boolean }[]>();
    const pitchMm = (rb: number): number => (tr.curvatureRadius + rb) * dTheta;
    const mirrorGpu = tx ? tx.mirrorHit[(tx.samples - 1) * tx.lines + u] : -1;
    for (const spec of specs) {
      let run = 0;
      for (let k = 0; k < nr - spec.maxCells; k++) {
        const i = u * nr + k;
        if (spec.before(i)) {
          run++;
          continue;
        }
        const prior = run;
        run = 0;
        if (prior < MIN_BEFORE_CELLS) continue;
        let hit = -1;
        for (let j = 0; j < spec.maxCells && hit < 0; j++) if (spec.target(i + j)) hit = j;
        for (let j = 0; j < hit; j++) if (!spec.between(i + j)) hit = -1;
        if (hit < spec.minBetween) continue;
        const rb = k * GRID_STEP_MM;
        const rCell = (k + hit + 0.5) * GRID_STEP_MM;
        const pleura = spec.kind === 'diaphragm';
        // la pleura es el primer gas de su línea (si no, el espejo de la GPU está en otro sitio)
        if (pleura ? rb >= boneClearUntil[u] || gasAt[u] < rCell - 1e-6 : rb >= clearUntil[u]) continue;
        // pared de la línea: la de la línea anterior con el borde más cercano (≤ 3 mm), o una nueva
        const prev = (prevLine.get(spec.kind) ?? []).filter((c) => !c.used && Math.abs(c.rb - rb) <= WALL_LINK_MM);
        prev.sort((a, b) => Math.abs(a.rb - rb) - Math.abs(b.rb - rb));
        const link = prev[0];
        if (link) link.used = true;
        const wall = link ? link.wall : nextWall++;
        curLine.set(spec.kind, [...(curLine.get(spec.kind) ?? []), { rb, wall, used: false }]);
        const rTarget = pleura ? pleuraCrossing(u, rCell - GRID_STEP_MM, rCell) : (k + hit) * GRID_STEP_MM;
        // una lámina de pulmón más fina que el paso de la marcha de A0 (la que queda entre el diafragma y la VCI
        // supradiafragmática, `lung-sliver-caval-hiatus`) no la ve la GPU: su espejo está en otro sitio
        if (pleura && lungRunMm(u, rTarget) < coarseStep) continue;
        const cos = faceCosine(u, pleura ? rTarget : rCell, spec.face);
        if (cos === null) continue;
        // la cápsula con el peritoneo en su ventana es la línea de los dos (decisión 62): ventana desde el
        // alcance del eco del peritoneo, sin la transversalis
        let kind: FaceKind = spec.kind;
        let peakFrom: number | undefined;
        if (spec.kind === 'capsule') {
          const rP = peritoneumCrossing(u, rb - PEAK_BEFORE_MM - PERITONEUM_REACH_MM, rTarget + PEAK_AFTER_MM + PERITONEUM_REACH_MM);
          if (rP !== null) {
            peakFrom = rP - PERITONEUM_REACH_MM;
            if (belowTransversalisMm(u, peakFrom) < TRANSVERSALIS_CLEAR_MM) continue;
            kind = 'peritoneum';
          }
        }
        const m = measureFaceLine(faceLine(u), { rb, rTarget, ref: spec.ref, pleura, peakFrom }, sim.bmode.dynamicRangeDb);
        if (!m) continue;
        faceSamples.push({
          ...m,
          kind,
          wall,
          u,
          rb,
          pitchMm: pitchMm(rb),
          incidenceDeg: (Math.acos(Math.min(1, cos)) * 180) / Math.PI,
          ...(pleura
            ? {
                mirrorOffsetMm: mirrorGpu >= 0 ? Math.abs(mirrorGpu - rTarget) : Number.NaN,
                mirrorFloorMm: passAMirrorAt(u) >= 0 ? Math.abs(passAMirrorAt(u) - rTarget) : Number.NaN,
              }
            : {}),
        });
      }
    }
    prevLine = curLine;
  }
  const summary = summarizeFaces([faceSamples]);

  // Pared (decisión 62): el perfil de la envolvente compensada en profundidad bajo la piel, mediana lateral de
  // las líneas casi normales a la piel; las capas en toda la imagen, con la geometría de la textura en CPU
  // (`wallTexture.ts`: los septos y las estrías están en el mismo sitio del material que en la GPU)
  const liverEnv: number[] = [];
  {
    const mask = inBand(0, Infinity);
    for (let u = 0; u < lines; u++)
      for (let v = 0; v < env.samples; v++)
        if (mask(u, v)) liverEnv.push(20 * Math.log10(Math.max(envAt(u, ((v + 0.5) / env.samples) * depth), 1e-12)));
  }
  const wall = wallStatsOf(sim, envAt, grayAt, thetaOf, lines, medianOf(liverEnv), liver.p50);

  // Caras saturadas: píxeles ≥ 250 a ≤ 1 mm de la cúpula, del contorno renal y de la vesícula, entre los
  // tejidos a ambos lados de cada cara (distancia de `faceSdf` en el punto del píxel).
  const saturatedNear = (face: FaceGeometry, near: readonly number[]): number => {
    let px = 0;
    let sat = 0;
    for (let y = 0; y < img.height; y += 2)
      for (let x = 0; x < img.width; x += 2) {
        const b = pixelToBeam(layout, tr, depth, x, y);
        if (!b) continue;
        const u = Math.round((b.theta + tr.halfSector) / dTheta - 0.5);
        const i = u >= 0 && u < lines ? cellOf(u, b.r) : -1;
        if (i < 0 || !near.includes(tissue[i])) continue;
        // la línea pleural de la cortina (decisión 61) satura por diseño: no es la cara de un órgano
        if (b.r >= curtainFrom[u] - 1) continue;
        const d = sim.anatomy.faceSdfWorld(pointOnLine(sim.frame, tr, b.theta, b.r), sim.sample, face);
        if (d === null || Math.abs(d) > FACE_SATURATION_MM) continue;
        px++;
        if (img.gray[y * img.width + x] >= 250) sat++;
      }
    return px ? sat / px : Number.NaN;
  };
  const faceSaturated = {
    diaphragm: saturatedNear('dome', [DIAPHRAGM, LUNG]),
    morison: saturatedNear('kidneyOuter', [RENAL_CAPSULE, PERIRENAL, Tissue.RenalCortex, Tissue.RenalMedulla]),
    gallbladder: saturatedNear('gallbladder', [Tissue.Fluid, Tissue.BileDuctWall]),
  };
  return {
    envelope,
    bands,
    ...(compound ? { compound } : {}),
    display: {
      liver,
      liverBands,
      lumen,
      diaphragmSaturated,
      shadow,
      profile,
      ...summary,
      faceSaturated,
      wall,
      colorOn: opts.colorOn ?? false,
    },
    ...(opts.samples ? { faceSamples } : {}),
  };
}

/**
 * Banco de la pared de un plano (decisión 62): `envAt` es la envolvente compensada con la atenuación nominal
 * del hígado (la de `envelopeLine`), `grayAt` el gris mostrado, `liverEnvDb` la mediana en dB de esa
 * envolvente en el hígado despejado y `liverGray` su gris mediano.
 */
/** Caras que dibuja la grasa subcutánea (la preperitoneal dibuja la transversalis y el peritoneo). */
const SUBCUTANEOUS_FACES: ReadonlySet<Interface> = new Set([Interface.SkinFat, Interface.Scarpa, Interface.DeepFascia]);

function wallStatsOf(
  sim: Simulator,
  envAt: (u: number, r: number) => number,
  grayAt: (u: number, r: number) => number,
  thetaOf: (u: number) => number,
  lines: number,
  liverEnvDb: number,
  liverGray: number,
): WallStats {
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  const scene = sim.anatomy.scene;
  const torso = scene.torso;
  const caliber = sim.anatomy.caliberFor(sim.sample);
  const toMaterial = (p: Vec3): Vec3 => sim.anatomy.deformation.toMaterial(p, sim.sample.resp);
  const wallMm = torso.skinMm + torso.fatMm + torso.muscleMm;
  const dB = (u: number, r: number): number => 20 * Math.log10(Math.max(envAt(u, r), 1e-12));
  const STEP = 0.1;
  // cruce con la piel (bisección) e incidencia de cada línea sobre su normal
  const skin = new Float64Array(lines).fill(Number.NaN);
  const inc = new Float64Array(lines).fill(Number.NaN);
  for (let u = 0; u < lines; u++) {
    const theta = thetaOf(u);
    const depthAt = (r: number): number => torsoDepth(toMaterial(pointOnLine(sim.frame, tr, theta, r)), torso);
    let r0 = -1;
    for (let r = 0; r < 40; r += 0.25)
      if (depthAt(r) <= 0) {
        r0 = r;
        break;
      }
    if (r0 < 0) continue;
    let lo = Math.max(0, r0 - 0.25);
    let hi = r0;
    for (let it = 0; it < 12 && r0 > 0; it++) {
      const mid = 0.5 * (lo + hi);
      if (depthAt(mid) <= 0) hi = mid;
      else lo = mid;
    }
    skin[u] = hi;
    // la normal de la piel en el mundo: con la compresión de la sonda (decisión 63) la piel sigue a la cara
    const pSkin = pointOnLine(sim.frame, tr, theta, hi);
    const n = normalize(warpNormal(warpAt(pSkin, sim.anatomy.probeCompression), torsoNormal(toMaterial(pSkin), torso)));
    inc[u] = (Math.acos(Math.min(1, Math.abs(dot(n, lineDirection(sim.frame, theta))))) * 180) / Math.PI;
  }
  // perfil: la envolvente a la profundidad bajo la piel w de cada paso, mediana entre las líneas más normales
  const normal = [...Array(lines).keys()].filter((u) => inc[u] < WALL_NORMAL_DEG).sort((a, b) => inc[a] - inc[b]);
  const chosen = normal.slice(0, WALL_PROFILE_LINES);
  const nb = Math.round((wallMm + 1) / STEP) + 1;
  const perBin: number[][] = Array.from({ length: nb }, () => []);
  for (const u of chosen) {
    const theta = thetaOf(u);
    let prevR = skin[u];
    let prevW = 0;
    let b = 0;
    for (let r = skin[u] + 0.05; r < Math.min(depth, skin[u] + 2 * (wallMm + 1)) && b < nb; r += 0.05) {
      const w = -torsoDepth(toMaterial(pointOnLine(sim.frame, tr, theta, r)), torso);
      while (b < nb && b * STEP <= w) {
        const f = w > prevW ? (b * STEP - prevW) / (w - prevW) : 0;
        perBin[b].push(dB(u, prevR + f * (r - prevR)));
        b++;
      }
      prevR = r;
      prevW = w;
    }
  }
  const profileDb = perBin.map((v) => (v.length ? medianOf(v) - liverEnvDb : Number.NaN));
  const found = brightLines(profileDb, STEP);
  const insideCount = found.depthsMm.filter((d) => d >= 0.5 && d <= wallMm - 1).length;
  // capas en las líneas casi normales a la piel (< WALL_LAYER_DEG) y cortical en todas, cada 0,1 mm
  const lob: number[] = [];
  const mus: number[] = [];
  const fatLayer: number[] = [];
  const musLayer: number[] = [];
  const sep: number[] = [];
  const str: number[] = [];
  const rib: number[] = [];
  const boneAtLine = new Float64Array(lines).fill(-1);
  for (let u = 0; u < lines; u++) {
    if (!Number.isFinite(skin[u])) continue;
    const theta = thetaOf(u);
    const dir = lineDirection(sim.frame, theta);
    let bone = -1;
    for (let r = skin[u]; r < Math.min(depth, skin[u] + wallMm + 8); r += STEP) {
      const m = toMaterial(pointOnLine(sim.frame, tr, theta, r));
      const c = scene.classify(m, caliber);
      if (c.tissue === Tissue.Bone) {
        bone = r;
        break;
      }
      if (!(inc[u] < WALL_LAYER_DEG)) continue;
      // la grasa subcutánea dibuja sus caras (piel, Scarpa, fascia); la preperitoneal, las de dentro
      const sub = c.tissue === Tissue.Fat && SUBCUTANEOUS_FACES.has(c.interface);
      if (!sub && c.tissue !== Tissue.Muscle) continue;
      const tex = sub ? fatSeptum(m, torso) : muscleStriation(m, torso);
      const far = c.interfaceDistance >= WALL_INTERIOR_MM;
      const e = dB(u, r);
      // todo lejos de las caras: la falda axial de un eco de fascia (+15–25 dB) no puede contar como septo
      if (!far) continue;
      (sub ? fatLayer : musLayer).push(e);
      if (tex[3] < 0.05) (sub ? lob : mus).push(grayAt(u, r));
      else if (
        tex[3] > 0.7 &&
        wallOrientation(
          normalize(warpNormal(warpAt(pointOnLine(sim.frame, tr, theta, r), sim.anatomy.probeCompression), [tex[0], tex[1], tex[2]])),
          dir,
        ) > 0.7
      )
        (sub ? sep : str).push(e);
    }
    boneAtLine[u] = bone;
    if (bone < 0) continue;
    let pk = -Infinity;
    for (let r = bone - 1.5; r <= bone + 0.5; r += 0.05) pk = Math.max(pk, dB(u, r));
    rib.push(pk - liverEnvDb);
  }
  // las líneas de la pared en la imagen: el pico de cada una a lo largo de las líneas casi normales
  const lineLevel: number[] = [];
  let linePeaks = 0;
  let lineSat = 0;
  const lineCvs: number[] = [];
  for (const wL of found.depthsMm.filter((d) => d >= 0.5 && d <= wallMm - 1)) {
    const amps: number[] = [];
    for (const u of normal) {
      const theta = thetaOf(u);
      let rL = -1;
      for (let r = skin[u]; r < Math.min(depth, skin[u] + 2 * (wallMm + 1)); r += 0.05)
        if (-torsoDepth(toMaterial(pointOnLine(sim.frame, tr, theta, r)), torso) >= wL) {
          rL = r;
          break;
        }
      // sin hueso en la ventana del pico ni en el eco de su cortical, que dibuja el tejido blando a menos de
      // `ribFacePriorityMm` de la costilla (decisión 62): con la pared comprimida (decisión 63) la capa hallada a
      // ~1 mm sobre una costilla era su cortical, +26 dB, y se contaba como línea de la pared saturada
      if (rL < 0 || (boneAtLine[u] >= 0 && boneAtLine[u] < rL + 0.6 + WALL.ribFacePriorityMm)) continue;
      let pk = -Infinity;
      let gy = 0;
      for (let r = rL - 0.6; r <= rL + 0.6; r += 0.05) {
        pk = Math.max(pk, dB(u, r));
        gy = Math.max(gy, grayAt(u, r) || 0);
      }
      lineLevel.push(pk - liverEnvDb);
      linePeaks++;
      if (gy >= 250) lineSat++;
      amps.push(Math.pow(10, pk / 20));
    }
    if (amps.length >= 5) {
      const mean = amps.reduce((a, b) => a + b, 0) / amps.length;
      lineCvs.push(Math.sqrt(amps.reduce((a, b) => a + (b - mean) ** 2, 0) / amps.length) / mean);
    }
  }
  const fatGray = medianOf(lob.filter(Number.isFinite));
  const muscleGray = medianOf(mus.filter(Number.isFinite));
  return {
    normalLines: normal.length,
    profileLines: chosen.length,
    lines: found,
    linesInside: insideCount,
    profileDb,
    fatGray,
    muscleGray,
    fatToLiver: fatGray / liverGray,
    muscleToLiver: muscleGray / liverGray,
    septumDb: medianOf(sep) - medianOf(fatLayer),
    striationDb: medianOf(str) - medianOf(musLayer),
    septumSamples: sep.length,
    striationSamples: str.length,
    ribPeakDb: medianOf(rib),
    ribLines: rib.length,
    lineLevelDb: medianOf(lineLevel),
    lineSaturated: linePeaks ? lineSat / linePeaks : Number.NaN,
    lineCv: medianOf(lineCvs),
  };
}

/**
 * Una interfaz del banco sobre la rejilla del plano: `before` (≥ 6 celdas seguidas), luego `target`
 * a < `maxCells` celdas del borde con solo celdas `between` en medio (al menos `minBetween`).
 */
interface InterfaceSpec {
  kind: FaceKind;
  before: (i: number) => boolean;
  target: (i: number) => boolean;
  between: (i: number) => boolean;
  maxCells: number;
  minBetween: number;
  ref: 'above' | 'below';
  face: FaceGeometry;
}

// ——— Pleura parietal y cortina pulmonar (decisión 61) ———

/**
 * La pleura parietal de una línea del plano actual: el gemelo de A0 h2 (`pleuraCrossingLine`: el cruce
 * exacto de la cara interna de la pared y la distancia al borde de la cortina) y de la fracción de aire de la
 * pasada B (`curtainAirFractionAt`, con el haz del equipo).
 */
export interface CurtainLine {
  u: number;
  /** Distancia de la línea a la pleura (mm), al borde de la cortina (mm, + hacia el pulmón) y fracción de aire. */
  D: number;
  dz: number;
  fAir: number;
  sigmaMm: number;
  /** Incidencia sobre la cara interna de la pared (°), z material del cruce y el cruce en el mundo. */
  incidenceDeg: number;
  z: number;
  point: Vec3;
  /** Hay hueso (una costilla) en la línea antes de la pleura: su línea pleural y su neblina están en sombra. */
  shadowed: boolean;
}

/** `CurtainLine` de cada una de las `lines` líneas del plano (null si A0 no registra pleura en ella). */
export function curtainLines(sim: Simulator, lines: number): (CurtainLine | null)[] {
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  const a = sim.anatomy;
  const resp = sim.sample.resp;
  const mat = (p: Vec3): Vec3 => a.deformation.toMaterial(p, resp);
  const dTheta = (2 * tr.halfSector) / lines;
  const out: (CurtainLine | null)[] = [];
  for (let u = 0; u < lines; u++) {
    const theta = -tr.halfSector + dTheta * (u + 0.5);
    const origin = pointOnLine(sim.frame, tr, theta, 0);
    const dir = lineDirection(sim.frame, theta);
    const c = pleuraCrossingLine(
      (p) => a.scene.insideWallMm(mat(p)),
      (p) => a.scene.lungEdgeMm(mat(p), a.caliberFor(sim.sample)),
      origin,
      dir,
      depth,
      COARSE_DEPTH,
    );
    if (!c) {
      out.push(null);
      continue;
    }
    const point: Vec3 = [origin[0] + dir[0] * c.D, origin[1] + dir[1] * c.D, origin[2] + dir[2] * c.D];
    const m = mat(point);
    // la normal de la pleura en el mundo (la compresión de la sonda la pone de cara a la línea, decisión 63)
    const nW = normalize(warpNormal(warpAt(point, a.probeCompression), torsoNormal(m, a.scene.torso)));
    const { fAir, sigmaMm } = curtainAirFractionAt(c.dz, c.D, dir, sim.frame.elevation, tr.elevationFocusMm, (r) =>
      lateralSigmaMm(r, sim.bmode.focusMm, sim.profile.beam),
    );
    const cos = Math.abs(dot(nW, dir));
    let shadowed = false;
    for (let r = 0.25; r < c.D && !shadowed; r += GRID_STEP_MM)
      shadowed = TISSUES[a.classifyWorld(pointOnLine(sim.frame, tr, theta, r), sim.sample).tissue].bone;
    out.push({ u, D: c.D, dz: c.dz, fAir, sigmaMm, incidenceDeg: (Math.acos(Math.min(1, cos)) * 180) / Math.PI, z: m[2], point, shadowed });
  }
  return out;
}

/** Líneas con la cortina entera (fracción de aire ≥ esto): las de la línea pleural, la neblina y las líneas A. */
export const CURTAIN_FULL_AIR = 0.99;
/** Incidencia máxima (°) de las líneas en que se mide la línea pleural y las líneas A. */
export const PLEURA_MAX_INCIDENCE_DEG = 15;
/** Gris de saturación de la imagen mostrada. */
const SATURATED_GREY = 250;

/**
 * Métricas de la pleura parietal y la cortina en el plano actual (spec §4 de la decisión 61; referencias en
 * docs/fidelity/README.md). Se informan, no se exigen: las vigila el responsable con GPU.
 */
export interface PleuraStats {
  /**
   * Líneas con pleura y fracción de aire ≥ 10⁻³; con la cortina entera y sin costilla delante; y de ellas, a
   * ≤ 15° de incidencia.
   */
  lines: number;
  fullLines: number;
  normalLines: number;
  /** Línea pleural a 0–15°: mediana del ancho saturado (≥ 250, mm) y del gris pico. */
  pleuraSaturatedMm: number;
  pleuraPeakGrey: number;
  /** Hígado puro fuera de la cortina (gris mostrado, mediana) y cuántos píxeles. */
  liverP50: number;
  liverPixels: number;
  /** Neblina: mediana del gris en [D + 2, 2D − 2] y en [2D + 2, 3D − 2] (cortina entera, ≤ 25°) y su cociente con el hígado. */
  hazeGrey: number;
  hazeGreyDeep: number;
  hazeRatio: number;
  /** Línea A de orden 2: pico sobre la mediana de la neblina vecina (dB); picos de las de orden 2 y 3 (dB, envolvente compensada). */
  aLine2ProminenceDb: number;
  aLine2PeakDb: number;
  aLine3PeakDb: number;
  /** Textura de la neblina en [D + 2, 2D − 2] (parches del banco) y anisotropía FWHM lateral/axial. */
  haze: EnvelopeTexture;
  hazeAnisotropy: number;
  /**
   * Borde blando: ajuste de Φ al nivel medio (dB) de [2D + 3, 2D + 20] frente a la z del cruce de la pleura;
   * centro (z, mm), anchura 10–90 % en z y a lo largo de la pleura en la imagen (mm), y sus mesetas.
   */
  edge: { centerZMm: number; width1090Mm: number; width1090ImageMm: number; lines: number; liverSideDb: number; lungSideDb: number } | null;
}

/** Mediana de una lista (NaN si está vacía). */
const med = (a: readonly number[]): number => medianOf(a);

/**
 * Métricas de la pleura y la cortina (`PleuraStats`) sobre la envolvente de la mirada 0 o la compuesta y, si
 * la hay, la imagen mostrada. `curtain`: `curtainLines` del mismo cuadro.
 */
export function pleuraStats(
  sim: Simulator,
  env: EnvelopeFrame,
  img: DisplayFrame | null,
  curtain: readonly (CurtainLine | null)[],
): PleuraStats {
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  const lines = env.lines;
  const dTheta = (2 * tr.halfSector) / lines;
  const thetaOf = (u: number): number => -tr.halfSector + dTheta * (u + 0.5);
  const dr = depth / env.samples;
  const envAt = envelopeLine(env, depth, nominalTgcDbPerCm(sim.profile.bEffectiveMHz));
  const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-12));
  const withAir = curtain.filter((c): c is CurtainLine => c !== null && c.fAir >= CURTAIN_MIN_AIR);
  // la cortina entera, fuera de la sombra de las costillas (bajo una costilla la pleura está en sombra)
  const full = withAir.filter((c) => c.fAir >= CURTAIN_FULL_AIR && !c.shadowed && 2 * c.D + 4 < depth);
  const normal = full.filter((c) => c.incidenceDeg <= PLEURA_MAX_INCIDENCE_DEG);
  const hazeLines = full.filter((c) => c.incidenceDeg <= 25);
  const layout = img && img.width ? sim.renderer.display : null;
  const grayAt = (u: number, r: number): number => {
    if (!img || !layout) return Number.NaN;
    const p = beamToPixel(layout, tr, thetaOf(u), r);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return Number.NaN;
    return img.gray[y * img.width + x];
  };
  const inBand = (c: CurtainLine, lo: number, hi: number, f: (u: number, r: number) => number): number[] => {
    const out: number[] = [];
    for (let r = Math.max(0, lo); r <= Math.min(depth - dr, hi); r += dr) {
      const v = f(c.u, r);
      if (Number.isFinite(v)) out.push(v);
    }
    return out;
  };
  // línea pleural: ancho saturado y pico, en la imagen mostrada
  const widths: number[] = [];
  const peaks: number[] = [];
  if (img && layout)
    for (const c of normal) {
      let w = 0;
      let pk = 0;
      for (let r = c.D - 3; r <= c.D + 3; r += 0.02) {
        const g = grayAt(c.u, r);
        if (!Number.isFinite(g)) continue;
        pk = Math.max(pk, g);
        if (g >= SATURATED_GREY) w += 0.02;
      }
      widths.push(w);
      peaks.push(pk);
    }
  // el hígado puro fuera de la cortina, en la imagen mostrada (la misma máscara que la guarda del moteado)
  let liverP50 = Number.NaN;
  let liverPixels = 0;
  if (img && layout) {
    const clear = clearLiverGrid(sim, lines, DISPLAY_CLEARANCE_MM);
    const st = displayStats(
      img,
      (x, y) => {
        const b = pixelToBeam(layout, tr, depth, x, y);
        if (!b || b.r < 20 || b.r > 120) return false;
        return clear.at(Math.round((b.theta + tr.halfSector) / dTheta - 0.5), b.r);
      },
      2,
    );
    liverP50 = st.p50;
    liverPixels = st.pixels;
  }
  // neblina en la imagen mostrada
  const haze = hazeLines.flatMap((c) => inBand(c, c.D + 2, 2 * c.D - 2, grayAt));
  const hazeDeep = hazeLines.flatMap((c) => inBand(c, 2 * c.D + 2, 3 * c.D - 2, grayAt));
  const hazeGrey = med(haze);
  // líneas A en la envolvente compensada: pico de orden k frente a la neblina a ±(0,15–0,4)·D
  const peakDb = (c: CurtainLine, k: number): number => {
    let p = -Infinity;
    for (let r = k * c.D - 1.5; r <= Math.min(depth - dr, k * c.D + 1); r += 0.05) p = Math.max(p, db(envAt(c.u, r)));
    return p;
  };
  const aroundDb = (c: CurtainLine, k: number): number =>
    med([
      ...inBand(c, (k - 0.4) * c.D, (k - 0.15) * c.D, (u, r) => db(envAt(u, r))),
      ...inBand(c, (k + 0.15) * c.D, (k + 0.4) * c.D, (u, r) => db(envAt(u, r))),
    ]);
  const deepEnough = (k: number) => normal.filter((c) => (k + 0.4) * c.D < depth);
  // textura de la neblina (parches del banco, 48 × 16)
  const byU = new Map<number, CurtainLine>(hazeLines.map((c) => [c.u, c]));
  const hazeTexture = envelopeTexture(
    env,
    (u, v) => {
      const c = byU.get(u);
      const r = (v + 0.5) * dr;
      return c !== undefined && r >= c.D + 2 && r <= 2 * c.D - 2;
    },
    { depthMm: depth, halfSector: tr.halfSector, curvatureRadius: tr.curvatureRadius },
  );
  return {
    lines: withAir.length,
    fullLines: full.length,
    normalLines: normal.length,
    pleuraSaturatedMm: med(widths),
    pleuraPeakGrey: med(peaks),
    liverP50,
    liverPixels,
    hazeGrey,
    hazeGreyDeep: med(hazeDeep),
    hazeRatio: hazeGrey / liverP50,
    aLine2ProminenceDb: med(deepEnough(2).map((c) => peakDb(c, 2) - aroundDb(c, 2))),
    aLine2PeakDb: med(deepEnough(3).map((c) => peakDb(c, 2))),
    aLine3PeakDb: med(deepEnough(3).map((c) => peakDb(c, 3))),
    haze: hazeTexture,
    hazeAnisotropy: hazeTexture.fwhmLateralMm / hazeTexture.fwhmAxialMm,
    edge: curtainEdgeFit(curtain, (u, r) => db(envAt(u, r)), depth, dr),
  };
}

/**
 * Borde de la cortina: Φ ajustada (rejilla) al nivel medio de cada línea con pleura en [2D + 3, 2D + 20] (bajo
 * la primera línea A: el hígado frente a la neblina del segundo intervalo, que es donde más se diferencian)
 * frente a la z del cruce de su pleura, entre las mesetas del lado del hígado (fracción de aire < 0,02) y del
 * pulmón (> 0,98). null si falta alguna meseta o hay menos de 12 líneas.
 */
export function curtainEdgeFit(
  curtain: readonly (CurtainLine | null)[],
  levelDb: (u: number, r: number) => number,
  depth: number,
  dr: number,
): PleuraStats['edge'] {
  const rows: { z: number; s: number; level: number; fAir: number }[] = [];
  let arc = 0;
  let prev: CurtainLine | null = null;
  for (const c of curtain) {
    if (!c) continue;
    // a través de las líneas sin pleura, la distancia entre los cruces que las rodean
    if (prev) arc += Math.hypot(c.point[0] - prev.point[0], c.point[1] - prev.point[1], c.point[2] - prev.point[2]);
    prev = c;
    // las líneas en la sombra de una costilla no dicen nada del borde
    if (c.shadowed || 2 * c.D + 20 > depth) continue;
    let sum = 0;
    let n = 0;
    for (let r = 2 * c.D + 3; r <= 2 * c.D + 20; r += dr) {
      sum += levelDb(c.u, r);
      n++;
    }
    rows.push({ z: c.z, s: arc, level: sum / n, fAir: c.fAir });
  }
  const liverSide = med(rows.filter((r) => r.fAir < 0.02).map((r) => r.level));
  const lungSide = med(rows.filter((r) => r.fAir > 0.98).map((r) => r.level));
  if (rows.length < 12 || !Number.isFinite(liverSide) || !Number.isFinite(lungSide)) return null;
  const fit = (x: (r: (typeof rows)[number]) => number): { c: number; sigma: number } => {
    const xs = rows.map(x);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    // el nivel baja hacia el pulmón; el signo de la pendiente sale de las mesetas
    const sign = med(rows.filter((r) => r.fAir > 0.98).map(x)) > med(rows.filter((r) => r.fAir < 0.02).map(x)) ? 1 : -1;
    let best = { e: Infinity, c: 0, sigma: 1 };
    for (let c = lo; c <= hi; c += 0.25)
      for (let sigma = 0.5; sigma <= 15; sigma += 0.1) {
        let e = 0;
        for (let i = 0; i < rows.length; i++)
          e += (rows[i].level - (liverSide + (lungSide - liverSide) * normalCdf((sign * (xs[i] - c)) / sigma))) ** 2;
        if (e < best.e) best = { e, c, sigma };
      }
    return best;
  };
  const inZ = fit((r) => r.z);
  const inImage = fit((r) => r.s);
  return {
    centerZMm: inZ.c,
    width1090Mm: edgeWidth1090Mm(inZ.sigma),
    width1090ImageMm: edgeWidth1090Mm(inImage.sigma),
    lines: rows.length,
    liverSideDb: liverSide,
    lungSideDb: lungSide,
  };
}

/**
 * Deslizamiento (decisión 61): correlación entre dos cuadros de la banda de 2–6 mm bajo la pleura y de la de
 * la pared de 2–6 mm sobre ella, en las líneas con la cortina entera en los dos (misma pose; el pulmón ha
 * bajado entre ellos). La pared está quieta: su banda cambia solo por el ruido del receptor.
 */
export function slidingCorrelation(
  a: EnvelopeFrame,
  b: EnvelopeFrame,
  curtainA: readonly (CurtainLine | null)[],
  curtainB: readonly (CurtainLine | null)[],
  depthMm: number,
): { subPleural: number; wall: number; lines: number } {
  const dr = depthMm / a.samples;
  const sub: [number[], number[]] = [[], []];
  const wall: [number[], number[]] = [[], []];
  let lines = 0;
  for (let u = 0; u < a.lines; u++) {
    const ca = curtainA[u];
    const cb = curtainB[u];
    if (!ca || !cb || ca.fAir < CURTAIN_FULL_AIR || cb.fAir < CURTAIN_FULL_AIR) continue;
    lines++;
    for (let v = 0; v < a.samples; v++) {
      const r = (v + 0.5) * dr;
      const i = v * a.lines + u;
      if (r >= ca.D + 2 && r <= ca.D + 6) {
        sub[0].push(a.data[i]);
        sub[1].push(b.data[i]);
      } else if (r >= ca.D - 6 && r <= ca.D - 2) {
        wall[0].push(a.data[i]);
        wall[1].push(b.data[i]);
      }
    }
  }
  const pearsonOf = (x: number[], y: number[]): number => (x.length > 8 ? pearson(Float64Array.from(x), Float64Array.from(y)) : Number.NaN);
  return { subPleural: pearsonOf(sub[0], sub[1]), wall: pearsonOf(wall[0], wall[1]), lines };
}
