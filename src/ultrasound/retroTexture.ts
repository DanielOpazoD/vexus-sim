import { IDENTITY_WARP, warpNormal, type Warp } from '../anatomy/compression';
import { PSOAS_NODES } from '../anatomy/organs/retroperitoneum';
import { TISSUES, Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import { hash13, valueNoise } from './speckleField';
import { wallOrientation } from './wallTexture';

/**
 * Textura de los músculos retroperitoneales (decisión 81): el psoas y el cuadrado lumbar son hipoecoicos entre los
 * septos fibroadiposos del perimisio, que separan haces de fascículos a lo largo del músculo: en eje largo, líneas
 * ecogénicas finas paralelas a él, discontinuas; en sección, puntos y trazos cortos («cielo estrellado») [LITERATURA:
 * aspecto ecográfico del músculo esquelético normal; tamaños ESTIMADOS]. Campo celular anclado: células de Voronoi de
 * ~4 mm en la sección perpendicular al eje del músculo, extruidas a lo largo de él, con tramos de 10–30 mm (una máscara
 * de ruido por septo) y el brillo de lámina de la pared (`wallOrientation`: ε + (1 − ε)·|cosθ|⁴). Eje: la cuerda del
 * psoas (de T12 a la pelvis, a ≤ 5° de cada tramo, sin costuras entre tramos) y, en el cuadrado, sus fibras
 * iliocostales (de la cresta ilíaca hacia arriba y adentro). Es un factor de la amplitud de la pasada B evaluado en cada
 * plano de elevación, como el de la pared (decisión 62); desde la decisión 87 también los lóbulos del seno renal (grasa
 * retroperitoneal que sigue en la perirrenal por el hilio, `sinusLobules`); desde la decisión 107 también los lóbulos de la grasa mesentérica/retroperitoneal; 1 en el resto de tejidos. Gemelos: estas
 * funciones (TS) y `RETRO_TEXTURE_GLSL`.
 */
export const RETRO_TEXTURE = {
  /** Célula de la sección (mm): haces de fascículos de 2–5 mm (a 8–15 cm se ven los septos gruesos, no el perimisio fino). */
  fascicleMm: 4,
  /** Semiespesor gaussiano del septo (mm). */
  septumSigmaMm: 0.2,
  /** Retrodispersión del septo (hígado = 1), la de las estrías de la pared. */
  septumBack: 3,
  /** Correlación (mm) a lo largo del eje de la máscara de tramos y sus umbrales (~50 % cubierto). */
  segmentMm: 10,
  mask: [0.35, 0.55] as const,
  /** Fibras del cuadrado: |x| que ganan hacia dentro por mm hacia arriba. */
  quadratusSlant: 0.25,
} as const;

/**
 * Seno renal (decisión 87): grasa en lóbulos de milímetros con tabiques fibrosos, vasos segmentarios y cálices colapsados,
 * ecogénica y heterogénea («lo más ecogénico, heterogéneo»: revisión 25-09, Radiopaedia). Factor log-normal anclado de un
 * ruido de valor, `norm`·exp(a·(n − 0,5)) en células de `cellMm`, con sal fija (anatomía, no moteado): la desviación de n es
 * 0,186, así que a = 4 da 6,4 dB de desviación, y `norm` = 1/√E[exp(2a(n − 0,5))] (2·10⁶ puntos) deja la potencia media en
 * 1 (la amplitud media, en 0,79): la retrodispersión de `TISSUES` es la media del seno en la imagen y en la puerta PW, que
 * no lleva la textura [ESTIMADO: la heterogeneidad, sobre las referencias reales del juez ciego, donde la desviación del
 * gris del seno es 3 veces la del hígado]. Encima van los grumos del tejido (decisión 56). Antes era el moteado del hígado
 * más brillante.
 */
export const SINUS_TEXTURE = { cellMm: 3, gain: 4, salt: 57.3, norm: 0.615 } as const;

/** Factor de amplitud de los lóbulos del seno renal en el punto material `m` (potencia media 1). */
export function sinusLobules(m: Vec3): number {
  const S = SINUS_TEXTURE;
  return S.norm * Math.exp(S.gain * (valueNoise([m[0] / S.cellMm, m[1] / S.cellMm, m[2] / S.cellMm], S.salt) - 0.5));
}

/** Estimated lobular texture of mesenteric/retroperitoneal fat, distinct from hepatic speckle.
 * Power normalized on 200k material samples; does not change basal attenuation/backscatter. */
export const VISCERAL_FAT_TEXTURE = { cellMm: 6, gain: 2, salt: 83.7, norm: 0.875 } as const;
export function visceralFatLobules(m: Vec3): number {
  const S = VISCERAL_FAT_TEXTURE;
  return S.norm * Math.exp(S.gain * (valueNoise([m[0] / S.cellMm, m[1] / S.cellMm, m[2] / S.cellMm], S.salt) - 0.5));
}

const SALT = { u: 23.9, v: 47.3, mask: 91.1 } as const;

const norm3 = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Cuerda del psoas en (|x|, y, z): del primer al último nodo. */
const PSOAS_CHORD: Vec3 = [0, 1, 2].map((i) => PSOAS_NODES[PSOAS_NODES.length - 1][i] - PSOAS_NODES[0][i]) as Vec3;

/** Eje de las fibras del músculo retroperitoneal `tissue` en el lado del punto (unitario, marco del mundo). */
export function retroMuscleAxis(m: Vec3, tissue: Tissue): Vec3 {
  const sx = m[0] < 0 ? -1 : 1;
  if (tissue === Tissue.Psoas) return norm3([sx * PSOAS_CHORD[0], PSOAS_CHORD[1], PSOAS_CHORD[2]]);
  return norm3([-sx * RETRO_TEXTURE.quadratusSlant, 0, 1]);
}

/**
 * Septo del perimisio más cercano: [nx, ny, nz, peso], con el peso gaussiano de su distancia por la máscara de su tramo
 * y su normal (perpendicular al eje). Voronoi en la sección como `fatSeptum` en la grasa de la pared.
 */
export function fascicleSeptum(m: Vec3, tissue: Tissue): [number, number, number, number] {
  const T = RETRO_TEXTURE;
  const a = retroMuscleAxis(m, tissue);
  const e1 = norm3([-a[2], 0, a[0]]);
  const e2: Vec3 = [a[1] * e1[2] - a[2] * e1[1], a[2] * e1[0] - a[0] * e1[2], a[0] * e1[1] - a[1] * e1[0]];
  const salt = tissue + (m[0] < 0 ? 0 : 7);
  const p1 = m[0] * e1[0] + m[1] * e1[1] + m[2] * e1[2];
  const p2 = m[0] * e2[0] + m[1] * e2[1] + m[2] * e2[2];
  const s = m[0] * a[0] + m[1] * a[1] + m[2] * a[2];
  const qu = p1 / T.fascicleMm;
  const qv = p2 / T.fascicleMm;
  const cu = Math.floor(qu);
  const cv = Math.floor(qv);
  const su: number[] = [];
  const sv: number[] = [];
  let k1 = 0;
  let best = 1e9;
  for (let j = 0; j < 9; j++) {
    const iu = cu + (j % 3) - 1;
    const iv = cv + Math.floor(j / 3) - 1;
    su.push(iu + hash13([iu, iv, SALT.u + salt]));
    sv.push(iv + hash13([iu, iv, SALT.v + salt]));
    const dd = (su[j] - qu) ** 2 + (sv[j] - qv) ** 2;
    if (dd < best) {
      best = dd;
      k1 = j;
    }
  }
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
  const [m0, m1] = T.mask;
  const x = Math.min(1, Math.max(0, (valueNoise([qu * 0.5, qv * 0.5, s / T.segmentMm], SALT.mask + salt) - m0) / (m1 - m0)));
  const w = x * x * (3 - 2 * x) * Math.exp(-0.5 * ((dV * T.fascicleMm) / T.septumSigmaMm) ** 2);
  return [gu * e1[0] + gv * e2[0], gu * e1[1] + gv * e2[1], gu * e1[2] + gv * e2[2], w];
}

/**
 * Factor de amplitud de la textura de los músculos retroperitoneales en el punto material `m` del tejido `tissue`, con el
 * haz en la dirección `dir` (unitaria, del mundo): 1 + (G·brillo − 1)·peso, con G la ganancia del septo sobre el músculo; en
 * el seno renal, sus lóbulos (`sinusLobules`). 1 fuera del psoas, cuadrado lumbar, seno y grasa mesentérica/retroperitoneal. La normal del septo pasa al mundo por la jacobiana de la compresión (`warp`).
 */
export function retroTexture(m: Vec3, tissue: Tissue, dir: Vec3, warp: Warp = IDENTITY_WARP): number {
  if (tissue === Tissue.RenalSinus) return sinusLobules(m);
  if (tissue === Tissue.RetroperitonealFat || tissue === Tissue.MesentericFat) return visceralFatLobules(m);
  if (tissue !== Tissue.Psoas && tissue !== Tissue.QuadratusLumborum) return 1;
  const s = fascicleSeptum(m, tissue);
  const g = RETRO_TEXTURE.septumBack / TISSUES[tissue].backscatter;
  return 1 + (g * wallOrientation(norm3(warpNormal(warp, [s[0], s[1], s[2]])), dir) - 1) * s[3];
}

const f4 = (x: number): string => x.toFixed(4);
const chord = norm3(PSOAS_CHORD);

/**
 * Gemelo GLSL (pasada B, detrás de `WALL_TEXTURE_GLSL`: usa hash13, valueNoise, wallOrientation, warpNormal y
 * tissueBack). `retroTexture` se aplica en la muestra del medio y en sus planos de elevación (`fieldFor` y `fieldForPh`),
 * no en la pared que copia la serie de la pleura (decisión 61, `fieldForBase`), que va en un bucle: allí no hay músculos
 * retroperitoneales.
 */
export const RETRO_TEXTURE_GLSL = /* glsl */ `
const vec4 RT_F = vec4(${f4(VISCERAL_FAT_TEXTURE.cellMm)}, ${f4(VISCERAL_FAT_TEXTURE.gain)}, ${f4(VISCERAL_FAT_TEXTURE.salt)}, ${f4(VISCERAL_FAT_TEXTURE.norm)});
const vec4 RT_A = vec4(${f4(RETRO_TEXTURE.fascicleMm)}, ${f4(RETRO_TEXTURE.septumSigmaMm)}, ${f4(RETRO_TEXTURE.septumBack)}, ${f4(RETRO_TEXTURE.segmentMm)});
const vec3 RT_B = vec3(${f4(RETRO_TEXTURE.mask[0])}, ${f4(RETRO_TEXTURE.mask[1])}, ${f4(RETRO_TEXTURE.quadratusSlant)});
const vec3 RT_CHORD = vec3(${chord.map(f4).join(', ')});
const vec4 RT_S = vec4(${f4(SINUS_TEXTURE.cellMm)}, ${f4(SINUS_TEXTURE.gain)}, ${f4(SINUS_TEXTURE.salt)}, ${f4(SINUS_TEXTURE.norm)});
vec3 retroMuscleAxis(vec3 m, int tissue) {
  float sx = m.x < 0.0 ? -1.0 : 1.0;
  return tissue == T_PSOAS ? vec3(sx * RT_CHORD.x, RT_CHORD.yz) : normalize(vec3(-sx * RT_B.z, 0.0, 1.0));
}
vec4 fascicleSeptum(vec3 m, int tissue) {
  vec3 a = retroMuscleAxis(m, tissue);
  vec3 e1 = normalize(vec3(-a.z, 0.0, a.x));
  vec3 e2 = cross(a, e1);
  float salt = float(tissue) + (m.x < 0.0 ? 0.0 : 7.0);
  vec2 q = vec2(dot(m, e1), dot(m, e2)) / RT_A.x;
  vec2 c = floor(q);
  vec2 s[9];
  int k1 = 0;
  float best = 1e9;
  for (int j = 0; j < 9; j++) {
    vec2 cell = c + vec2(float(j % 3 - 1), float(j / 3 - 1));
    s[j] = cell + vec2(hash13(vec3(cell, ${f4(SALT.u)} + salt)), hash13(vec3(cell, ${f4(SALT.v)} + salt)));
    vec2 e = s[j] - q;
    float dd = dot(e, e);
    if (dd < best) { best = dd; k1 = j; }
  }
  float dV = 1e9;
  vec2 g = vec2(1.0, 0.0);
  for (int j = 0; j < 9; j++) {
    if (j == k1) continue;
    vec2 dv = s[j] - s[k1];
    float l = length(dv);
    float dist = dot(0.5 * (s[j] + s[k1]) - q, dv) / l;
    if (dist < dV) { dV = dist; g = dv / l; }
  }
  float mask = smoothstep(RT_B.x, RT_B.y, valueNoise(vec3(q * 0.5, dot(m, a) / RT_A.w), ${f4(SALT.mask)} + salt));
  float x = dV * RT_A.x / RT_A.y;
  return vec4(g.x * e1 + g.y * e2, mask * exp(-0.5 * x * x));
}
float retroTexture(vec3 m, int tissue, vec3 dir, Warp w) {
  // lóbulos del seno renal (decisión 87, sinusLobules)
  if (tissue == T_RETROFAT || tissue == T_MESENTERIC_FAT) return RT_F.w * exp(RT_F.y * (valueNoise(m / RT_F.x, RT_F.z) - 0.5));
  if (tissue == T_RENAL_SINUS) return RT_S.w * exp(RT_S.y * (valueNoise(m / RT_S.x, RT_S.z) - 0.5));
  if (tissue != T_PSOAS && tissue != T_QUADRATUS) return 1.0;
  vec4 s = fascicleSeptum(m, tissue);
  return 1.0 + (RT_A.z / tissueBack(tissue) * wallOrientation(normalize(warpNormal(w, s.xyz)), dir) - 1.0) * s.w;
}
`;
