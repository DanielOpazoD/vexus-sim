import type { Vec3 } from '../../../core/vec3';
import { psoasSdf, quadratusSdf } from '../../organs/retroperitoneum';
import type { AnatomyPerson } from '../../person';
import { Tissue } from '../../tissues';

/**
 * Masa paravertebral (decisión 328): erectores de la columna y transversoespinosos de cada lado, de la
 * torácica baja al sacro, junto a las espinosas, alrededor de láminas y transversas y hasta la cara interna de la pared.
 * Antes ese canal era grasa retroperitoneal y las transversas, rodeadas de grasa brillante, daban un peine de sombras en la
 * renal. Mismo tejido y textura que el cuadrado lumbar: músculo estriado de fibras craneocaudales. Solo con el atlas. La
 * columna, las costillas, el tórax y el diafragma ganan antes en la clasificación; el campo se cierra contra la pared, la
 * grasa perirrenal y el psoas (holgura de 1 mm), y deja 1,5 mm de grasa frente al cuadrado lumbar (la hoja anterior de la
 * fascia toracolumbar). Medidas [ESTIMADO]: sección de |x| 1 a 50 mm y de y −62 (delante de las transversas, detrás del
 * psoas) a −110 (unos 10 mm tras la punta de las espinosas), con las esquinas laterales redondeadas (12 mm); z de 0 (bajo el diafragma) a −260. Orden de magnitud: los
 * autóctonos de s0028 y s0440 entre T11 y L5, 580 y 499 cm³ (12,7 y 10,8 cm² por lado de media; 824 y 699 cm³ en todo el
 * TAC). Una persona no es una norma. No es validación clínica. Vive aquí y no en `organs/retroperitoneum` para no pesar en
 * las demás clausuras; la GLSL (`RETROPERITONEUM_GLSL`) escribe los mismos números, y `retroperitoneumRelations.test.ts` lo
 * comprueba.
 */
export const PARAVERTEBRAL = {
  xMedial: 1,
  xLateral: 50,
  yFront: -62,
  yBack: -110,
  roundMm: 12,
  zTop: 0,
  zBottom: -260,
  psoasClearanceMm: 1,
  quadratusClearanceMm: 1.5,
} as const;

/** La parte de `paravertebralSdf` que no depende del psoas ni del cuadrado: una cota inferior suya. */
function paravertebralShell(m: Vec3, insideWallMm: number, dPeriMm: number): number {
  const P = PARAVERTEBRAL,
    r = P.roundMm;
  // sección: caja de |x| ≤ xLateral entre yBack e yFront, con las esquinas laterales redondeadas
  const a = Math.abs(m[0]) - P.xLateral + r,
    b = Math.abs(m[1] - (P.yFront + P.yBack) / 2) - (P.yFront - P.yBack) / 2 + r;
  return Math.max(
    Math.min(Math.max(a, b), 0) + Math.hypot(Math.max(a, 0), Math.max(b, 0)) - r,
    P.xMedial - Math.abs(m[0]),
    Math.max(-insideWallMm, -dPeriMm) / 1.25,
    m[2] - P.zTop,
    P.zBottom - m[2],
  );
}

/**
 * Distancia con signo (cota inferior, mm; negativa dentro) a la masa paravertebral; `dPsoasMm` y `dQuadratusMm`, las del
 * psoas y el cuadrado en m. @twin organo-retroperitoneo
 */
export function paravertebralSdf(m: Vec3, insideWallMm: number, dPeriMm: number, dPsoasMm: number, dQuadratusMm: number): number {
  const P = PARAVERTEBRAL;
  return Math.max(paravertebralShell(m, insideWallMm, dPeriMm), P.psoasClearanceMm - dPsoasMm, P.quadratusClearanceMm - dQuadratusMm);
}

/**
 * La masa paravertebral sobre el resultado de `retroperitoneum` (con el atlas, m es también el punto del compartimento):
 * gana a la grasa y al intestino, y su distancia cuenta en la de ellos; el psoas y el cuadrado ya ganaron antes. Igual que
 * el gemelo GLSL. Si la cota de la caja ya supera la distancia a la frontera, ni el tejido ni la distancia cambian y no
 * se evalúan el psoas ni el cuadrado. @twin organo-retroperitoneo
 */
export function withParavertebral(
  [tissue, d]: [Tissue, number],
  m: Vec3,
  insideWallMm: number,
  dPeriMm: number,
  person?: AnatomyPerson,
): [Tissue, number] {
  if ((tissue !== Tissue.RetroperitonealFat && tissue !== Tissue.Bowel) || paravertebralShell(m, insideWallMm, dPeriMm) >= d)
    return [tissue, d];
  const dP = psoasSdf(m, person);
  const dV = paravertebralSdf(m, insideWallMm, dPeriMm, dP, quadratusSdf(m, insideWallMm, dPeriMm, person));
  return dV < 0 ? [Tissue.QuadratusLumborum, Math.min(-dV, dP)] : [tissue, Math.min(d, dV)];
}
