import { FIRST_WALL_INTERFACE, LAST_WALL_INTERFACE, isWallLayerInterface, type Interface } from '../anatomy/interfaces';
import { wallArc, wallDepths, wallWavenumber } from '../anatomy/organs/wall';
import { IDENTITY_WARP, warpNormal, type Warp } from '../anatomy/compression';
import { torsoDepth, torsoDepthGradient, type Torso } from '../anatomy/primitives';
import { TISSUES, Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import { IFACE_K_DB, IFACE_MIN_COS, interfaceEchoField } from './interfaceEcho';
import { hash13, valueNoise } from './speckleField';

/**
 * Textura de la pared (decisión 62): la estructura sub-milimétrica de la grasa subcutánea y del músculo
 * que el moteado uniforme de antes no tenía. Es un factor de la amplitud de retrodispersión de la muestra
 * (`fieldFor` de la pasada B), evaluado en cada plano de elevación sobre la coordenada MATERIAL del plano:
 * la estructura está anclada a la anatomía (no hierve al mover la sonda) y la mezcla de los tres planos la
 * promedia en elevación como al moteado. Solo en la pared: 1 en cualquier otro tejido (el hígado, el riñón
 * y los vasos no cambian).
 *
 *  - Grasa subcutánea: lóbulos hipoecoicos (la retrodispersión de `TISSUES` es la del interior del lóbulo)
 *    separados por septos fibrosos. Campo celular aplanado y anclado: columnas de Voronoi de ~7 mm a lo
 *    largo de la piel (u, z) con semillas al azar, y en cada columna estratos de ~3 mm de hondo con un
 *    desfase y una inclinación propios (≤ 14°). Los septos son las paredes de las columnas (casi
 *    perpendiculares a la piel) y los techos de los estratos (casi paralelos u oblicuos): en la imagen,
 *    tramos de 5–10 mm escalonados, como en las referencias.
 *  - Músculo: hipoecoico con estrías de perimisio cada ~2,2 mm (±15 %), casi paralelas a la piel con una
 *    ondulación peniforme de ±10–15° y de longitud finita (una máscara de ruido por estría: tramos de
 *    10–30 mm).
 *
 * Cada lámina es especular a su manera: su brillo es ε + (1 − ε)·|cosθ|⁴ con θ entre el haz y su normal
 * [ESTIMADO], así que los septos paralelos a la piel brillan de frente y los perpendiculares apenas se ven.
 * Gemelos: estas funciones (TS) y `WALL_TEXTURE_GLSL` (pasada B), misma fórmula; las profundidades de las
 * capas salen de `organs/wall.ts` (uWall en la GPU).
 */
export const WALL_TEXTURE = {
  /** Lóbulo de la grasa subcutánea a lo largo de la piel (mm): 5–10 mm (PMC7441131). */
  lobuleMm: 7,
  /** Estrato (profundidad de un lóbulo, mm): 2–4 mm. */
  stratumMm: 3.5,
  /** Pendiente máxima de los techos de los estratos de una columna (tan 14°). */
  septumTiltMax: 0.25,
  /** Semiespesor gaussiano del septo (mm): 0,2–0,5 mm de espesor a media altura. */
  septumSigmaMm: 0.15,
  /** Retrodispersión del septo fibroso (hígado = 1) [ESTIMADO]. */
  septumBack: 1.6,
  /** Estrías del perimisio: separación media (mm, 1,5–3), semiespesor (mm) y retrodispersión [ESTIMADO]. */
  striationSpacingMm: 2.2,
  striationSigmaMm: 0.15,
  striationBack: 3.0,
  /** Irregularidad de la separación: ±15 % con una correlación de 6 mm. */
  striationJitter: 0.3,
  striationJitterMm: 6,
  /** Tramos de estría: correlación de la máscara (mm) y umbrales del smoothstep (~40 % cubierto). */
  striationSegmentMm: 8,
  striationMask: [0.45, 0.6] as const,
  /** Especularidad de las láminas: ε + (1 − ε)·|cosθ|⁴. */
  orientationFloor: 0.2,
  /**
   * Variación de la reflectividad a lo largo de cada cara de la pared: exp(a·(n − 0,5)) con n un ruido de
   * valor anclado de correlación `faceVariationMm` (desviación de n ≈ 0,14: a = 3 → ±3,6 dB, a = 5 → ±6 dB):
   * rugosidad a la escala del haz, volumen parcial y oblicuidad, anclados (no hierven). Scarpa es la más
   * irregular (a tramos casi desaparece); con 6 mm y a = 1,5–3 las líneas se veían trazadas con regla (capturas
   * con GPU, 25-09-2026).
   */
  faceVariationMm: 4,
  faceVariation: [4, 5, 4, 4, 4, 3.5, 3] as const,
} as const;

/** Sales del hash de la textura (fijas: la anatomía del paciente no depende de la semilla del moteado). */
const SALT = { jitterU: 41.7, jitterV: 63.1, offset: 17.9, tiltU: 29.3, tiltV: 53.9, jitter: 71.3, mask: 83.7, face: 37.3 } as const;

/** Ganancia de amplitud de un septo o una estría de frente: su retrodispersión sobre la del tejido. */
const SEPTUM_GAIN = WALL_TEXTURE.septumBack / TISSUES[Tissue.Fat].backscatter;
const STRIATION_GAIN = WALL_TEXTURE.striationBack / TISSUES[Tissue.Muscle].backscatter;

const norm3 = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
};

/** Normal exterior de la piel (la de `torsoNormal`) y tangente en el sentido de u creciente, en el plano xy. */
function wallFrame(m: Vec3, t: Torso): { n: Vec3; tg: Vec3 } {
  return {
    n: norm3([m[0] / (t.a * t.a), m[1] / (t.b * t.b), 0]),
    tg: norm3([(t.a * m[1]) / t.b, (-t.b * m[0]) / t.a, 0]),
  };
}

/** Brillo de una lámina según la incidencia: ε + (1 − ε)·|cosθ|⁴. */
export function wallOrientation(n: Vec3, dir: Vec3): number {
  const c = Math.abs(n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]);
  const eps = WALL_TEXTURE.orientationFloor;
  return eps + (1 - eps) * c * c * c * c;
}

/**
 * Septo de la grasa subcutánea más cercano: [nx, ny, nz, peso] con el peso gaussiano de la distancia a él
 * (1 en su centro) y su normal. Peso 0 fuera de la grasa subcutánea.
 */
export function fatSeptum(m: Vec3, t: Torso): [number, number, number, number] {
  const u = wallArc(m, t);
  const w = wallDepths(t, u, m[2]);
  const d = -torsoDepth(m, t);
  if (d < w.skin || d >= w.fascia) return [0, 1, 0, 0];
  const T = WALL_TEXTURE;
  const qu = u / T.lobuleMm;
  const qv = m[2] / T.lobuleMm;
  const cu = Math.floor(qu);
  const cv = Math.floor(qv);
  const su: number[] = [];
  const sv: number[] = [];
  let k1 = 0;
  let best = 1e9;
  for (let j = 0; j < 9; j++) {
    const iu = cu + (j % 3) - 1;
    const iv = cv + Math.floor(j / 3) - 1;
    su.push(iu + hash13([iu, iv, SALT.jitterU]));
    sv.push(iv + hash13([iu, iv, SALT.jitterV]));
    const dd = (su[j] - qu) ** 2 + (sv[j] - qv) ** 2;
    if (dd < best) {
      best = dd;
      k1 = j;
    }
  }
  // distancia (en células) a la frontera de la columna: la menor distancia a una mediatriz de sus vecinas
  let dV = 1e9;
  let gu = 1;
  let gv = 0;
  for (let j = 0; j < 9; j++) {
    if (j === k1) continue;
    const du = su[j] - su[k1];
    const dv = sv[j] - sv[k1];
    const l = Math.hypot(du, dv);
    const dist = ((0.5 * (su[j] + su[k1]) - qu) * du + (0.5 * (sv[j] + sv[k1]) - qv) * dv) / l;
    if (dist < dV) {
      dV = dist;
      gu = du / l;
      gv = dv / l;
    }
  }
  const iu1 = cu + (k1 % 3) - 1;
  const iv1 = cv + Math.floor(k1 / 3) - 1;
  const off = hash13([iu1, iv1, SALT.offset]);
  const tu = (2 * hash13([iu1, iv1, SALT.tiltU]) - 1) * T.septumTiltMax;
  const tv = (2 * hash13([iu1, iv1, SALT.tiltV]) - 1) * T.septumTiltMax;
  const s = (d - w.skin + tu * (u - su[k1] * T.lobuleMm) + tv * (m[2] - sv[k1] * T.lobuleMm)) / T.stratumMm + off;
  const dh = (Math.abs(s - Math.round(s)) * T.stratumMm) / Math.sqrt(1 + tu * tu + tv * tv);
  const { n, tg } = wallFrame(m, t);
  const vertical = dV * T.lobuleMm < dh;
  const dist = vertical ? dV * T.lobuleMm : dh;
  const normal = vertical ? norm3([gu * tg[0], gu * tg[1], gv]) : norm3([-n[0] + tu * tg[0], -n[1] + tu * tg[1], tv]);
  const weight = Math.exp(-0.5 * (dist / T.septumSigmaMm) ** 2);
  return [normal[0], normal[1], normal[2], weight];
}

/**
 * Estría del perimisio más cercana: [nx, ny, nz, peso], peso gaussiano de su distancia por la máscara de su
 * tramo. Peso 0 fuera del músculo (entre la fascia profunda y la transversalis).
 */
export function muscleStriation(m: Vec3, t: Torso): [number, number, number, number] {
  const u = wallArc(m, t);
  const v = m[2];
  const w = wallDepths(t, u, v);
  const d = -torsoDepth(m, t);
  if (d < w.fascia || d >= w.transversalis) return [0, 1, 0, 0];
  const T = WALL_TEXTURE;
  // ondas periódicas en la vuelta (sin costura en la línea media posterior, `wallWavenumber`)
  const k1 = wallWavenumber(7, t);
  const k2 = wallWavenumber(17, t);
  const a1 = k1 * u + 0.8 * Math.sin(v / 11);
  const a2 = v / 9 + k2 * u;
  const U = 1.1 * Math.sin(a1) + 0.5 * Math.sin(a2);
  const Uu = 1.1 * Math.cos(a1) * k1 + 0.5 * Math.cos(a2) * k2;
  const Uv = (1.1 * Math.cos(a1) * 0.8 * Math.cos(v / 11)) / 11 + (0.5 * Math.cos(a2)) / 9;
  const J =
    T.striationJitter * T.striationSpacingMm * (valueNoise([u / T.striationJitterMm, v / T.striationJitterMm, 0], SALT.jitter) - 0.5);
  const s = (d - w.fascia + U + J) / T.striationSpacingMm;
  const k = Math.round(s);
  const dist = (Math.abs(s - k) * T.striationSpacingMm) / Math.sqrt(1 + Uu * Uu + Uv * Uv);
  const [m0, m1] = T.striationMask;
  const x = Math.min(
    1,
    Math.max(0, (valueNoise([u / T.striationSegmentMm, v / T.striationSegmentMm, k * 1.37], SALT.mask) - m0) / (m1 - m0)),
  );
  const mask = x * x * (3 - 2 * x);
  const { n, tg } = wallFrame(m, t);
  const normal = norm3([-n[0] + Uu * tg[0], -n[1] + Uu * tg[1], Uv]);
  return [normal[0], normal[1], normal[2], mask * Math.exp(-0.5 * (dist / T.striationSigmaMm) ** 2)];
}

/** Normal de una lámina en el mundo: la material por la jacobiana de la compresión de la sonda (decisión 63). */
function worldLamina(w: Warp, s: readonly number[]): Vec3 {
  return norm3(warpNormal(w, [s[0], s[1], s[2]]));
}

/**
 * Factor de amplitud de la textura de la pared en el punto material `m` del tejido `tissue`, con el haz en
 * la dirección `dir` (unitaria, del mundo): 1 + (G·brillo − 1)·peso, con G la ganancia del septo o de la estría.
 * 1 en cualquier tejido que no sea la grasa subcutánea o el músculo de la pared. La incidencia es la del mundo:
 * la normal material de la lámina pasa por la jacobiana de la compresión (`warp`, decisión 63; la identidad sin
 * sonda).
 */
export function wallTexture(m: Vec3, tissue: Tissue, dir: Vec3, t: Torso, warp: Warp = IDENTITY_WARP): number {
  if (tissue === Tissue.Fat) {
    const s = fatSeptum(m, t);
    return 1 + (SEPTUM_GAIN * wallOrientation(worldLamina(warp, s), dir) - 1) * s[3];
  }
  if (tissue === Tissue.Muscle) {
    const s = muscleStriation(m, t);
    return 1 + (STRIATION_GAIN * wallOrientation(worldLamina(warp, s), dir) - 1) * s[3];
  }
  return 1;
}

/**
 * Ganancia de amplitud del eco de la cara de pared `face` en el punto (1 en el resto de caras): la
 * variación anclada de su reflectividad a lo largo de la cara (`faceVariation`).
 */
export function wallFaceGain(m: Vec3, face: Interface, t: Torso): number {
  if (face < FIRST_WALL_INTERFACE || face > LAST_WALL_INTERFACE) return 1;
  const a = WALL_TEXTURE.faceVariation[face - FIRST_WALL_INTERFACE];
  const L = WALL_TEXTURE.faceVariationMm;
  return Math.exp(a * (valueNoise([wallArc(m, t) / L, m[2] / L, (face - FIRST_WALL_INTERFACE + 1) * 3.7], SALT.face) - 0.5));
}

/**
 * Eco de cara plana de una capa de la pared (`wallFaceEchoFlat` de la pasada B): el de las copias de la pared
 * que suma la serie de la pleura (decisión 61), en un bucle donde `faceGradient` no puede ir (el JIT de
 * SwiftShader). Las capas son casi paralelas a la piel: la normal y la norma del gradiente son las de la
 * profundidad radial (`torsoDepthGradient`), sin la ondulación de la capa (≤ 0,15 de pendiente: < 1 dB en el
 * lóbulo de s 0,3); sin la cortical costal ni el pericondrio (0 en cualquier otra cara). `ifd`, la distancia de
 * la cara en la muestra (`interfaceDistance`); `dir`, la dirección unitaria del camino; `warp`, la jacobiana de la
 * compresión de la sonda (decisión 63), que lleva el gradiente al mundo.
 */
export function wallFaceEchoFlat(
  face: Interface,
  ifd: number,
  m: Vec3,
  dir: Vec3,
  t: Torso,
  k0: number,
  kDb = IFACE_K_DB,
  warp: Warp = IDENTITY_WARP,
): number {
  if (!isWallLayerInterface(face)) return 0;
  const g = warpNormal(warp, torsoDepthGradient(m, t));
  const gl = Math.hypot(g[0], g[1], g[2]);
  const cosI = Math.abs(g[0] * dir[0] + g[1] * dir[1] + g[2] * dir[2]) / gl;
  if (cosI < IFACE_MIN_COS) return 0;
  return interfaceEchoField(face, cosI, wallFaceGain(m, face, t), ifd / (gl * cosI), k0, kDb);
}

const f4 = (x: number): string => x.toFixed(4);

/**
 * Gemelo GLSL (pasada B, detrás de `SPECKLE_TISSUE_GLSL`: usa hash13, valueNoise, torsoDepth, torsoNormal,
 * wallArc, uTorso y uWall de la anatomía).
 */
export const WALL_TEXTURE_GLSL = /* glsl */ `
#define WT_LOBULE_MM ${f4(WALL_TEXTURE.lobuleMm)}
#define WT_STRATUM_MM ${f4(WALL_TEXTURE.stratumMm)}
#define WT_TILT_MAX ${f4(WALL_TEXTURE.septumTiltMax)}
#define WT_SEPTUM_SIGMA ${f4(WALL_TEXTURE.septumSigmaMm)}
#define WT_SEPTUM_GAIN ${f4(SEPTUM_GAIN)}
#define WT_STRIA_SPACING ${f4(WALL_TEXTURE.striationSpacingMm)}
#define WT_STRIA_SIGMA ${f4(WALL_TEXTURE.striationSigmaMm)}
#define WT_STRIA_GAIN ${f4(STRIATION_GAIN)}
#define WT_STRIA_JITTER ${f4(WALL_TEXTURE.striationJitter)}
#define WT_STRIA_JITTER_MM ${f4(WALL_TEXTURE.striationJitterMm)}
#define WT_STRIA_SEGMENT_MM ${f4(WALL_TEXTURE.striationSegmentMm)}
#define WT_STRIA_MASK0 ${f4(WALL_TEXTURE.striationMask[0])}
#define WT_STRIA_MASK1 ${f4(WALL_TEXTURE.striationMask[1])}
#define WT_ORIENT_FLOOR ${f4(WALL_TEXTURE.orientationFloor)}
#define WT_FACE_VAR_MM ${f4(WALL_TEXTURE.faceVariationMm)}
const float WT_FACE_VAR[${WALL_TEXTURE.faceVariation.length}] = float[${WALL_TEXTURE.faceVariation.length}](${WALL_TEXTURE.faceVariation.map(f4).join(', ')});
vec3 wallTangentXY(vec3 m) { return normalize(vec3(uTorso.x * m.y / uTorso.y, -uTorso.y * m.x / uTorso.x, 0.0)); }
float wallOrientation(vec3 n, vec3 dir) {
  float c = abs(dot(n, dir));
  return WT_ORIENT_FLOOR + (1.0 - WT_ORIENT_FLOOR) * c * c * c * c;
}
vec4 fatSeptum(vec3 m) {
  float skin = uWall.x;
  float u = wallArc(m);
  float fascia = wallDepths(u, m.z).y;
  float d = -torsoDepth(m);
  if (d < skin || d >= fascia) return vec4(0.0, 1.0, 0.0, 0.0);
  vec2 q = vec2(u, m.z) / WT_LOBULE_MM;
  vec2 c = floor(q);
  vec2 s[9];
  int k1 = 0;
  float best = 1e9;
  for (int j = 0; j < 9; j++) {
    vec2 cell = c + vec2(float(j % 3 - 1), float(j / 3 - 1));
    s[j] = cell + vec2(hash13(vec3(cell, ${f4(SALT.jitterU)})), hash13(vec3(cell, ${f4(SALT.jitterV)})));
    vec2 e = s[j] - q;
    float dd = dot(e, e);
    if (dd < best) { best = dd; k1 = j; }
  }
  float dV = 1e9;
  vec2 gdir = vec2(1.0, 0.0);
  for (int j = 0; j < 9; j++) {
    if (j == k1) continue;
    vec2 dv = s[j] - s[k1];
    float l = length(dv);
    float dist = dot(0.5 * (s[j] + s[k1]) - q, dv) / l;
    if (dist < dV) { dV = dist; gdir = dv / l; }
  }
  vec2 cell1 = c + vec2(float(k1 % 3 - 1), float(k1 / 3 - 1));
  float off = hash13(vec3(cell1, ${f4(SALT.offset)}));
  float tu = (2.0 * hash13(vec3(cell1, ${f4(SALT.tiltU)})) - 1.0) * WT_TILT_MAX;
  float tv = (2.0 * hash13(vec3(cell1, ${f4(SALT.tiltV)})) - 1.0) * WT_TILT_MAX;
  float st = (d - skin + tu * (u - s[k1].x * WT_LOBULE_MM) + tv * (m.z - s[k1].y * WT_LOBULE_MM)) / WT_STRATUM_MM + off;
  float dh = abs(st - floor(st + 0.5)) * WT_STRATUM_MM / sqrt(1.0 + tu * tu + tv * tv);
  vec3 n = torsoNormal(m);
  vec3 tg = wallTangentXY(m);
  bool vertical = dV * WT_LOBULE_MM < dh;
  float dist = vertical ? dV * WT_LOBULE_MM : dh;
  vec3 normal = vertical ? normalize(vec3(gdir.x * tg.xy, gdir.y)) : normalize(vec3(-n.xy + tu * tg.xy, tv));
  float x = dist / WT_SEPTUM_SIGMA;
  return vec4(normal, exp(-0.5 * x * x));
}
vec4 muscleStriation(vec3 m) {
  float u = wallArc(m);
  float v = m.z;
  vec4 w = wallDepths(u, v);
  float fascia = w.y;
  float d = -torsoDepth(m);
  if (d < fascia || d >= w.z) return vec4(0.0, 1.0, 0.0, 0.0);
  float P = wallPerimeter();
  float k1 = wallWavenumber(7.0, P);
  float k2 = wallWavenumber(17.0, P);
  float a1 = k1 * u + 0.8 * sin(v / 11.0);
  float a2 = v / 9.0 + k2 * u;
  float U = 1.1 * sin(a1) + 0.5 * sin(a2);
  float Uu = 1.1 * cos(a1) * k1 + 0.5 * cos(a2) * k2;
  float Uv = 1.1 * cos(a1) * 0.8 * cos(v / 11.0) / 11.0 + 0.5 * cos(a2) / 9.0;
  float J = WT_STRIA_JITTER * WT_STRIA_SPACING * (valueNoise(vec3(u / WT_STRIA_JITTER_MM, v / WT_STRIA_JITTER_MM, 0.0), ${f4(SALT.jitter)}) - 0.5);
  float s = (d - fascia + U + J) / WT_STRIA_SPACING;
  float k = floor(s + 0.5);
  float dist = abs(s - k) * WT_STRIA_SPACING / sqrt(1.0 + Uu * Uu + Uv * Uv);
  float mask = smoothstep(WT_STRIA_MASK0, WT_STRIA_MASK1, valueNoise(vec3(u / WT_STRIA_SEGMENT_MM, v / WT_STRIA_SEGMENT_MM, k * 1.37), ${f4(SALT.mask)}));
  vec3 n = torsoNormal(m);
  vec3 tg = wallTangentXY(m);
  float x = dist / WT_STRIA_SIGMA;
  return vec4(normalize(vec3(-n.xy + Uu * tg.xy, Uv)), mask * exp(-0.5 * x * x));
}
// Ganancia del eco de una cara de la pared: variación anclada de su reflectividad a lo largo de la cara
float wallFaceGain(vec3 m, int face) {
  if (face < IF_FIRST_WALL || face > IF_LAST_WALL) return 1.0;
  return exp(WT_FACE_VAR[face - IF_FIRST_WALL] * (valueNoise(vec3(wallArc(m) / WT_FACE_VAR_MM, m.z / WT_FACE_VAR_MM, float(face - IF_FIRST_WALL + 1) * 3.7), ${f4(SALT.face)}) - 0.5));
}
// Factor de amplitud de la textura de la pared (grasa subcutánea y músculo; 1 en el resto); la incidencia, la del
// mundo: la normal de la lámina por la jacobiana de la compresión (w, decisión 63)
float wallTexture(vec3 m, int tissue, vec3 dir, Warp w) {
  if (tissue == T_FAT) {
    vec4 s = fatSeptum(m);
    return 1.0 + (WT_SEPTUM_GAIN * wallOrientation(normalize(warpNormal(w, s.xyz)), dir) - 1.0) * s.w;
  }
  if (tissue == T_MUSCLE) {
    vec4 s = muscleStriation(m);
    return 1.0 + (WT_STRIA_GAIN * wallOrientation(normalize(warpNormal(w, s.xyz)), dir) - 1.0) * s.w;
  }
  return 1.0;
}
`;

/**
 * Gemelo GLSL de `wallFaceEchoFlat` (pasada B, detrás de `INTERFACE_ECHO_GLSL`: usa uIface, interfaceProfileEcho,
 * wallFaceGain y uTorso). `torsoDepthGrad` es el gemelo de `torsoDepthGradient`.
 */
export const WALL_FACE_ECHO_GLSL = /* glsl */ `
vec3 torsoDepthGrad(vec3 p) {
  float r = length(p.xy);
  if (r < 1e-6) return vec3(0.0, 1.0, 0.0);
  float rho = length(p.xy / uTorso.xy);
  vec2 g = p.xy / r * (1.0 - 1.0 / rho) + r / (rho * rho * rho) * p.xy / (uTorso.xy * uTorso.xy);
  return vec3(g, 0.0);
}
// Eco de cara plana de una capa de la pared: las copias de la serie de la pleura (decisión 61), en su bucle
// y sin faceGradient; normal y norma de la profundidad radial llevadas al mundo por la compresión (w), sin
// costillas ni pericondrio
float wallFaceEchoFlat(Cls c, vec3 m, vec3 dir, Warp w) {
  if (c.iface < IF_FIRST_WALL || c.iface > IF_LAST_WALL) return 0.0;
  if (c.ifd > (uIface[c.iface].w > 0.5 ? IFACE_REACH : IFACE_SHIFT + IFACE_REACH) * IFACE_GRAD_MAX * warpBound(w)) return 0.0;
  vec3 g = warpNormal(w, torsoDepthGrad(m));
  float gl = length(g);
  float cosI = abs(dot(g, dir)) / gl;
  if (cosI < IFACE_MIN_COS) return 0.0;
  return interfaceProfileEcho(c.iface, cosI, wallFaceGain(m, c.iface), c.ifd / (gl * cosI));
}
`;
