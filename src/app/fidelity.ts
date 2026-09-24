import { TISSUES, Tissue, attenuationDbPerCm } from '../anatomy/tissues';
import type { FaceGeometry } from '../anatomy/scene';
import { dot, type Vec3 } from '../core/vec3';
import { VESSEL_META } from '../physiology/vessels';
import { lineCoupling, lineDirection, pointOnLine } from '../probe/probe';
import { lateralFwhmMm } from '../ultrasound/beamModel';
import { levelOfGrey } from '../ultrasound/greyMap';
import { COARSE_DEPTH, nominalTgcDbPerCm, type DisplayFrame } from '../ultrasound/renderer';
import { beamToPixel, pixelToBeam } from '../ultrasound/sectorGeometry';
import { mirrorCrossing } from '../ultrasound/transmission';
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

/** Tramos de incidencia (°): una pared especular brilla a 0–20° y se apaga hacia 60°. */
export const WALL_INCIDENCE_BINS_DEG = [0, 20, 40, 60] as const;

/** Sistemas venosos con banco de pared propio. */
export type WallSystem = 'ivc' | 'hepaticVein' | 'portal';
export const WALL_SYSTEMS: readonly WallSystem[] = ['ivc', 'hepaticVein', 'portal'];
/** Paredes de la tabla histórica del banco (decisión 52): VCI y suprahepáticas juntas. */
export const HISTORIC_WALL_SYSTEMS: readonly WallSystem[] = ['ivc', 'hepaticVein'];
/** Caras de órgano del banco de interfaces: cápsula hepática, diafragma (con la pleura) y Morison. */
export type OrganFace = 'capsule' | 'diaphragm' | 'renalCapsule';
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
}

/** Medida de una línea en una interfaz. */
export interface FaceLineMeasure {
  ratio: number;
  deltaDb: number;
  peakDb: number;
  echoFwhmMm: number;
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
  capsule: WallBin[];
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
  const w0 = g.rb - PEAK_BEFORE_MM;
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
    diaphragm,
    renalCapsule: wallBins(['renalCapsule']),
  };
}

/** Registros mínimos de un tramo para que el banco con GPU lo evalúe (plan de la tanda 1.5, §6.3). */
export const GATED_MIN_RECORDS = 10;

/**
 * Tramos que vigila el banco con GPU de los ecos de interfaz (PR 5b): pared de VCI y de suprahepáticas a
 * 0–20° (y la VSH a 40–60°, para su caída), la porta en los tres, y cápsula, diafragma y Morison a 0–20°.
 */
export const GATED_FACE_BINS: readonly { label: string; kind: FaceKind; fromDeg: number }[] = [
  { label: 'VCI', kind: 'ivc', fromDeg: 0 },
  { label: 'VSH', kind: 'hepaticVein', fromDeg: 0 },
  { label: 'VSH', kind: 'hepaticVein', fromDeg: 40 },
  { label: 'porta', kind: 'portal', fromDeg: 0 },
  { label: 'porta', kind: 'portal', fromDeg: 20 },
  { label: 'porta', kind: 'portal', fromDeg: 40 },
  { label: 'cápsula', kind: 'capsule', fromDeg: 0 },
  { label: 'diafragma', kind: 'diaphragm', fromDeg: 0 },
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
}

export interface FidelityBand extends EnvelopeTexture {
  r0: number;
  r1: number;
  /** FWHM lateral de la PSF de dos vías a la profundidad media de la banda (`beamModel.ts`). */
  beamFwhmMm: number;
}

export interface FidelityStats {
  envelope: EnvelopeTexture;
  bands: FidelityBand[];
  /**
   * Imagen mostrada; `colorOn` avisa de que la caja de color estaba encendida (el gris leído es el
   * canal rojo y los píxeles con color no son modo B).
   */
  display: {
    liver: DisplayStats;
    /** Sangre a ≥ 1,5 mm de su pared (el centro de la luz): la mediana debe quedar casi negra. */
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
    /** Cápsula hepática bajo la pared (músculo o grasa → cápsula; referencia, el hígado de debajo). */
    capsule: WallBin[];
    /** Hígado → diafragma → pulmón: cara hepática, línea pleural, costura y espejo. */
    diaphragm: DiaphragmBin[];
    /** Morison: hígado → grasa perirrenal → cápsula renal. */
    renalCapsule: WallBin[];
    /** Fracción de píxeles saturados (≥ 250) a ≤ 1 mm de cada cara; NaN si no está a la vista. */
    faceSaturated: { diaphragm: number; morison: number; gallbladder: number };
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
/** Enlace de una pared entre líneas vecinas: su borde no se mueve más que esto (mm). */
const WALL_LINK_MM = 3;
/** Pasos de la bisección del cruce exacto con la pleura (0,5 mm / 2²⁰). */
const PLEURA_BISECTION_STEPS = 20;
/** Saturación de una cara: píxeles ≥ 250 a ≤ 1 mm de ella. */
const FACE_SATURATION_MM = 1;
/** Distancia mínima (mm) de la sangre a su pared para medir el centro de la luz. */
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
  for (let u = 0; u < lines; u++) {
    const theta = -tr.halfSector + dTheta * (u + 0.5);
    for (let k = 0; k < nr; k++)
      tissue[u * nr + k] = sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, theta, (k + 0.5) * GRID_STEP_MM), sim.sample).tissue;
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
 */
export function fidelityStats(
  sim: Simulator,
  env: EnvelopeFrame,
  img: DisplayFrame | null = null,
  opts: { colorOn?: boolean; transmission?: TransmissionFrame; samples?: boolean } = {},
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
  const shadowAt = new Float32Array(lines).fill(Infinity);
  const gasAt = new Float32Array(lines).fill(Infinity);
  const boneAt = new Float32Array(lines).fill(Infinity);
  const impureAt = new Float32Array(lines).fill(Infinity);
  const coupled = new Uint8Array(lines);
  for (let u = 0; u < lines; u++) {
    const theta = thetaOf(u);
    coupled[u] = lineCoupling(sim.pose, tr, theta) >= MIN_COUPLING ? 1 : 0;
    let entered = false;
    let inLiver = false;
    let excessDb = 0;
    for (let k = 0; k < nr; k++) {
      const r = (k + 0.5) * GRID_STEP_MM;
      const q = sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, theta, r), sim.sample);
      const i = u * nr + k;
      tissue[i] = q.tissue;
      if (q.tissue === Tissue.Blood && q.vessel) system[i] = 1 + (WALL_SYSTEMS as readonly string[]).indexOf(VESSEL_META[q.vessel].system);
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
  const tx = opts.transmission;
  const penumbraMin = Math.pow(10, -MAX_PENUMBRA_DB / 20);
  const outOfPenumbra = (u: number, r: number): boolean => {
    if (!tx) return true;
    const k = Math.min(tx.samples - 1, Math.max(0, Math.floor((r / depth) * tx.samples)));
    const s = tx.single[k * tx.lines + u];
    return s > 1e-6 && tx.aperture[k * tx.lines + u] >= penumbraMin * s;
  };
  const envClear = clearance(ENVELOPE_CLEARANCE_MM);
  const cellOf = (u: number, r: number): number => {
    const k = Math.floor(r / GRID_STEP_MM);
    return k < 0 || k >= nr ? -1 : u * nr + k;
  };

  const inBand = (r0: number, r1: number) => (u: number, v: number) => {
    const r = ((v + 0.5) / env.samples) * depth;
    if (r < r0 || r >= r1 || r >= clearUntil[u] || !outOfPenumbra(u, r)) return false;
    const i = cellOf(u, r);
    return i >= 0 && envClear[i] === 1;
  };
  const envelope = envelopeTexture(env, inBand(0, Infinity), geom);
  const bands = DEPTH_BANDS_MM.filter(([r0]) => r0 < depth).map(([r0, r1]) => {
    const t = envelopeTexture(env, inBand(r0, r1), geom);
    const rMid = Number.isFinite(t.depthMm) ? t.depthMm : (r0 + r1) / 2;
    return { ...t, r0, r1, beamFwhmMm: lateralFwhmMm(rMid, sim.bmode.focusMm, sim.profile.beam) };
  });
  if (!img || img.width === 0) return { envelope, bands, display: null };

  const dispClear = clearance(DISPLAY_CLEARANCE_MM);
  const layout = sim.renderer.display;
  /** Profundidad del píxel si cae en hígado despejado y puro; null si no. */
  const pureLiverDepth = (x: number, y: number): number | null => {
    const b = pixelToBeam(layout, tr, depth, x, y);
    if (!b) return null;
    const u = Math.round((b.theta + tr.halfSector) / dTheta - 0.5);
    if (u < 0 || u >= lines || b.r >= clearUntil[u] || b.r >= pureUntil[u] || !outOfPenumbra(u, b.r)) return null;
    const i = cellOf(u, b.r);
    return i >= 0 && dispClear[i] === 1 ? b.r : null;
  };
  const liver = displayStats(img, (x, y) => pureLiverDepth(x, y) !== null, 2);
  const profile = depthProfile(img, pureLiverDepth, sim.bmode.dynamicRangeDb);
  // centro de la luz: sangre a ≥ 1,5 mm de su pared, sin sombra delante
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
      return i >= 0 && lumenClear[i] === 1;
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
  const core: number[] = [];
  const coreGray: number[] = [];
  let coreLines = 0;
  for (let u = 0; u < lines; u++) {
    let all = true;
    for (let du = -3; du <= 3; du++) if (!hit(u + du)) all = false;
    if (all && perLine[u].length) {
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
  const shadow: ShadowStats = {
    coreLines,
    coreDbBelowLiver: liver.pixels && core.length ? levelDb(liver.p50) - medianOf(core) : Number.NaN,
    coreGray: medianOf(coreGray),
    edgeProfileDb: edgeAcc.map((a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : Number.NaN)),
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
        const cos = faceCosine(u, pleura ? rTarget : rCell, spec.face);
        if (cos === null) continue;
        const m = measureFaceLine(faceLine(u), { rb, rTarget, ref: spec.ref, pleura }, sim.bmode.dynamicRangeDb);
        if (!m) continue;
        faceSamples.push({
          ...m,
          kind: spec.kind,
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
    display: { liver, lumen, diaphragmSaturated, shadow, profile, ...summary, faceSaturated, colorOn: opts.colorOn ?? false },
    ...(opts.samples ? { faceSamples } : {}),
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
