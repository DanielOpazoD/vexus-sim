import type { Vec3 } from '../../core/vec3';
import { Tissue } from '../tissues';
import { sdRoundCone } from './kidney';

/**
 * Retroperitoneo (decisión 81) como módulo de órgano (decisión 46): el psoas mayor y el cuadrado lumbar de los dos
 * lados y la grasa retroperitoneal (pararrenal anterior y posterior, perivascular) que llena lo que queda detrás del
 * peritoneo parietal posterior. Antes todo lo que no era órgano modelado era «resto» con la textura de asas (decisión
 * 74), también detrás del riñón y junto a la columna. Simétricos en x (el marco es levógiro: x < 0 es la derecha del
 * paciente); las constantes del shader salen de aquí.
 *
 * Niveles vertebrales del modelo [ESTIMADO]: z = 0 en la punta del xifoides (T9–T10), el hilio hepático en T12–L1 (z ≈
 * −45) y ~35 mm por nivel lumbar: L1 ≈ −63, L2 ≈ −97, L3 ≈ −131, L4 ≈ −165, L5 ≈ −200, S1 ≈ −232.
 */

/**
 * Psoas mayor: cadena de conos redondeados por su eje, del lado derecho y con |x| (el izquierdo es su espejo). Nace de
 * las caras laterales de T12–L5 y de sus apófisis transversas (Gray; Radiopaedia): fino arriba y ancho abajo, por delante
 * de las transversas y pegado al cuerpo vertebral, se separa de él y avanza hacia fuera y adelante hasta el estrecho
 * superior de la pelvis. Radio por nivel desde el área de sección publicada [LITERATURA, orden de magnitud: la de los
 * dos psoas en L3 del adulto sano, ~12–15 cm² en la mujer y ~20 en el varón, con cortes de sarcopenia de ~10 y ~19 cm²]
 * y [ESTIMADO] para cada nodo: 5 mm en T12–L1, 10,5 en L2, 16 en L3, 18 en L4 y 15 en S1 (por lado, 1,8 cm² en L1, 8,0
 * en L3 y 10,2 en L4: un adulto medio). Entre el cuerpo vertebral (40 × 29 mm en el modelo desde la decisión 92: su costado
 * queda a 20 mm de la línea media, antes a 17, así que el nodo de T12–L1 se aparta 3 mm y el de L2, 1,4 mm con 1,5 mm menos
 * de radio: a ≥ 0,5 mm del hueso y de la grasa perirrenal) y la aorta o la VCI por delante y las transversas (el arco, de y
 * −58 a −78) por detrás.
 */
export const PSOAS_NODES: ReadonlyArray<readonly [number, number, number, number]> = [
  [25, -52, -45, 5],
  [31.4, -46.5, -97, 10.5],
  [37, -41, -131, 16],
  [40, -39, -165, 18],
  [51, -30, -240, 15],
];

/**
 * Cuadrado lumbar: lámina muscular contra la cara interna de la pared posterior, lateral al psoas, de la 12.ª costilla
 * a la cresta ilíaca, entre la punta de las apófisis transversas y su borde lateral (más ancho abajo). Grosor
 * anteroposterior de 8 mm arriba a 14 mm en L3 [ESTIMADO sobre 1–2 cm de las guías del bloqueo del cuadrado lumbar].
 * Donde el riñón apoya en la pared (su grasa perirrenal gruesa de detrás, decisión 68, llega a ella) el músculo le
 * deja sitio: el modelo tiene la pared posterior de 28 mm y el riñón más cerca de la piel que en un adulto real. Lo
 * decide el orden de `classify` (el riñón y su grasa van antes); el término de la grasa en `quadratusSdf` deja su
 * distancia fuera de ella y hace que la distancia a la frontera la cuente.
 */
export const QUADRATUS = {
  /** z del borde craneal (12.ª costilla) y caudal (cresta ilíaca). */
  zTop: -45,
  zBottom: -190,
  /** |x| del borde medial (punta de las transversas: el arco de la columna llega a 40 mm). */
  xMedial: 41,
  /** |x| del borde lateral arriba y abajo. */
  xLateralTop: 72,
  xLateralBottom: 94,
  /** Grosor (mm, desde la cara interna de la pared) arriba y máximo (hacia L3, z = zPeak). */
  thicknessTop: 8,
  thicknessMax: 14,
  zPeak: -130,
  /** Solo en la pared posterior: y por debajo de este valor. */
  yMax: -30,
} as const;

/**
 * Compartimento retroperitoneal: detrás del peritoneo parietal posterior, y < yPeri(|x|, z). Por delante de los grandes
 * vasos y del riñón (y = frontY en |x| ≤ xFront) y hacia fuera baja hasta la pared lateral detrás de la línea axilar
 * posterior (el espacio pararrenal posterior se continúa con la grasa preperitoneal del flanco); bajo los riñones
 * (z < zLow) solo queda la gotera paravertebral (y < yLow). Lo de delante es el «resto» con sus asas (duodeno, colon,
 * intestino delgado). [ESTIMADO sobre la anatomía seccional: Meyers, radiología del retroperitoneo.]
 */
export const RETRO_FAT = {
  frontY: -4,
  xFront: 70,
  /** |x| donde el borde anterior llega a yLateral, en la pared lateral detrás de la línea axilar posterior. */
  xLateral: 132,
  yLateral: -45,
  /** Por debajo de zLow el borde baja a yLow (hasta zLow − zRamp). */
  zLow: -150,
  zRamp: 50,
  yLow: -30,
} as const;

const smooth01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Distancia con signo al psoas más cercano (mm; negativa dentro). */
export function psoasSdf(m: Vec3): number {
  const q: Vec3 = [Math.abs(m[0]), m[1], m[2]];
  let d = 1e3;
  for (let i = 0; i + 1 < PSOAS_NODES.length; i++) {
    const a = PSOAS_NODES[i];
    const b = PSOAS_NODES[i + 1];
    d = Math.min(d, sdRoundCone(q, [a[0], a[1], a[2]], [b[0], b[1], b[2]], a[3], b[3]));
  }
  return d;
}

/**
 * Cotas de la norma del gradiente de los términos del cuadrado que no son planos: la profundidad bajo la pared es la
 * métrica radial del tronco (|∇| ≤ 1,21 en la franja del músculo, medida en los tres casos), la cara externa de la grasa
 * perirrenal no es euclídea (≤ 1,18 en la franja del músculo; hasta 2,7 junto al hilio, lejos de él) y el borde lateral
 * se inclina con z. Divididos por ellas, el máximo es una cota inferior de la distancia (la del gate volumétrico).
 */
const QL_LIPSCHITZ = {
  wall: 1.25,
  peri: 1.25,
  lateral: Math.hypot(1, (QUADRATUS.xLateralBottom - QUADRATUS.xLateralTop) / (QUADRATUS.zTop - QUADRATUS.zBottom)),
};

/**
 * Distancia (cota inferior, mm; negativa dentro) al cuadrado lumbar. `insideWallMm`, la profundidad bajo la cara interna
 * de la pared; `dPeriMm`, la distancia a la cara externa de la grasa perirrenal (el músculo le deja sitio).
 */
export function quadratusSdf(m: Vec3, insideWallMm: number, dPeriMm: number): number {
  const Q = QUADRATUS;
  const L = QL_LIPSCHITZ;
  const ax = Math.abs(m[0]);
  const f = (Q.zTop - m[2]) / (Q.zTop - Q.zBottom);
  const xLat = Q.xLateralTop + (Q.xLateralBottom - Q.xLateralTop) * f;
  const t = Q.thicknessTop + (Q.thicknessMax - Q.thicknessTop) * smooth01((Q.zTop - m[2]) / (Q.zTop - Q.zPeak));
  return Math.max(
    (insideWallMm - t) / L.wall,
    Q.xMedial - ax,
    (ax - xLat) / L.lateral,
    m[2] - Q.zTop,
    Q.zBottom - m[2],
    m[1] - Q.yMax,
    -dPeriMm / L.peri,
  );
}

/** Borde anterior del compartimento retroperitoneal, y (mm), en (|x|, z). */
export function retroFrontY(ax: number, z: number): number {
  const R = RETRO_FAT;
  const lat = smooth01((ax - R.xFront) / (R.xLateral - R.xFront));
  const y = R.frontY + (R.yLateral - R.frontY) * lat;
  return y + (Math.min(y, R.yLow) - y) * smooth01((R.zLow - z) / R.zRamp);
}

/**
 * Pendiente máxima del borde anterior (|∂y/∂x|, |∂y/∂z| del smoothstep, 1,5 veces la media): la distancia al borde es
 * al menos |y − yPeri| / √(1 + gx² + gz²).
 */
const RETRO_FRONT_LIPSCHITZ = Math.hypot(
  1,
  (1.5 * (RETRO_FAT.frontY - RETRO_FAT.yLateral)) / (RETRO_FAT.xLateral - RETRO_FAT.xFront),
  (1.5 * (RETRO_FAT.frontY - RETRO_FAT.yLateral)) / RETRO_FAT.zRamp,
);

/** Distancia con signo (cota inferior, mm) al borde anterior del compartimento retroperitoneal: negativa dentro. */
export function retroFatSdf(m: Vec3): number {
  const ax = Math.abs(m[0]);
  return Math.max((m[1] - retroFrontY(ax, m[2])) / RETRO_FRONT_LIPSCHITZ, ax - RETRO_FAT.xLateral);
}

/**
 * Lo que no es órgano (decisión 81): psoas, cuadrado lumbar, grasa retroperitoneal o, delante del peritoneo parietal
 * posterior, el «resto» (intestino). Devuelve el tejido y la distancia a la frontera más cercana entre ellos (el psoas
 * gana al cuadrado y los dos a la grasa). `insideWallMm` y `dPeriMm`, como en `quadratusSdf`.
 */
export function retroperitoneum(m: Vec3, insideWallMm: number, dPeriMm: number): [Tissue, number] {
  const dP = psoasSdf(m);
  if (dP < 0) return [Tissue.Psoas, -dP];
  const dQ = quadratusSdf(m, insideWallMm, dPeriMm);
  if (dQ < 0) return [Tissue.QuadratusLumborum, Math.min(-dQ, dP)];
  const dF = retroFatSdf(m);
  return dF < 0 ? [Tissue.RetroperitonealFat, Math.min(-dF, dP, dQ)] : [Tissue.Bowel, Math.min(dF, dP, dQ)];
}

const f4 = (v: number): string => v.toFixed(4);
const Q = QUADRATUS;
const R = RETRO_FAT;

/**
 * Gemelo GLSL (usa `sdRoundCone` del riñón): `retroperitoneum` devuelve el tejido (T_PSOAS, T_QUADRATUS, T_RETROFAT o
 * T_BOWEL) y su distancia a la frontera en `bd`.
 */
export const RETROPERITONEUM_GLSL = /* glsl */ `
const vec4 PSOAS[${PSOAS_NODES.length}] = vec4[${PSOAS_NODES.length}](${PSOAS_NODES.map((n) => `vec4(${n.map(f4).join(', ')})`).join(', ')});
const vec4 QL_Z = vec4(${f4(Q.zTop)}, ${f4(Q.zBottom)}, ${f4(Q.zPeak)}, ${f4(Q.yMax)});
const vec4 QL_X = vec4(${f4(Q.xMedial)}, ${f4(Q.xLateralTop)}, ${f4(Q.xLateralBottom)}, 0.0);
const vec2 QL_T = vec2(${f4(Q.thicknessTop)}, ${f4(Q.thicknessMax)});
const vec3 QL_L = vec3(${f4(QL_LIPSCHITZ.wall)}, ${f4(QL_LIPSCHITZ.peri)}, ${f4(QL_LIPSCHITZ.lateral)});
const vec4 RF_A = vec4(${f4(R.frontY)}, ${f4(R.xFront)}, ${f4(R.xLateral)}, ${f4(R.yLateral)});
const vec4 RF_B = vec4(${f4(R.zLow)}, ${f4(R.zRamp)}, ${f4(R.yLow)}, ${f4(RETRO_FRONT_LIPSCHITZ)});
float psoasSdf(vec3 m) {
  vec3 q = vec3(abs(m.x), m.yz);
  float d = 1e3;
  for (int i = 0; i < ${PSOAS_NODES.length - 1}; i++) d = min(d, sdRoundCone(q, PSOAS[i].xyz, PSOAS[i + 1].xyz, PSOAS[i].w, PSOAS[i + 1].w));
  return d;
}
float quadratusSdf(vec3 m, float insideWall, float dPeri) {
  float ax = abs(m.x);
  float f = (QL_Z.x - m.z) / (QL_Z.x - QL_Z.y);
  float t = QL_T.x + (QL_T.y - QL_T.x) * smoothstep(0.0, 1.0, (QL_Z.x - m.z) / (QL_Z.x - QL_Z.z));
  float d = max(max((insideWall - t) / QL_L.x, QL_X.x - ax), max((ax - (QL_X.y + (QL_X.z - QL_X.y) * f)) / QL_L.z, m.z - QL_Z.x));
  return max(max(d, QL_Z.y - m.z), max(m.y - QL_Z.w, -dPeri / QL_L.y));
}
float retroFrontY(float ax, float z) {
  float y = RF_A.x + (RF_A.w - RF_A.x) * smoothstep(0.0, 1.0, (ax - RF_A.y) / (RF_A.z - RF_A.y));
  return y + (min(y, RF_B.z) - y) * smoothstep(0.0, 1.0, (RF_B.x - z) / RF_B.y);
}
float retroFatSdf(vec3 m) {
  float ax = abs(m.x);
  return max((m.y - retroFrontY(ax, m.z)) / RF_B.w, ax - RF_A.z);
}
int retroperitoneum(vec3 m, float insideWall, float dPeri, out float bd) {
  float dP = psoasSdf(m);
  bd = -dP;
  if (dP < 0.0) return T_PSOAS;
  float dQ = quadratusSdf(m, insideWall, dPeri);
  bd = min(-dQ, dP);
  if (dQ < 0.0) return T_QUADRATUS;
  float dF = retroFatSdf(m);
  bd = min(abs(dF), min(dP, dQ));
  return dF < 0.0 ? T_RETROFAT : T_BOWEL;
}
`;
