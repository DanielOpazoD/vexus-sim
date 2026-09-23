import { TISSUES, Tissue, attenuationDbPerCm } from '../anatomy/tissues';
import { dot, normalize, type Vec3 } from '../core/vec3';
import { VESSEL_META, type VesselSystem } from '../physiology/vessels';
import { lineCoupling, lineDirection, pointOnLine } from '../probe/probe';
import { lateralFwhmMm } from '../ultrasound/beamModel';
import { levelOfGrey } from '../ultrasound/greyMap';
import type { DisplayFrame } from '../ultrasound/renderer';
import { beamToPixel, pixelToBeam } from '../ultrasound/sectorGeometry';
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
 *    gris del hígado y su dispersión, perfil en profundidad (dB/cm) y contraste pared/tejido de
 *    la VCI y las suprahepáticas a incidencia casi normal.
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

/** Contraste de la pared anterior en un tramo de incidencia (ángulo entre el haz y su normal). */
export interface WallBin {
  fromDeg: number;
  toDeg: number;
  /** Paredes medidas en el tramo (una por línea que entra del hígado al vaso). */
  walls: number;
  /** Mediana del cociente gris de la pared / mediana del hígado previo (sin pared, el moteado da ~1,1). */
  ratio: number;
  /** Lo mismo en nivel mostrado (dB, invirtiendo la curva de grises). */
  deltaDb: number;
}

/** Tramos de incidencia (°): una pared especular brilla a 0–20° y se apaga hacia 60°. */
export const WALL_INCIDENCE_BINS_DEG = [0, 20, 40, 60] as const;

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
  display: { liver: DisplayStats; profile: DepthProfile; walls: WallBin[]; colorOn: boolean } | null;
}

/** Bandas de profundidad (mm) en que se compara el grano lateral con la PSF. */
export const DEPTH_BANDS_MM = [
  [20, 60],
  [60, 100],
  [100, 140],
  [140, 180],
] as const;

/** Paso radial (mm) de la rejilla de clasificación en CPU. */
const GRID_STEP_MM = 0.5;
const WALL_SYSTEMS: readonly VesselSystem[] = ['ivc', 'hepaticVein'];
/** Tejidos que pueden separar el hígado de la luz en el borde de un vaso. */
const WALL_TISSUES: ReadonlySet<number> = new Set([Tissue.VesselWallThin, Tissue.VesselWallPortal]);
/** La rejilla guarda el tejido como número (Uint8Array). */
const LIVER: number = Tissue.Liver;
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
/** Paso (mm) del gradiente numérico de la distancia a la luz para la normal de la pared. */
const NORMAL_EPS_MM = 0.3;

/**
 * Métricas del plano actual sobre una rejilla de clasificación en CPU (líneas × 0,5 mm, ~1–3 s).
 * La textura se mide en hígado «despejado»: en líneas bien acopladas, antes de cualquier tejido que
 * haga sombra (gas o hueso, como la pasada A) en la línea y en sus dos vecinas, y a ≥ 6 mm de
 * cualquier tejido que no sea hígado (≥ 3 mm en la imagen mostrada; los vasos cuentan, aunque la
 * `boundaryDistance` del hígado no los incluya). El gris y el perfil en profundidad, además, solo
 * en hígado «puro»: sin más de 0,5 dB de atenuación distinta de la del hígado en el camino (el
 * refuerzo tras un vaso es física correcta, no un defecto de la TGC). Con `img`, también el
 * contraste de las paredes anteriores de VCI y suprahepáticas por tramos de incidencia sobre su
 * normal real.
 */
export function fidelityStats(
  sim: Simulator,
  env: EnvelopeFrame,
  img: DisplayFrame | null = null,
  opts: { colorOn?: boolean } = {},
): FidelityStats {
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  const geom: EnvelopeGeometry = { depthMm: depth, halfSector: tr.halfSector, curvatureRadius: tr.curvatureRadius };
  const lines = env.lines;
  const dTheta = (2 * tr.halfSector) / lines;
  const thetaOf = (u: number): number => -tr.halfSector + dTheta * (u + 0.5);
  const fB = sim.profile.bEffectiveMHz;
  const alphaLiver = attenuationDbPerCm(Tissue.Liver, fB);

  // Rejilla: tejido, sangre de VCI/suprahepática, primera sombra y primer desvío de atenuación.
  const nr = Math.floor(depth / GRID_STEP_MM);
  const tissue = new Uint8Array(lines * nr);
  const wallVessel = new Uint8Array(lines * nr);
  const shadowAt = new Float32Array(lines).fill(Infinity);
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
      wallVessel[i] = q.tissue === Tissue.Blood && q.vessel && WALL_SYSTEMS.includes(VESSEL_META[q.vessel].system) ? 1 : 0;
      // el aire antes de la piel es el gel de acoplamiento (la pasada A también lo salta)
      if (q.tissue !== Tissue.Air) entered = true;
      if (entered && r < shadowAt[u] && (TISSUES[q.tissue].gas || TISSUES[q.tissue].bone)) shadowAt[u] = r;
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
  // hígado a ≥ `mm` de cualquier celda que no sea hígado (distancia euclídea en la rejilla)
  const clearance = (mm: number): Uint8Array => {
    const ok = new Uint8Array(lines * nr);
    const K = Math.ceil(mm / GRID_STEP_MM);
    for (let u = 0; u < lines; u++)
      for (let k = 0; k < nr; k++) {
        if (tissue[u * nr + k] !== LIVER) continue;
        const spacing = (tr.curvatureRadius + (k + 0.5) * GRID_STEP_MM) * dTheta;
        const U = Math.ceil(mm / spacing);
        let clear = true;
        for (let du = -U; clear && du <= U; du++) {
          const uu = u + du;
          if (uu < 0 || uu >= lines) continue;
          for (let dk = -K; dk <= K; dk++) {
            const kk = k + dk;
            if (kk < 0 || kk >= nr || tissue[uu * nr + kk] === LIVER) continue;
            if (Math.hypot(du * spacing, dk * GRID_STEP_MM) <= mm) {
              clear = false;
              break;
            }
          }
        }
        ok[u * nr + k] = clear ? 1 : 0;
      }
    return ok;
  };
  const envClear = clearance(ENVELOPE_CLEARANCE_MM);
  const cellOf = (u: number, r: number): number => {
    const k = Math.floor(r / GRID_STEP_MM);
    return k < 0 || k >= nr ? -1 : u * nr + k;
  };

  const inBand = (r0: number, r1: number) => (u: number, v: number) => {
    const r = ((v + 0.5) / env.samples) * depth;
    if (r < r0 || r >= r1 || r >= clearUntil[u]) return false;
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
    if (u < 0 || u >= lines || b.r >= clearUntil[u] || b.r >= pureUntil[u]) return null;
    const i = cellOf(u, b.r);
    return i >= 0 && dispClear[i] === 1 ? b.r : null;
  };
  const liver = displayStats(img, (x, y) => pureLiverDepth(x, y) !== null, 2);
  const profile = depthProfile(img, pureLiverDepth, sim.bmode.dynamicRangeDb);

  // Paredes anteriores: paso de ≥ 3 mm de hígado a la sangre de una VCI o suprahepática (con, a lo
  // sumo, la pared del vaso en medio). La normal de la pared es el gradiente de la distancia a la
  // luz (`vesselHit.d`) justo dentro de ella; la incidencia decide el tramo. Pico de gris en
  // [−1,5; +1] mm del borde frente a la mediana del hígado en [−10; −3] mm, sobre la misma línea.
  const grayAt = (u: number, r: number): number => {
    const p = beamToPixel(layout, tr, thetaOf(u), r);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return Number.NaN;
    return img.gray[y * img.width + x];
  };
  const lumenDistance = (p: Vec3): number | null => sim.anatomy.classifyWorld(p, sim.sample).vesselHit?.d ?? null;
  const wallCosine = (u: number, rInside: number): number | null => {
    const p = pointOnLine(sim.frame, tr, thetaOf(u), rInside);
    const g: Vec3 = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const plus: Vec3 = [p[0], p[1], p[2]];
      const minus: Vec3 = [p[0], p[1], p[2]];
      plus[a] += NORMAL_EPS_MM;
      minus[a] -= NORMAL_EPS_MM;
      const dp = lumenDistance(plus);
      const dm = lumenDistance(minus);
      if (dp === null || dm === null) return null;
      g[a] = dp - dm;
    }
    return Math.abs(dot(normalize(g), lineDirection(sim.frame, thetaOf(u))));
  };
  const nBins = WALL_INCIDENCE_BINS_DEG.length - 1;
  const ratios: number[][] = Array.from({ length: nBins }, () => []);
  const deltas: number[][] = Array.from({ length: nBins }, () => []);
  for (let u = 0; u < lines; u++) {
    let liverRun = 0;
    for (let k = 0; k < nr - 4; k++) {
      const i = u * nr + k;
      if (tissue[i] === LIVER) {
        liverRun++;
        continue;
      }
      const run = liverRun;
      liverRun = 0;
      if (run < 6 || k * GRID_STEP_MM >= clearUntil[u]) continue;
      let hit = -1;
      for (let j = 0; j < 4 && hit < 0; j++) if (wallVessel[i + j]) hit = j;
      for (let j = 0; j < hit; j++) if (!WALL_TISSUES.has(tissue[i + j])) hit = -1;
      if (hit < 0) continue;
      const cos = wallCosine(u, (k + hit + 0.5) * GRID_STEP_MM);
      if (cos === null) continue;
      const incidenceDeg = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
      let bin = -1;
      for (let j = 0; j < nBins; j++)
        if (incidenceDeg >= WALL_INCIDENCE_BINS_DEG[j] && incidenceDeg < WALL_INCIDENCE_BINS_DEG[j + 1]) bin = j;
      if (bin < 0) continue;
      const rb = k * GRID_STEP_MM;
      let peak = 0;
      for (let r = rb - 1.5; r <= rb + 1.0; r += 0.1) peak = Math.max(peak, grayAt(u, r) || 0);
      const ref: number[] = [];
      for (let r = rb - 10; r <= rb - 3; r += 0.25) {
        const g = grayAt(u, r);
        const kk = Math.floor(r / GRID_STEP_MM);
        if (Number.isFinite(g) && kk >= 0 && tissue[u * nr + kk] === LIVER) ref.push(g);
      }
      if (ref.length < 8) continue;
      ref.sort((a, b) => a - b);
      const med = ref[ref.length >> 1];
      if (med <= 0) continue;
      ratios[bin].push(peak / med);
      deltas[bin].push((levelOfGrey(peak / 255) - levelOfGrey(med / 255)) * sim.bmode.dynamicRangeDb);
    }
  }
  const median = (a: number[]): number => {
    if (!a.length) return Number.NaN;
    const s = [...a].sort((x, y) => x - y);
    return s[s.length >> 1];
  };
  const walls = ratios.map((r, j) => ({
    fromDeg: WALL_INCIDENCE_BINS_DEG[j],
    toDeg: WALL_INCIDENCE_BINS_DEG[j + 1],
    walls: r.length,
    ratio: median(r),
    deltaDb: median(deltas[j]),
  }));
  return { envelope, bands, display: { liver, profile, walls, colorOn: opts.colorOn ?? false } };
}
