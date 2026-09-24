import { TISSUES, Tissue, attenuationDbPerCm } from '../anatomy/tissues';
import { IFACE_REACH_MM } from './interfaceEcho';
import { glslFloat } from './receiver';
import { alongLineMm, steerBeta, steeredElement } from './steering';

/**
 * Regla de atenuación ida y vuelta a lo largo de un rayo, la MISMA que aplica la
 * pasada A en GLSL (`FRAG_TRANSMISSION`): el gel previo a la piel no atenúa; el gas
 * atenúa 60 dB/cm y no suma absorción; el hueso cobra 6 dB una sola vez al entrar
 * (reflexión en la interfaz) más su absorción por paso; el resto, 2·α(f)·paso.
 * La usan la puerta PW (transmisión hasta la muestra) y sus pruebas; el shader la
 * reproduce. Única diferencia deliberada: la pasada A refleja el rayo en el primer
 * pulmón (espejo diafragmático, en el cruce exacto: `mirrorCrossing`) y sigue; la puerta
 * PW no sigue rayos reflejados.
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
  /** A1 .x: dB ida y vuelta del segmento (MIRROR_DB en el del espejo). */
  db: Float64Array;
  /** A1 .y: aire (el gel previo a la piel no cuenta). */
  air: Uint8Array;
  /** A1 .z: hueso. */
  bone: Uint8Array;
  /** A1 .w (decisión 58): gas del segmento, 0 ninguno, 1 pulmón, 2 intestinal o aire tras la piel. */
  gas: Uint8Array;
  /** A0 h0.x: segmento del espejo (primer pulmón) de cada línea, −1 sin espejo. */
  mirrorSeg: Int32Array;
  /** A0 h1.w: profundidad del espejo en el cruce exacto (mm, `mirrorCrossing`). */
  mirrorR: Float64Array;
}

/** Impactos de A0 de una línea, derivados de las marcas de A1 con la misma regla (gel previo omitido). */
export function lineHits(g: SegmentGrid, line: number): { mirrorSeg: number; gasSeg: number; boneSeg: number; gasKind: number } {
  let entered = false;
  let gasSeg = -1;
  let boneSeg = -1;
  let gasKind = 0;
  for (let s = 0; s < g.rows; s++) {
    const i = line * g.rows + s;
    if (g.air[i] && !entered) continue;
    entered = true;
    if (g.gas[i] && gasSeg < 0) {
      gasSeg = s;
      gasKind = g.gas[i];
    }
    if (g.bone[i] && boneSeg < 0) boneSeg = s;
  }
  return { mirrorSeg: g.mirrorSeg[line], gasSeg, boneSeg, gasKind };
}

/** Prefijo de A2 en la fila k: dB ida y vuelta y primeros impactos (mm; −1 sin ellos). */
export interface PrefixSample {
  db: number;
  gasHit: number;
  boneHit: number;
  mirrorHit: number;
  gasKind: number;
}

/**
 * Gemelo de A2 (`FRAG_TRANS_PREFIX`) de la mirada 0: suma de los segmentos de la línea hasta la fila k
 * inclusive, con las reglas de `rayAttenuationDb` (gel previo sin pérdidas, hueso 6 dB al entrar una vez);
 * el espejo se publica desde la fila cuyo final más el alcance del eco pleural pasa su cruce exacto.
 */
export function prefixDb(g: SegmentGrid, line: number, k: number): PrefixSample {
  let db = 0;
  let entered = false;
  let boneEntered = false;
  for (let s = 0; s <= k; s++) {
    const i = line * g.rows + s;
    if (g.air[i] && !entered) continue;
    entered = true;
    if (g.bone[i] && !boneEntered) {
      db += BONE_ENTRY_DB;
      boneEntered = true;
    }
    db += g.db[i];
  }
  const h = lineHits(g, line);
  const mr = g.mirrorR[line];
  const mirrorHit = h.mirrorSeg >= 0 && mr < (k + 1) * g.stepMm + IFACE_REACH_MM ? mr : -1;
  const gasHit = h.gasSeg >= 0 && h.gasSeg <= k ? (h.gasSeg === h.mirrorSeg ? mr : (h.gasSeg + 0.5) * g.stepMm) : -1;
  const boneHit = h.boneSeg >= 0 && h.boneSeg <= k ? (h.boneSeg + 0.5) * g.stepMm : -1;
  return { db, gasHit, boneHit, mirrorHit, gasKind: gasHit >= 0 ? h.gasKind : 0 };
}

/** Prefijo dirigido de A2 (decisión 58): lo mismo a lo largo del camino dirigido, en distancias del camino. */
export interface SteeredPrefix {
  /** dB ida y vuelta a lo largo del camino dirigido que llega a (línea, fila k). */
  db: number;
  /** Distancias a lo largo del camino (mm) del primer gas, del primer hueso y del espejo; −1 sin ellos. */
  sGas: number;
  sBone: number;
  sMirror: number;
  gasKind: number;
  /** Línea cuyo espejo cruza el camino (la que da la dirección reflejada); −1 sin espejo. */
  mirrorLine: number;
  /** Elemento del que sale el camino (rad): su cobertura (`lookCoverage`) decide si la mirada se forma. */
  element: number;
}

/** Filas que A2 mira más allá de la k para publicar un espejo al alcance del eco pleural. */
export function mirrorLookaheadRows(stepMm: number): number {
  return Math.ceil(IFACE_REACH_MM / stepMm + 0.5);
}

/**
 * Gemelo de A2 dirigido (decisión 58) sobre la rejilla de segmentos de la mirada 0, sin clasificación
 * nueva: el camino de la mirada θ que llega a (línea j, fila k) cruza la fila s cerca de la línea
 * j + (β(ρ_k) − β(ρ_s))/dφ, y de ella toma el segmento (la línea más cercana). Cada segmento radial se
 * multiplica por ds/dρ = ρ/√(ρ² − a²) (≤ 1,007: el camino cruza la corona en oblicuo). Mismas reglas que
 * A2: gel previo sin pérdidas, hueso 6 dB al entrar una vez, MIRROR_DB en el espejo. Primer gas y primer
 * hueso, de las marcas de A1 a lo largo del camino.
 *
 * Espejo: al llegar a una fila igual o posterior al segmento del espejo de la línea atravesada, el camino
 * se congela en esa línea y sigue su camino reflejado (sus segmentos de A1, sin ds/dρ): el espejo no se
 * dirige tras la reflexión (aproximación declarada). Su distancia es la del cruce exacto de esa línea,
 * s(R + r_espejo), y se publica, como en A2, desde la fila cuyo final más el alcance del eco pleural lo
 * pasa (mirando `mirrorLookaheadRows` filas más allá de k).
 *
 * Las líneas fuera del arreglo se recortan (como `texelFetch` con clamp): solo pasa en caminos cuya
 * cobertura es parcial o nula. Con θ = 0 da exactamente `prefixDb`.
 */
export function steeredPrefixDb(
  g: SegmentGrid,
  geom: { curvatureRadius: number; halfSector: number },
  theta: number,
  line: number,
  k: number,
): SteeredPrefix {
  const R = geom.curvatureRadius;
  const step = g.stepMm;
  const dPhi = (2 * geom.halfSector) / g.lines;
  const alpha = -geom.halfSector + (line + 0.5) * dPhi;
  const rhoK = R + (k + 0.5) * step;
  const betaK = steerBeta(rhoK, theta, R);
  const along = (r: number): number => (theta === 0 ? r : alongLineMm(R + r, theta, R));
  const a = R * Math.sin(theta);
  const ahead = mirrorLookaheadRows(step);
  let db = 0;
  let entered = false;
  let boneEntered = false;
  let sGas = -1;
  let sBone = -1;
  let sMirror = -1;
  let gasKind = 0;
  let frozen = -1;
  for (let s = 0; s <= k + ahead; s++) {
    let l: number;
    let seg = s;
    let scale = 1;
    let crossing = false;
    if (frozen >= 0) l = frozen;
    else {
      const rho = R + (s + 0.5) * step;
      l = theta === 0 ? line : Math.min(g.lines - 1, Math.max(0, Math.floor(line + (betaK - steerBeta(rho, theta, R)) / dPhi + 0.5)));
      const m = g.mirrorSeg[l];
      if (m >= 0 && s >= m) {
        // más allá de k, solo si el cruce queda al alcance del eco pleural desde el final de la fila k
        if (s > k && !(g.mirrorR[l] < (k + 1) * step + IFACE_REACH_MM)) break;
        frozen = l;
        seg = m;
        crossing = true;
        sMirror = along(g.mirrorR[l]);
      } else if (theta !== 0) scale = rho / Math.sqrt(rho * rho - a * a);
    }
    if (s > k) {
      if (frozen >= 0) break;
      continue;
    }
    const i = l * g.rows + seg;
    if (g.air[i] && !entered) continue;
    entered = true;
    if (g.bone[i] && !boneEntered) {
      db += BONE_ENTRY_DB;
      boneEntered = true;
    }
    if (g.bone[i] && sBone < 0) sBone = along((s + 0.5) * step);
    if (g.gas[i] && sGas < 0) {
      sGas = crossing ? sMirror : along((s + 0.5) * step);
      gasKind = g.gas[i];
    }
    db += g.db[i] * scale;
  }
  return {
    db,
    sGas,
    sBone,
    sMirror,
    gasKind: sGas >= 0 ? gasKind : 0,
    mirrorLine: sMirror >= 0 ? frozen : -1,
    element: steeredElement(alpha, rhoK, theta, R),
  };
}

/**
 * `steeredPrefixDb` en GLSL para A2 (etapa 2 de la decisión 58). Necesita uSeg (A1 con el gas en .w),
 * uHits0 (espejo en .x), uHits1 (su r exacta en .w), uCoarseN, uDepth, uCurvR, uHalfSector, uLinesF,
 * uSteer (θ, R·sin θ, R·cos θ, k2) y `STEERING_GLSL`. Devuelve (dB, sGas, sBone, sMirror) y, aparte,
 * (tipo de gas, línea del espejo).
 */
export const STEERED_PREFIX_GLSL = /* glsl */ `
vec4 steeredPrefix(int line, int k, out vec2 extra) {
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
  float sGas = -1.0, sBone = -1.0, sMirror = -1.0, gasKind = 0.0;
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
    if (g.y > 0.5 && !entered) continue;
    entered = true;
    if (g.z > 0.5 && !boneEntered) { db += ${glslFloat(BONE_ENTRY_DB)}; boneEntered = true; }
    float sRow = alongLineMm(uCurvR + (float(s) + 0.5) * step, a, rc);
    if (g.z > 0.5 && sBone < 0.0) sBone = sRow;
    if (g.w > 0.5 && sGas < 0.0) { sGas = crossing ? sMirror : sRow; gasKind = g.w; }
    db += g.x * scale;
  }
  extra = vec2(sGas >= 0.0 ? gasKind : 0.0, sMirror >= 0.0 ? float(frozen) : -1.0);
  return vec4(db, sGas, sBone, sMirror);
}
`;
