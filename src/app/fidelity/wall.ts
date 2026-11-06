import { Tissue } from '../../anatomy/tissues';
import { Interface, isWallLayerInterface } from '../../anatomy/interfaces';
import { WALL } from '../../anatomy/organs/wall';
import { torsoDepth, torsoNormal } from '../../anatomy/primitives';
import { warpAt, warpNormal } from '../../anatomy/compression';
import { dot, normalize, type Vec3 } from '../../core/vec3';
import { lineDirection, pointOnLine } from '../../probe/probe';
import { fatSeptum, muscleStriation, wallOrientation } from '../../ultrasound/wallTexture';
import type { Simulator } from '../simulator';
import { medianOf } from './statistics';

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
/**
 * Alcance (mm) de la búsqueda de la cara de la pared de una línea del perfil en cada línea del haz (decisión 88): el
 * relieve de las capas la mueve ±1–2 mm respecto a la profundidad de la mediana. Se toma la cara más cercana: donde dos
 * caras vecinas se acercan (los planos, a ≥ 1,1 mm; la transversalis y el peritoneo, a ~1,8) puede ser la de al lado,
 * que también es una línea de la pared.
 */
export const WALL_FACE_SEARCH_MM = 2.5;

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

/**
 * Banco de la pared de un plano (decisión 62): `envAt` es la envolvente compensada con la atenuación nominal
 * del hígado (la de `envelopeLine`), `grayAt` el gris mostrado, `liverEnvDb` la mediana en dB de esa
 * envolvente en el hígado despejado y `liverGray` su gris mediano.
 */
/** Caras que dibuja la grasa subcutánea (la preperitoneal dibuja la transversalis y el peritoneo). */
const SUBCUTANEOUS_FACES: ReadonlySet<Interface> = new Set([Interface.SkinFat, Interface.Scarpa, Interface.DeepFascia]);

export function wallStatsOf(
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
      if (rL < 0) continue;
      // la cara de la pared más cercana en esta línea (decisión 88): el relieve de las capas la aparta ±1–2 mm de la
      // profundidad de la mediana del perfil, y la ventana de ±0,6 mm sobre esa profundidad medía el moteado de al lado
      let rF = -1;
      for (let dd = 0; dd <= WALL_FACE_SEARCH_MM && rF < 0; dd += 0.05)
        for (const r of dd === 0 ? [rL] : [rL - dd, rL + dd]) {
          const c = scene.classify(toMaterial(pointOnLine(sim.frame, tr, theta, r)), caliber);
          if (isWallLayerInterface(c.interface) && c.interfaceDistance < 0.1) {
            rF = r;
            break;
          }
        }
      // sin hueso en la ventana del pico ni en el eco de su cortical, que dibuja el tejido blando a menos de
      // `ribFacePriorityMm` de la costilla (decisión 62): con la pared comprimida (decisión 63) la capa hallada a
      // ~1 mm sobre una costilla era su cortical, +26 dB, y se contaba como línea de la pared saturada
      if (rF < 0 || (boneAtLine[u] >= 0 && boneAtLine[u] < rF + 0.6 + WALL.ribFacePriorityMm)) continue;
      let pk = -Infinity;
      let gy = 0;
      for (let r = rF - 0.6; r <= rF + 0.6; r += 0.05) {
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
