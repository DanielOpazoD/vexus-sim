import type { Vec3 } from '../core/vec3';
import { bowelSdf } from '../anatomy/organs/bowel';

/** Perfil intramural estimado: muscular hipoecoica, submucosa ecogénica y mucosa hipoecoica.
 * Las interfaces serosa/grasa y mucosa/luz las dibuja interfaceEcho; la PSF decide qué se resuelve.
 * Sustituye las falsas asas de ruido de la decisión 74: no crea anatomía dependiente de la semilla. */
export const REST_TEXTURE = {
  muscularisEndMm: 0.65,
  submucosaEndMm: 1.1,
  edgeMm: 0.08,
  muscularisBack: 0.38,
  submucosaBack: 2.2,
  mucosaBack: 0.45,
} as const;
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function bowelWallProfile(depthMm: number): number {
  const p = REST_TEXTURE,
    e = p.edgeMm;
  let v = p.muscularisBack as number;
  v += (p.submucosaBack - v) * smooth(p.muscularisEndMm - e, p.muscularisEndMm + e, depthMm);
  return v + (p.mucosaBack - v) * smooth(p.submucosaEndMm - e, p.submucosaEndMm + e, depthMm);
}
/** Solo para muestras clasificadas como pared intestinal. Profundidad desde su superficie exterior. */
export function restTexture(m: Vec3, radii?: ArrayLike<number>): number {
  return bowelWallProfile(-bowelSdf(m, radii));
}
export const REST_TEXTURE_GLSL = /* glsl */ `
float bowelWallProfile(float d){
  float v=mix(${REST_TEXTURE.muscularisBack.toFixed(3)},${REST_TEXTURE.submucosaBack.toFixed(3)},smoothstep(${(REST_TEXTURE.muscularisEndMm - REST_TEXTURE.edgeMm).toFixed(3)},${(REST_TEXTURE.muscularisEndMm + REST_TEXTURE.edgeMm).toFixed(3)},d));
  return mix(v,${REST_TEXTURE.mucosaBack.toFixed(3)},smoothstep(${(REST_TEXTURE.submucosaEndMm - REST_TEXTURE.edgeMm).toFixed(3)},${(REST_TEXTURE.submucosaEndMm + REST_TEXTURE.edgeMm).toFixed(3)},d));
}
float restTexture(vec3 m) { return bowelWallProfile(-bowelSdf(m)); }
`;
