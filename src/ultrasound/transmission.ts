import { TISSUES, Tissue, attenuationDbPerCm } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import { IFACE_REACH_MM } from './interfaceEcho';
import { CURTAIN_CONTIGUOUS_SEGMENTS, CURTAIN_GAS_KIND, CURTAIN_RECORD_MM } from './pleura';
import { glslFloat } from './receiver';

/**
 * Regla de atenuación ida y vuelta a lo largo de un rayo, la MISMA que aplica la
 * pasada A en GLSL (`FRAG_TRANSMISSION`): el gel previo a la piel no atenúa; el gas
 * atenúa 60 dB/cm y no suma absorción; el hueso cobra 6 dB una sola vez al entrar
 * (reflexión en la interfaz) más su absorción por paso; el resto, 2·α(f)·paso.
 * La usan la puerta PW (transmisión hasta la muestra) y sus pruebas; el shader la
 * reproduce. Única diferencia deliberada: la pasada A refleja el rayo en el primer
 * pulmón del tórax (espejo diafragmático, en el cruce exacto: `mirrorCrossing`) y sigue; la puerta
 * PW no sigue rayos reflejados. El pulmón de la cortina (decisión 61) no refleja: el rayo sigue recto
 * y paga su gas, como aquí.
 */
export const BONE_ENTRY_DB = 6;
export const GAS_DB_PER_CM = 60;
/** Pérdida del espejo diafragmático (dB ida y vuelta): la del segmento del espejo en A1. */
export const MIRROR_DB = 0.5;

export function rayAttenuationDb(tissues: Iterable<Tissue>, stepMm: number, fMHz: number): number {
  let db = 0;
  let entered = false;
  let boneEntered = false;
  for (const t of tissues) {
    if (t === Tissue.Air && !entered) continue; // gel de acoplamiento
    entered = true;
    const props = TISSUES[t];
    if (props.gas) {
      db += GAS_DB_PER_CM * (stepMm / 10);
      continue;
    }
    if (props.bone && !boneEntered) {
      db += BONE_ENTRY_DB;
      boneEntered = true;
    }
    db += 2 * attenuationDbPerCm(t, fMHz) * (stepMm / 10);
  }
  return db;
}

/**
 * Pasos de la bisección con que la pasada A (A0) coloca el espejo diafragmático en el cruce exacto con
 * el pulmón (decisión 57): del paso grueso (profundidad/160, 1,125 mm a 18 cm) a 0,018 mm; el punto
 * medio queda a ≤ 0,009 mm de la pleura.
 */
export const MIRROR_BISECTION_STEPS = 6;

/**
 * Gemelo de A0 (`FRAG_TRANS_HITS`): profundidad del espejo sobre la línea recta. `rLung` es el centro del
 * primer segmento grueso cuyo punto medio es pulmón y `step` el paso grueso; la bisección busca el cruce
 * entre la muestra gruesa anterior (que no lo es) y esa, y devuelve el punto medio del último intervalo.
 */
export function mirrorCrossing(isLung: (r: number) => boolean, rLung: number, step: number, steps = MIRROR_BISECTION_STEPS): number {
  let lo = Math.max(rLung - step, 0);
  let hi = rLung;
  for (let i = 0; i < steps; i++) {
    const mid = 0.5 * (lo + hi);
    if (isLung(mid)) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Lo que A0 consulta en un punto del camino (gemelo de `classify` en el punto MATERIAL; la deformación
 * respiratoria va aparte, en el llamador).
 */
export interface HitsLineQuery {
  /** Tejido de `classify`, la normal de la interfaz y si es pulmón que toca la pared en el receso (`inLungRecess`). */
  at: (p: Vec3) => { tissue: Tissue; normal: Vec3; curtain: boolean };
  /** Tejido de `classify` sin la cortina (`classify(m, caliber, false)`): lo que hay detrás de la lámina. */
  behind: (p: Vec3) => Tissue;
  /** Profundidad bajo la cara interna de la pared (`insideWallMm`). */
  insideWall: (p: Vec3) => number;
  /** Distancia al borde del pulmón que toca la pared en la huella del receso (`lungCurtainEdgeMm`), null fuera. */
  curtainEdge: (p: Vec3) => number | null;
}

/** Salidas de A0 de una línea: h0, h1 y h2 (la pleura parietal, decisión 61). */
export interface HitsLine {
  mirrorSeg: number;
  gasSeg: number;
  boneSeg: number;
  gasKind: number;
  /** Profundidad del espejo en el cruce exacto (mm; 0 sin espejo, como h1.w) y dirección reflejada. */
  mirrorR: number;
  dir: Vec3;
  /**
   * Pleura parietal: cruce exacto D (mm), distancia al borde dz, pérdida de la cortina ΔL (dB), tipo 3 y el
   * último segmento del pulmón de la cortina (−1 si el rayo central no da en él; con el pulmón del tórax pegado
   * a la lámina: aire con aire, sin pleura entre los dos); null sin ella. En h2.w van juntos: tipo + 4·(último + 1).
   */
  pleura: { D: number; dz: number; dL: number; kind: number; curtainLast: number } | null;
}

/**
 * La pleura parietal de A0 (decisión 61) sobre una línea recta: el primer cruce de la cara interna de la
 * pared (`insideWall` pasa de < 0 a ≥ 0 entre dos muestras gruesas), llevado al punto exacto con la bisección
 * del espejo, y su distancia al borde de la cortina si cae en la huella del receso a menos de
 * `CURTAIN_RECORD_MM` del borde; null si no. No necesita la clasificación: el cruce va siempre antes que
 * cualquier espejo (la cúpula está bajo la pared). La usa `transmissionHitsLine` y el banco.
 */
export function pleuraCrossingLine(
  insideWall: (p: Vec3) => number,
  curtainEdge: (p: Vec3) => number | null,
  origin: Vec3,
  dir: Vec3,
  depthMm: number,
  coarseN: number,
): { D: number; dz: number } | null {
  const step = depthMm / coarseN;
  const at = (r: number): Vec3 => [origin[0] + dir[0] * r, origin[1] + dir[1] * r, origin[2] + dir[2] * r];
  let prev = -1;
  for (let s = 0; s < coarseN; s++) {
    const r = (s + 0.5) * step;
    const inside = insideWall(at(r));
    if (inside >= 0 && prev < 0) {
      let lo = Math.max(r - step, 0);
      let hi = r;
      for (let it = 0; it < MIRROR_BISECTION_STEPS; it++) {
        const mid = 0.5 * (lo + hi);
        if (insideWall(at(mid)) >= 0) hi = mid;
        else lo = mid;
      }
      const D = 0.5 * (lo + hi);
      const dz = curtainEdge(at(D));
      return dz !== null && dz > -CURTAIN_RECORD_MM ? { D, dz } : null;
    }
    prev = inside;
  }
  return null;
}

/**
 * Gemelo de A0 (`FRAG_TRANS_HITS`) sobre una línea: la marcha de paso `depth/coarseN` con el espejo del
 * primer pulmón del tórax (bisección `mirrorCrossing` y reflexión en su normal), el primer gas y el primer
 * hueso, y la pleura parietal (decisión 61): el primer cruce de la cara interna de la pared en el camino
 * recto, llevado al punto exacto con la misma bisección, registrado si cae en la huella del receso a menos de
 * `CURTAIN_RECORD_MM` del borde, y ΔL = Σ(gas − tejido de detrás) sobre los segmentos de pulmón de la
 * cortina, con las reglas de A1 (`dbOf`). El pulmón de la cortina no es espejo ni impacto de gas, y el del
 * tórax que sigue pegado a la lámina tampoco (aire con aire: no hay pleura del diafragma entre los dos; si
 * no, el rayo se reflejaba dentro del pulmón a 3 mm de la pared).
 */
export function transmissionHitsLine(
  q: HitsLineQuery,
  origin: Vec3,
  dir0: Vec3,
  depthMm: number,
  coarseN: number,
  dbOf: (t: Tissue, stepMm: number) => number,
): HitsLine {
  const step = depthMm / coarseN;
  const at = (p0: Vec3, d: Vec3, r: number): Vec3 => [p0[0] + d[0] * r, p0[1] + d[1] * r, p0[2] + d[2] * r];
  let dir: Vec3 = dir0;
  let hitPoint: Vec3 = origin;
  let hitR = 0;
  let mirrorSeg = -1;
  let gasSeg = -1;
  let boneSeg = -1;
  let gasKind = 0;
  // la pleura parietal: su cruce va antes que cualquier espejo (misma marcha que la de A0)
  const crossing = pleuraCrossingLine(q.insideWall, q.curtainEdge, origin, dir0, depthMm, coarseN);
  const pleura: HitsLine['pleura'] = crossing ? { ...crossing, dL: 0, kind: CURTAIN_GAS_KIND, curtainLast: -1 } : null;
  let curtainDb = 0;
  let curtainLast = -1;
  let curtainRun = false;
  let entered = false;
  for (let s = 0; s < coarseN; s++) {
    const r = (s + 0.5) * step;
    const p = mirrorSeg >= 0 ? at(hitPoint, dir, r - hitR) : at(origin, dir0, r);
    const c = q.at(p);
    if (c.tissue === Tissue.Air && !entered) continue;
    entered = true;
    const props = TISSUES[c.tissue];
    // solo con la pleura registrada y pegado a ella (su primer segmento a ≤ CURTAIN_CONTIGUOUS_SEGMENTS de D): si el
    // cruce cae fuera de la huella, o el pulmón del receso está lejos de él (una línea que roza el borde), el pulmón
    // es el espejo de siempre
    curtainRun =
      c.tissue === Tissue.Lung &&
      mirrorSeg < 0 &&
      (curtainRun || (pleura !== null && s * step <= pleura.D + CURTAIN_CONTIGUOUS_SEGMENTS * step && c.curtain));
    if (props.gas) {
      if (curtainRun) {
        curtainDb += dbOf(c.tissue, step) - dbOf(q.behind(p), step);
        curtainLast = s;
        continue;
      }
      if (c.tissue === Tissue.Lung && mirrorSeg < 0) {
        let nn = c.normal;
        const mr = mirrorCrossing(
          (x) => {
            const cm = q.at(at(origin, dir, x));
            if (cm.tissue === Tissue.Lung) nn = cm.normal;
            return cm.tissue === Tissue.Lung;
          },
          r,
          step,
        );
        mirrorSeg = s;
        hitR = mr;
        hitPoint = at(origin, dir, hitR);
        if (nn[0] * dir[0] + nn[1] * dir[1] + nn[2] * dir[2] > 0) nn = [-nn[0], -nn[1], -nn[2]];
        const dd = dir[0] * nn[0] + dir[1] * nn[1] + dir[2] * nn[2];
        dir = [dir[0] - 2 * dd * nn[0], dir[1] - 2 * dd * nn[1], dir[2] - 2 * dd * nn[2]];
        if (gasSeg < 0) {
          gasSeg = s;
          gasKind = 1;
        }
        continue;
      }
      if (gasSeg < 0) {
        gasSeg = s;
        gasKind = 2;
      }
      continue;
    }
    if (props.bone && boneSeg < 0) boneSeg = s;
  }
  if (pleura) {
    pleura.dL = curtainDb;
    pleura.curtainLast = curtainLast;
  }
  return { mirrorSeg, gasSeg, boneSeg, gasKind, mirrorR: hitR, dir, pleura };
}

/** Pérdida ida y vuelta (dB) de un segmento con las reglas de A1 (gas 60 dB/cm; el resto 2·α(f)·paso). */
export function segmentDb(t: Tissue, stepMm: number, fMHz: number): number {
  return TISSUES[t].gas ? GAS_DB_PER_CM * (stepMm / 10) : 2 * attenuationDbPerCm(t, fMHz) * (stepMm / 10);
}

/**
 * Refracción en las luces líquidas (decisión 86): camino de más por mm de luz, c_ref/c − 1, frente al tejido blando
 * que las rodea (el hígado y las paredes de los vasos y de la vesícula, todos con la c del hígado). Solo la sangre y la
 * bilis (la vesícula y los conductos); la grasa, el músculo y la orina del seno renal, rodeada de grasa de su misma c,
 * no refractan en el modelo (`lumen-refraction-only`). Positivo: la luz es más lenta (lente convergente).
 */
export function lumenExcessPerMm(t: Tissue): number {
  return t === Tissue.Blood || t === Tissue.Fluid ? TISSUES[Tissue.Liver].c / TISSUES[t].c - 1 : 0;
}

/**
 * GLSL de A1 (decisión 86): la expresión de `lumenExcessPerMm` para el tejido `t` (una variable int de GLSL), con sus
 * constantes interpoladas. Necesita los `#define` de los tejidos (`ANATOMY_GLSL`).
 */
export const lumenExcessGlsl = (t: string): string =>
  `(${t} == T_BLOOD ? ${glslFloat(lumenExcessPerMm(Tissue.Blood))} : ${t} == T_FLUID ? ${glslFloat(lumenExcessPerMm(Tissue.Fluid))} : 0.0)`;
/** Transmisión de amplitud ida y vuelta (0–1) correspondiente a `rayAttenuationDb`. */
export function rayTransmission(tissues: Iterable<Tissue>, stepMm: number, fMHz: number): number {
  return Math.pow(10, -rayAttenuationDb(tissues, stepMm, fMHz) / 20);
}

// ——— Gemelos de A2 sobre la rejilla de segmentos (decisión 54) y su versión dirigida (decisión 58) ———

/**
 * Salidas de A0 y A1 en TS, la rejilla sobre la que suman A2 y su gemelo dirigido. Índice de segmento
 * `línea·rows + fila`; las filas son las de la pasada A (profundidad/COARSE_DEPTH): la fila s cubre
 * [s, s + 1)·step y su centro está en (s + ½)·step. Tras el espejo de una línea, sus segmentos siguen el
 * camino reflejado (A1), no la línea radial.
 */
export interface SegmentGrid {
  lines: number;
  rows: number;
  stepMm: number;
  /** A1 |.x|: dB ida y vuelta del segmento (MIRROR_DB en el del espejo). */
  db: Float64Array;
  /** A1 .x < 0: aire (el gel previo a la piel no cuenta). Hasta la decisión 86, en .y. */
  air: Uint8Array;
  /** A1 .y (decisión 86): camino de más del segmento en una luz líquida, paso·`lumenExcessPerMm` (mm). */
  excess: Float64Array;
  /** A1 .z: hueso. */
  bone: Uint8Array;
  /**
   * A1 .w (decisión 58): gas del segmento, 0 ninguno, 1 pulmón del tórax, 2 intestinal o aire tras la piel,
   * 3 pulmón de la cortina (decisión 61, `CURTAIN_GAS_KIND`), que no es un impacto de gas.
   */
  gas: Uint8Array;
  /** A0 h0.x: segmento del espejo (primer pulmón) de cada línea, −1 sin espejo. */
  mirrorSeg: Int32Array;
  /** A0 h1.w: profundidad del espejo en el cruce exacto (mm, `mirrorCrossing`). */
  mirrorR: Float64Array;
  /**
   * A0 h0.y/h0.z: segmento del primer gas y del primer hueso de cada línea (−1 sin ellos), los que busca la penumbra de
   * la mirada 0. Solo en la rejilla leída de la GPU (`readSegments`); sin ellos, los gemelos los derivan de A1 (`lineHits`).
   */
  hitGasSeg?: Int32Array;
  hitBoneSeg?: Int32Array;
}

/**
 * `steeredPrefixDb` en GLSL para A2 (etapa 2 de la decisión 58). Necesita uSeg (A1: dB en .x, negativo en el
 * aire; camino de más en .y; gas en .w), uHits0 (espejo en .x), uHits1 (su r exacta en .w), uCoarseN, uDepth,
 * uCurvR, uHalfSector, uLinesF, uSteer (θ, R·sin θ, R·cos θ, k2) y `STEERING_GLSL`. Devuelve (dB, sGas, sBone,
 * sMirror) y, aparte, (tipo de gas, línea del espejo, Ψ̃ del camino y su pendiente: decisión 86).
 */
export const STEERED_PREFIX_GLSL = /* glsl */ `
vec4 steeredPrefix(int line, int k, out vec4 extra) {
  float step = uDepth / uCoarseN;
  float dPhi = 2.0 * uHalfSector / uLinesF;
  float a = uSteer.y;
  float rc = uSteer.z;
  float betaK = asin(a / (uCurvR + (float(k) + 0.5) * step));
  int nLines = int(uLinesF);
  int ahead = int(ceil(${IFACE_REACH_MM.toFixed(4)} / step + 0.5));
  float db = 0.0;
  bool entered = false;
  bool boneEntered = false;
  float sGas = -1.0, sBone = -1.0, sMirror = -1.0, gasKind = 0.0, psi = 0.0, pa = 0.0;
  int frozen = -1;
  for (int s = 0; s < 512; s++) {
    if (s > k + ahead) break;
    int l;
    int seg = s;
    float scale = 1.0;
    bool crossing = false;
    if (frozen >= 0) l = frozen;
    else {
      float rho = uCurvR + (float(s) + 0.5) * step;
      l = clamp(int(floor(float(line) + (betaK - asin(a / rho)) / dPhi + 0.5)), 0, nLines - 1);
      float m = texelFetch(uHits0, ivec2(l, 0), 0).x;
      if (m >= 0.0 && float(s) >= m) {
        float mr = texelFetch(uHits1, ivec2(l, 0), 0).w;
        if (s > k && !(mr < float(k + 1) * step + ${IFACE_REACH_MM.toFixed(4)})) break;
        frozen = l;
        seg = int(m);
        crossing = true;
        sMirror = alongLineMm(uCurvR + mr, a, rc);
      } else scale = rho / sqrt(rho * rho - a * a);
    }
    if (s > k) {
      if (frozen >= 0) break;
      continue;
    }
    vec4 g = texelFetch(uSeg, ivec2(l, seg), 0);
    if (g.x < 0.0 && !entered) continue;
    entered = true;
    if (g.z > 0.5 && !boneEntered) { db += ${glslFloat(BONE_ENTRY_DB)}; boneEntered = true; }
    float rS = (float(s) + 0.5) * step;
    float sRow = alongLineMm(uCurvR + rS, a, rc);
    if (g.z > 0.5 && sBone < 0.0) sBone = sRow;
    // el pulmón de la cortina (marca ${CURTAIN_GAS_KIND}, decisión 61) no es un impacto de gas
    if (g.w > 0.5 && g.w < ${glslFloat(CURTAIN_GAS_KIND - 0.5)} && sGas < 0.0) { sGas = crossing ? sMirror : sRow; gasKind = g.w; }
    db += abs(g.x) * scale;
    float e = g.y * scale / (uCurvR + rS);
    psi += e * float(k - s);
    if (s < k) pa += e;
  }
  extra = vec4(sGas >= 0.0 ? gasKind : 0.0, sMirror >= 0.0 ? float(frozen) : -1.0, step * psi, pa);
  return vec4(db, sGas, sBone, sMirror);
}
`;
