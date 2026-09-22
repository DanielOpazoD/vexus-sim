import type { Vec3 } from '../../core/vec3';

/**
 * Ligamentos hepáticos (decisiones 40 y 42) como MÓDULO DE ÓRGANO (Fase 2, decisión 46): la
 * geometría, su SDF en TypeScript y su gemelo GLSL viven juntos, y las constantes que el shader
 * necesita se generan desde aquí (antes el GLSL copiaba a mano el redondeo 3,0 y el semiespesor
 * 1,2). El shader usa los uniforms `uFissure`, `uLigVen` y `uLigVenBox` del esquema único.
 */

/** Fisura umbilical: lámina sagital excavada en el lóbulo izquierdo, rellena de ligamento redondo. */
export interface UmbilicalFissure {
  x: number;
  halfWidth: number;
  depthMm: number;
  zMax: number;
  roundMm: number;
}

export const UMBILICAL_FISSURE: UmbilicalFissure = { x: 15, halfWidth: 4, depthMm: 14, zMax: -30, roundMm: 3 };

/** Región de la fisura (negativa dentro): |x − xF| < hw, a < `depthMm` de la superficie, anterior y bajo zMax. */
export function umbilicalFissureSdf(m: Vec3, dBase: number, f: UmbilicalFissure = UMBILICAL_FISSURE): number {
  return Math.max(Math.abs(m[0] - f.x) - f.halfWidth, -(dBase + f.depthMm), m[2] - f.zMax, -m[1]);
}

/** Ligamento venoso: lámina fibrosa acotada entre el caudado y el segmento II. */
export interface LigamentumVenosum {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  halfMm: number;
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

export const LIGAMENTUM_VENOSUM: LigamentumVenosum = {
  a: [-30, 0, -45],
  b: [-16, 2, 40],
  c: [10, 14, -10],
  halfMm: 1.2,
  xMin: -28,
  xMax: 12,
  zMin: -42,
  zMax: 32,
};

/** Plano del ligamento venoso por sus tres puntos (normal unitaria hacia +y ≈ anterior). */
export function ligamentumVenosumPlane(l: LigamentumVenosum = LIGAMENTUM_VENOSUM): { point: Vec3; normal: Vec3 } {
  const ab: Vec3 = [l.b[0] - l.a[0], l.b[1] - l.a[1], l.b[2] - l.a[2]];
  const ac: Vec3 = [l.c[0] - l.a[0], l.c[1] - l.a[1], l.c[2] - l.a[2]];
  let n: Vec3 = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  n = [n[0] / len, n[1] / len, n[2] / len];
  if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
  return { point: l.a, normal: n };
}

/** Distancia con signo a la lámina acotada del ligamento venoso (negativa dentro). */
export function ligamentumVenosumSdf(m: Vec3, l: LigamentumVenosum = LIGAMENTUM_VENOSUM): number {
  const pl = ligamentumVenosumPlane(l);
  const d = (m[0] - pl.point[0]) * pl.normal[0] + (m[1] - pl.point[1]) * pl.normal[1] + (m[2] - pl.point[2]) * pl.normal[2];
  return Math.max(Math.abs(d) - l.halfMm, l.xMin - m[0], m[0] - l.xMax, l.zMin - m[2], m[2] - l.zMax);
}

/** Gemelo GLSL de las dos funciones anteriores (mismas fórmulas; constantes generadas). */
export const LIVER_LIGAMENTS_GLSL = /* glsl */ `
const float FISSURE_ROUND_MM = ${UMBILICAL_FISSURE.roundMm.toFixed(3)};
const float LIG_VEN_HALF_MM = ${LIGAMENTUM_VENOSUM.halfMm.toFixed(3)};

// Región de la fisura umbilical (negativa dentro); misma fórmula que umbilicalFissureSdf
float umbilicalFissureSdf(vec3 m, float dBase) {
  return max(max(abs(m.x - uFissure.x) - uFissure.y, -(dBase + uFissure.z)), max(m.z - uFissure.w, -m.y));
}

// Lámina acotada del ligamento venoso; misma fórmula que ligamentumVenosumSdf
float ligamentumVenosumSdf(vec3 m) {
  float dPl = dot(m, uLigVen.xyz) - uLigVen.w;
  return max(max(abs(dPl) - LIG_VEN_HALF_MM, uLigVenBox.x - m.x), max(max(m.x - uLigVenBox.y, uLigVenBox.z - m.z), m.z - uLigVenBox.w));
}
`;
