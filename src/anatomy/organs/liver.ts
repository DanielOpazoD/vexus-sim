import type { Vec3 } from '../../core/vec3';
import { sdEllipsoid, smoothMax, smoothMin, type Ellipsoid } from '../primitives';
import { gallbladderSdf, type GallbladderShape } from './gallbladder';
import { RENAL_IMPRESSION_OVERLAP_MM, kidneyLocal, perirenalOuterSdf, type Kidney } from './kidney';
import { umbilicalFissureSdf, type UmbilicalFissure } from './liverLigaments';

/**
 * Hígado como módulo de órgano (decisión 46): el lóbulo derecho es un elipsoide grande
 * (170 × 190 × 200 mm) del que la pared abdominal recorta la cara anterior, la cúpula la
 * superior y el plano visceral la inferior: cuña con borde agudo; el izquierdo, aplanado y
 * afilado hasta x ≈ +95. Su unión suave, la cara visceral, la impresión renal, la fosa vesicular
 * y la fisura umbilical dan el SDF, igual en TS y en GLSL (`liverSdf`). El shader usa
 * `uLiverC/R/Taper`, `uLiverLC/LR/LTaper`, `uLiverBlend` y `uVisceral` del esquema único.
 */

/**
 * Cara visceral: plano z = zAtY0 − slopeY·y (borde inferior agudo a z ≈ −83 bajo la pared
 * anterior, junto al reborde costal, y a −48 en la cara posterior); normal (0, slopeY, 1).
 */
export interface VisceralPlane {
  zAtY0: number;
  slopeY: number;
  edgeRoundMm: number;
}

/** Unión suave de los lóbulos (mm). */
export const LIVER_BLEND_MM = 30;
/** Separación mínima hígado–riñón (impresión renal, mm) y redondeo de su borde. */
export const RENAL_IMPRESSION = { roundMm: 8 } as const;
/** Redondeo del borde de la fosa vesicular (mm). */
export const GALLBLADDER_FOSSA_ROUND_MM = 2;

/**
 * Lóbulos y cara visceral para un factor de tamaño. Hepatomegalia congestiva: los radios escalan
 * con `sizeFactor` y el borde inferior desciende en proporción (≈ 1 cm por cada 10 % de tamaño).
 * Craneocaudal resultante en la línea medioclavicular ≈ 145 mm con f = 1.
 */
export function liverLobes(sizeFactor: number): { liver: Ellipsoid; liverLeft: Ellipsoid; visceralPlane: VisceralPlane } {
  const f = sizeFactor;
  return {
    liver: { kind: 'ellipsoid', center: [-70, -5, -18], radii: [85 * f, 95 * f, 100 * f], taperX: 0.12 },
    liverLeft: { kind: 'ellipsoid', center: [0, 32, -25], radii: [95 * f, 36 * f, 55 * f], taperX: 0.5 },
    visceralPlane: { zAtY0: -62 - 100 * (f - 1), slopeY: 0.35, edgeRoundMm: 12 },
  };
}

/** Lo que el SDF del hígado necesita de la escena (`AnatomyScene` lo cumple tal cual). */
export interface LiverShape {
  readonly liver: Ellipsoid;
  readonly liverLeft: Ellipsoid;
  readonly liverBlendMm: number;
  readonly visceralPlane: VisceralPlane;
  readonly kidneyRight: Kidney;
  readonly gallbladder: GallbladderShape;
  readonly gallbladderWallMm: number;
  readonly umbilicalFissure: UmbilicalFissure;
}

/** Distancia con signo a la cara visceral (positiva dentro del hígado, por encima del plano). */
export function visceralPlaneDistance(m: Vec3, vp: VisceralPlane): number {
  return (m[2] - vp.zAtY0 + vp.slopeY * m[1]) / Math.hypot(vp.slopeY, 1);
}

/** Hígado sin la fisura umbilical (lo que la fisura excava se clasifica como ligamento redondo). */
export function liverBaseSdf(m: Vec3, s: LiverShape): number {
  let d = smoothMin(sdEllipsoid(m, s.liver), sdEllipsoid(m, s.liverLeft), s.liverBlendMm);
  d = smoothMax(d, -visceralPlaneDistance(m, s.visceralPlane), s.visceralPlane.edgeRoundMm);
  // impresión renal: el hígado apoya en la cara externa de la grasa perirrenal, de grosor variable (decisión 68)
  d = smoothMax(
    d,
    -(perirenalOuterSdf(kidneyLocal(m, s.kidneyRight), s.kidneyRight) + RENAL_IMPRESSION_OVERLAP_MM),
    RENAL_IMPRESSION.roundMm,
  );
  d = smoothMax(d, -(gallbladderSdf(m, s.gallbladder) - s.gallbladderWallMm), GALLBLADDER_FOSSA_ROUND_MM);
  return d;
}

/**
 * Distancia con signo al hígado sin los recortes de cúpula y pared: unión suave de los lóbulos,
 * cara visceral en cuña, impresión renal, fosa vesicular y fisura umbilical.
 */
export function liverSdf(m: Vec3, s: LiverShape): number {
  const dBase = liverBaseSdf(m, s);
  return smoothMax(dBase, -umbilicalFissureSdf(m, dBase, s.umbilicalFissure), s.umbilicalFissure.roundMm);
}

/**
 * Gemelo GLSL; `n` es la normal de la superficie que manda y `dBase` el hígado sin fisura. La sobrecarga sin `n`
 * da la misma distancia, con los mismos términos y en el mismo orden, sin las normales de la impresión renal ni de
 * la fosa vesicular: la de `liverInner`, cuyo gradiente numérico da la cara de la cápsula (`faceGradient`).
 */
export const LIVER_GLSL = /* glsl */ `
const float RENAL_IMPRESSION_ROUND_MM = ${RENAL_IMPRESSION.roundMm.toFixed(3)};
const float RENAL_IMPRESSION_OVERLAP_MM = ${RENAL_IMPRESSION_OVERLAP_MM.toFixed(3)};
const float GALLBLADDER_FOSSA_ROUND_MM = ${GALLBLADDER_FOSSA_ROUND_MM.toFixed(3)};

float visceralPlaneDistance(vec3 m) {
  return (m.z - uVisceral.x + uVisceral.y * m.y) / length(vec2(uVisceral.y, 1.0));
}

float liverSdf(vec3 m, out vec3 n, out float dBase) {
  vec3 ln; vec3 ln2;
  float dR = sdEllipsoid(m, uLiverC, uLiverR, uLiverTaper, ln);
  float dL = sdEllipsoid(m, uLiverLC, uLiverLR, uLiverLTaper, ln2);
  float d = smoothMin(dR, dL, uLiverBlend);
  n = dL < dR ? ln2 : ln;
  float d2 = smoothMax(d, -visceralPlaneDistance(m), uVisceral.z);
  if (d2 > d + 1e-3) n = normalize(vec3(0.0, -uVisceral.y, -1.0));
  vec3 kn;
  float dk = kidneyOuter(m, 0, kn) - perirenalThicknessMm(kidneyLocal(m, 0), 0) + RENAL_IMPRESSION_OVERLAP_MM;
  float d3 = smoothMax(d2, -dk, RENAL_IMPRESSION_ROUND_MM);
  if (d3 > d2 + 1e-3) n = -kn;
  vec3 gn;
  float dg = gallbladderSdf(m, gn) - uGbExtra.y;
  float d4 = smoothMax(d3, -dg, GALLBLADDER_FOSSA_ROUND_MM);
  if (d4 > d3 + 1e-3) n = -gn;
  dBase = d4;
  float d5 = smoothMax(d4, -umbilicalFissureSdf(m, d4), FISSURE_ROUND_MM);
  if (d5 > d4 + 1e-3 && abs(m.x - uFissure.x) > uFissure.y - 1.0) n = vec3(sign(m.x - uFissure.x), 0.0, 0.0);
  return d5;
}

float liverSdf(vec3 m, out float dBase) {
  vec3 ln;
  float dR = sdEllipsoid(m, uLiverC, uLiverR, uLiverTaper, ln);
  float dL = sdEllipsoid(m, uLiverLC, uLiverLR, uLiverLTaper, ln);
  float d = smoothMin(dR, dL, uLiverBlend);
  float d2 = smoothMax(d, -visceralPlaneDistance(m), uVisceral.z);
  float dk = kidneyOuterSdf(kidneyLocal(m, 0), uKidR[0]) - perirenalThicknessMm(kidneyLocal(m, 0), 0) + RENAL_IMPRESSION_OVERLAP_MM;
  float d3 = smoothMax(d2, -dk, RENAL_IMPRESSION_ROUND_MM);
  float dg = gallbladderSdf(m) - uGbExtra.y;
  float d4 = smoothMax(d3, -dg, GALLBLADDER_FOSSA_ROUND_MM);
  dBase = d4;
  return smoothMax(d4, -umbilicalFissureSdf(m, d4), FISSURE_ROUND_MM);
}
`;
