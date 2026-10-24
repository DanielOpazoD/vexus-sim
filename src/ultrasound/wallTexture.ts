import { FIRST_WALL_INTERFACE, LAST_WALL_INTERFACE, isWallLayerInterface, type Interface } from '../anatomy/interfaces';
import {
  WALL,
  WALL_SWELL_TERMS,
  WALL_WAVE_TERMS,
  wallArc,
  wallArcGradient,
  wallDepths,
  wallPerimeter,
  wallWavenumber,
} from '../anatomy/organs/wall';
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
  // Cadena de derivación de la lámina material: el perfil corporal incluye pendiente
  // craneocaudal y su arco no es una tangente unitaria (221). No mueve los septos.
  const depthGradient = torsoDepthGradient(m, t);
  const arcGradient = wallArcGradient(m, t);
  const vertical = dV * T.lobuleMm < dh;
  const dist = vertical ? dV * T.lobuleMm : dh;
  const normal = vertical
    ? norm3([gu * arcGradient[0], gu * arcGradient[1], gv])
    : norm3([-depthGradient[0] + tu * arcGradient[0], -depthGradient[1] + tu * arcGradient[1], -depthGradient[2] + tv]);
  const weight = Math.exp(-0.5 * (dist / T.septumSigmaMm) ** 2);
  return [normal[0], normal[1], normal[2], weight];
}

/** Valor y derivadas (u,z) del mismo ruido de J, en su plano fijo q.z=0.
 * Cuatro nodos compartidos: no se duplica ruido ni se consulta el clasificador. */
function striationNoise(u: number, z: number): Vec3 {
  const q = [u / WALL_TEXTURE.striationJitterMm, z / WALL_TEXTURE.striationJitterMm];
  const c = q.map(Math.floor),
    f = q.map((v, i) => v - c[i]);
  const s = f.map((v) => v * v * (3 - 2 * v));
  const d = f.map((v) => (6 * v * (1 - v)) / WALL_TEXTURE.striationJitterMm);
  const h = (x: number, y: number) => hash13([c[0] + x + SALT.jitter, c[1] + y + SALT.jitter, SALT.jitter]);
  const a = h(0, 0),
    b = h(1, 0),
    c0 = h(0, 1),
    e = h(1, 1);
  const lo = a + (b - a) * s[0],
    hi = c0 + (e - c0) * s[0];
  return [lo + (hi - lo) * s[1], (b - a + (e - c0 - (b - a)) * s[1]) * d[0], (hi - lo) * d[1]];
}

/** Derivadas exactas de la fascia existente: sus cinco senos, sin diferencias de anatomía. */
function striationFasciaSlope(u: number, z: number, t: Torso): [number, number] {
  const ip = (2 * Math.PI) / wallPerimeter(t),
    g = [0, 0];
  for (const [terms, amplitude] of [
    [WALL_SWELL_TERMS[3], Math.min(WALL.fatSwell * t.fatMm, WALL.fatSwellMaxMm)],
    [WALL_WAVE_TERMS[3], WALL.fasciaWaveMm],
  ] as const)
    for (const r of terms) {
      const ku = r.harmonic * ip,
        v = amplitude * r.weight * Math.cos(ku * u + r.kz * z + r.phase);
      g[0] += v * ku;
      g[1] += v * r.kz;
    }
  return [g[0], g[1]];
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
  const noise = striationNoise(u, v);
  const jitterGain = T.striationJitter * T.striationSpacingMm;
  const J = jitterGain * (noise[0] - 0.5);
  const s = (d - w.fascia + U + J) / T.striationSpacingMm;
  const k = Math.round(s);
  const [m0, m1] = T.striationMask;
  const x = Math.min(
    1,
    Math.max(0, (valueNoise([u / T.striationSegmentMm, v / T.striationSegmentMm, k * 1.37], SALT.mask) - m0) / (m1 - m0)),
  );
  const mask = x * x * (3 - 2 * x);
  const fasciaSlope = striationFasciaSlope(u, v, t);
  const gu = wallArcGradient(m, t),
    gd = torsoDepthGradient(m, t);
  const fu = Uu + jitterGain * noise[1] - fasciaSlope[0];
  const fz = Uv + jitterGain * noise[2] - fasciaSlope[1];
  const gradient: Vec3 = [-gd[0] + fu * gu[0], -gd[1] + fu * gu[1], -gd[2] + fz];
  const normal = norm3(gradient);
  // Ancho aproximado anterior: la corrección métrica 249 queda aplazada (DECISIONS).
  const dist = (Math.abs(s - k) * T.striationSpacingMm) / Math.sqrt(1 + Uu * Uu + Uv * Uv);
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

/** Mismo ruido cúbico, con nodos periódicos en u: no hay corte al cruzar la espalda.
 * Solo la celda de cierre ajusta su coordenada; el resto conserva exactamente u/faceVariationMm.
 * La correlación y la reflectividad son estimadas; no implica microanatomía segmentada. */
function wallFaceNoise(u: number, z: number, face: number, perimeter: number): number {
  const L = WALL_TEXTURE.faceVariationMm,
    period = Math.max(1, Math.round(perimeter / L));
  const x = u / L,
    edge = perimeter / (2 * L),
    start = Math.floor((period - 1) / 2);
  if (Math.abs(x) <= start) return valueNoise([x, z / L, face * 3.7], SALT.face);
  const blend = Math.min(1, Math.max(0, (Math.abs(x) - start) / (edge - start)));
  // El ajuste y su derivada son cero al entrar; en ±P/2 llega a ±period/2 con derivada 1.
  const q = [x + Math.sign(x) * (period / 2 - edge) * blend * blend * (3 - 2 * blend), z / L, face * 3.7];
  const c = q.map(Math.floor),
    s = q.map((v, i) => {
      const x = v - c[i];
      return x * x * (3 - 2 * x);
    });
  // Representantes centrados: se conserva la realización interior y solo se identifica la costura.
  const wrap = (x: number) => (x >= period / 2 ? x - period : x < -period / 2 ? x + period : x);
  const h = (x: number, y: number, z0: number) => hash13([wrap(c[0] + x) + SALT.face, c[1] + y + SALT.face, c[2] + z0 + SALT.face]);
  const mix = (a: number, b: number, w: number) => a + (b - a) * w;
  const x00 = mix(h(0, 0, 0), h(1, 0, 0), s[0]),
    x10 = mix(h(0, 1, 0), h(1, 1, 0), s[0]);
  const x01 = mix(h(0, 0, 1), h(1, 0, 1), s[0]),
    x11 = mix(h(0, 1, 1), h(1, 1, 1), s[0]);
  return mix(mix(x00, x10, s[1]), mix(x01, x11, s[1]), s[2]);
}

/**
 * Ganancia de amplitud del eco de la cara de pared `face` en el punto (1 en el resto de caras): la
 * variación anclada de su reflectividad a lo largo de la cara (`faceVariation`).
 */
export function wallFaceGain(m: Vec3, face: Interface, t: Torso): number {
  if (face < FIRST_WALL_INTERFACE || face > LAST_WALL_INTERFACE) return 1;
  const a = WALL_TEXTURE.faceVariation[face - FIRST_WALL_INTERFACE];
  return Math.exp(a * (wallFaceNoise(wallArc(m, t), m[2], face - FIRST_WALL_INTERFACE + 1, wallPerimeter(t)) - 0.5));
}

/**
 * Eco de cara plana de una capa de la pared (`wallFaceEchoFlat` de la pasada B): el de las copias de la pared
 * que suma la serie de la pleura (decisión 61), en un bucle donde `faceGradient` no puede ir (el JIT de
 * SwiftShader). La normal y la norma del gradiente son las de la profundidad radial (`torsoDepthGradient`), sin el
 * relieve de la capa (decisión 88: su pendiente de 6–9° de mediana deja el eco de cada cruce a ≤ 1,3 dB del completo;
 * con la pendiente de la capa, tres evaluaciones de su profundidad, el bucle subía la compilación de B con SwiftShader
 * ~3 s); sin la cortical costal ni el pericondrio (0 en cualquier otra cara). `ifd`, la distancia de la cara en la
 * muestra (`interfaceDistance`); `dir`, la dirección unitaria del camino; `warp`, la jacobiana de la compresión de la
 * sonda (decisión 63), que lleva el gradiente al mundo.
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
const f6 = (x: number): string => x.toFixed(6);
const fasciaSlopeGlsl = (terms: (typeof WALL_WAVE_TERMS)[number]): string =>
  terms
    .map(
      (r) =>
        `vec2(${r.harmonic.toFixed(1)} * iP, ${f6(r.kz)}) * ${f6(r.weight)} * cos(${r.harmonic.toFixed(1)} * iP * u + ${f6(r.kz)} * z + ${f6(r.phase)})`,
    )
    .join(' + ');

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
  vec3 gd = torsoDepthGrad(m);
  vec3 gu = wallArcGradient(m);
  bool vertical = dV * WT_LOBULE_MM < dh;
  float dist = vertical ? dV * WT_LOBULE_MM : dh;
  vec3 normal = vertical ? normalize(vec3(gdir.x * gu.xy, gdir.y)) : normalize(-gd + tu * gu + vec3(0.0, 0.0, tv));
  float x = dist / WT_SEPTUM_SIGMA;
  return vec4(normal, exp(-0.5 * x * x));
}
// (valor, derivada u, derivada z), reutilizando los cuatro nodos del ruido plano.
vec3 striationNoise(vec2 q) {
  q /= WT_STRIA_JITTER_MM;
  vec2 c = floor(q), f = q - c;
  vec2 s = f * f * (3.0 - 2.0 * f), d = 6.0 * f * (1.0 - f) / WT_STRIA_JITTER_MM;
  vec3 o = vec3(${f4(SALT.jitter)});
  float a = hash13(vec3(c, 0.0) + o), b = hash13(vec3(c + vec2(1, 0), 0.0) + o);
  float c0 = hash13(vec3(c + vec2(0, 1), 0.0) + o), e = hash13(vec3(c + vec2(1, 1), 0.0) + o);
  float lo = mix(a, b, s.x), hi = mix(c0, e, s.x);
  return vec3(mix(lo, hi, s.y), mix(b - a, e - c0, s.y) * d.x, (hi - lo) * d.y);
}
vec2 striationFasciaSlope(float u, float z, float iP) {
  return min(WALL_FAT_SWELL * uWall.y, WALL_FAT_SWELL_MAX_MM) * (${fasciaSlopeGlsl(WALL_SWELL_TERMS[3])})
    + WALL_FASCIA_WAVE_MM * (${fasciaSlopeGlsl(WALL_WAVE_TERMS[3])});
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
  vec3 noise = striationNoise(vec2(u, v));
  float jitterGain = WT_STRIA_JITTER * WT_STRIA_SPACING;
  float J = jitterGain * (noise.x - 0.5);
  float s = (d - fascia + U + J) / WT_STRIA_SPACING;
  float k = floor(s + 0.5);
  float mask = smoothstep(WT_STRIA_MASK0, WT_STRIA_MASK1, valueNoise(vec3(u / WT_STRIA_SEGMENT_MM, v / WT_STRIA_SEGMENT_MM, k * 1.37), ${f4(SALT.mask)}));
  vec2 slope = vec2(Uu, Uv) + jitterGain * noise.yz - striationFasciaSlope(u, v, 6.2831853 / P);
  vec3 gradient = -torsoDepthGrad(m) + slope.x * wallArcGradient(m) + vec3(0.0, 0.0, slope.y);
  float x = abs(s - k) * WT_STRIA_SPACING / (sqrt(1.0 + Uu * Uu + Uv * Uv) * WT_STRIA_SIGMA);
  return vec4(normalize(gradient), mask * exp(-0.5 * x * x));
}
float wallFaceNoise(float u, float z, float face) {
  float P = wallPerimeter(), period = max(1.0, floor(P / WT_FACE_VAR_MM + 0.5));
  float x = u / WT_FACE_VAR_MM, edge = P / (2.0 * WT_FACE_VAR_MM);
  float start = floor((period - 1.0) / 2.0);
  if (abs(x) <= start) return valueNoise(vec3(x, z / WT_FACE_VAR_MM, face * 3.7), ${f4(SALT.face)});
  float blend = smoothstep(start, edge, abs(x));
  vec3 q = vec3(x + sign(x) * (period / 2.0 - edge) * blend, z / WT_FACE_VAR_MM, face * 3.7);
  vec3 c = floor(q), s = q - c;
  s = s * s * (3.0 - 2.0 * s);
  // Un modulo puede perturbar nodos enteros en GPU y cambiar su hash en el interior.
  vec2 nx = c.xx + vec2(0.0, 1.0);
  nx = vec2(nx.x >= 0.5 * period ? nx.x - period : nx.x < -0.5 * period ? nx.x + period : nx.x,
            nx.y >= 0.5 * period ? nx.y - period : nx.y < -0.5 * period ? nx.y + period : nx.y);
  vec3 o = vec3(${f4(SALT.face)});
  float x00 = mix(hash13(vec3(nx.x,c.yz)+o),hash13(vec3(nx.y,c.yz)+o),s.x);
  float x10 = mix(hash13(vec3(nx.x,c.y+1.0,c.z)+o),hash13(vec3(nx.y,c.y+1.0,c.z)+o),s.x);
  float x01 = mix(hash13(vec3(nx.x,c.y,c.z+1.0)+o),hash13(vec3(nx.y,c.y,c.z+1.0)+o),s.x);
  float x11 = mix(hash13(vec3(nx.x,c.yz+1.0)+o),hash13(vec3(nx.y,c.yz+1.0)+o),s.x);
  return mix(mix(x00,x10,s.y),mix(x01,x11,s.y),s.z);
}
// Ganancia del eco de una cara de la pared: variación anclada de su reflectividad a lo largo de la cara
float wallFaceGain(vec3 m, int face) {
  if (face < IF_FIRST_WALL || face > IF_LAST_WALL) return 1.0;
  return exp(WT_FACE_VAR[face - IF_FIRST_WALL] * (wallFaceNoise(wallArc(m), m.z, float(face - IF_FIRST_WALL + 1)) - 0.5));
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
 * wallFaceGain y `torsoDepthGrad` de la anatomía, el gemelo de `torsoDepthGradient`).
 */
export const WALL_FACE_ECHO_GLSL = /* glsl */ `
// Eco de cara plana de una capa de la pared: las copias de la serie de la pleura (decisión 61), en su bucle y sin
// faceGradient; normal y norma de la profundidad radial (sin el relieve de la capa, decisión 88) llevadas al mundo por
// la compresión (w), sin costillas ni pericondrio
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
