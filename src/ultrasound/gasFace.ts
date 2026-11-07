import { glslFloat } from './receiver';
import { valueNoise } from './speckleField';
import type { Vec3 } from '../core/vec3';

/**
 * Cara y sombra sucia del gas intestinal (decisión 325). Antes, el primer gas de una línea (A0, tipo 2) solo apagaba lo
 * de detrás: la mucosa contra el gas no tenía cara (`classify` no da interfaz al gas), así que el gas era una columna
 * negra de techo liso con una cola de ecos uniforme en todas las líneas, igual que la sombra limpia de un hueso.
 *
 * En una ecografía real la interfaz tejido/gas refleja casi toda la energía (la R de la pleura, tejido/aire), pero no
 * es lisa: burbujas, pliegues y contenido mezclado la rompen en tramos brillantes y huecos, a profundidades algo
 * distintas; detrás, la sombra es «sucia» (reverberaciones entre burbujas) y en algunos puntos nace una cola de cometa.
 *
 * Modelo [EXTRAPOLACIÓN PROPIA]: tres ruidos de valor anclados al cuerpo en el punto del primer gas de la línea (celdas
 * de `cellMm` y `streakCellMm`, como las facetas de las caras, decisión 65) dan, por línea,
 *  - dónde cae la cara dentro del segmento grueso de A0 en que empieza el gas (el gas empieza en (gasHit − paso, gasHit]),
 *  - la ganancia de su eco, de `faceMin` a 1, con el perfil y la amplitud de la pleura (`IF_PLEURA`, tejido/aire) en
 *    incidencia normal,
 *  - si la línea lleva una estría de la sombra sucia (cola de cometa): la cola incoherente de siempre (`tailBase`, la
 *    de antes) crece hasta `tailBase + tailStreak` y se modula en bandas de `ringDownMm` (reverberación dentro de las
 *    burbujas).
 * El hueso no cambia: su sombra limpia sigue siendo la de las decisiones 54, 88 y 91.
 */
export const GAS_FACE = {
  /** Celda (mm) del ruido de la cara: el tamaño de burbujas y pliegues [ESTIMADO, 2–5 mm]. */
  cellMm: 2.5,
  /** Celda (mm) del ruido de las estrías de la sombra sucia [ESTIMADO]. */
  streakCellMm: 3,
  /** Ganancia mínima del eco de la cara (−16 dB): los huecos entre tramos brillantes [ESTIMADO]. */
  faceMin: 0.15,
  /** Cola incoherente sin estría: la de antes de la decisión 325 (~−10 dB del parénquima junto al gas). */
  tailBase: 0.3,
  /** Lo que añade una estría (cola de cometa) a la cola [ESTIMADO: +11 dB en el pico de sus bandas, +6 de media]. */
  tailStreak: 0.75,
  /** Periodo (mm) de las bandas de la estría: reverberación en burbujas de ~1 mm [ESTIMADO]. */
  ringDownMm: 1.5,
  /** Sal de los ruidos (ajena a las de las facetas). */
  salt: 71.3,
} as const;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Gemelo de `bowelGas` (GLSL): para el punto del primer gas `pGas` (mm) y el paso de A0, el retroceso de la cara desde
 * gasHit hacia la sonda (mm, en [0, paso)), la ganancia de su eco y el peso de la estría (0–1).
 * @twin gas-intestinal
 */
export function bowelGas(pGas: Vec3, stepMm: number): [number, number, number] {
  const q: Vec3 = [pGas[0] / GAS_FACE.cellMm, pGas[1] / GAS_FACE.cellMm, pGas[2] / GAS_FACE.cellMm];
  const qs: Vec3 = [pGas[0] / GAS_FACE.streakCellMm, pGas[1] / GAS_FACE.streakCellMm, pGas[2] / GAS_FACE.streakCellMm];
  const u = valueNoise(q, GAS_FACE.salt);
  const v = valueNoise(q, GAS_FACE.salt + 7);
  const w = valueNoise(qs, GAS_FACE.salt + 13);
  return [smooth(0.2, 0.8, v) * stepMm, GAS_FACE.faceMin + (1 - GAS_FACE.faceMin) * smooth(0.3, 0.7, u), smooth(0.55, 0.75, w)];
}

/** Gemelo de `bowelGasTail` (GLSL): la ganancia de la cola sucia a d mm bajo el gas con el peso de estría `streak`. @twin gas-intestinal */
export function bowelGasTail(streak: number, d: number): number {
  const band = 0.55 + 0.45 * Math.cos((2 * Math.PI * d) / GAS_FACE.ringDownMm);
  return (GAS_FACE.tailBase + GAS_FACE.tailStreak * streak) * (1 + (band - 1) * streak);
}

/** Pasada B (las dos miradas). Necesita `valueNoise` (`SPECKLE_TISSUE_GLSL`). @twin gas-intestinal */
export const BOWEL_GAS_GLSL = /* glsl */ `
// Cara y sombra sucia del gas intestinal (decisión 325, gasFace.ts): (retroceso de la cara desde gasHit, ganancia de su
// eco, peso de la estría), de tres ruidos anclados al cuerpo en el punto del primer gas
vec3 bowelGas(vec3 p, float step) {
  vec3 q = p / ${glslFloat(GAS_FACE.cellMm)};
  float u = valueNoise(q, ${glslFloat(GAS_FACE.salt)});
  float v = valueNoise(q, ${glslFloat(GAS_FACE.salt + 7)});
  float w = valueNoise(p / ${glslFloat(GAS_FACE.streakCellMm)}, ${glslFloat(GAS_FACE.salt + 13)});
  return vec3(smoothstep(0.2, 0.8, v) * step, ${glslFloat(GAS_FACE.faceMin)} + ${glslFloat(1 - GAS_FACE.faceMin)} * smoothstep(0.3, 0.7, u), smoothstep(0.55, 0.75, w));
}
float bowelGasTail(float w, float d) {
  float band = 0.55 + 0.45 * cos(6.2831853 * d / ${glslFloat(GAS_FACE.ringDownMm)});
  return (${glslFloat(GAS_FACE.tailBase)} + ${glslFloat(GAS_FACE.tailStreak)} * w) * (1.0 + (band - 1.0) * w);
}
`;
