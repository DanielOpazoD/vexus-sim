import type { Vec3 } from '../../core/vec3';
import { orthonormalBasis, sdOrientedEllipsoid, type OrientedEllipsoid } from '../primitives';

/**
 * Vesícula biliar como módulo de órgano (decisiones 41 y 46): pera en su fosa (cara visceral
 * entre IV y V) con fondo anteroinferolateral que asoma bajo el reborde hepático y cuello
 * posterosuperomedial hacia el hilio. El eje u apunta del fondo al cuello; el afilamiento 0,45
 * deja el fondo ≈ 16 mm de radio y el cuello ≈ 6 mm. El shader usa `uGbC/R/U/V/W` y `uGbExtra`
 * del esquema único de uniforms.
 */

/** Pared vesicular (mm), ecogénica, entre la luz anecoica y la fosa. */
export const GALLBLADDER_WALL_MM = 1.5;

/** Luz vesicular del adulto de referencia. */
export function gallbladderBody(): OrientedEllipsoid {
  const b = orthonormalBasis([0.56, -0.56, 0.61], [0, 1, 0]);
  return { kind: 'oriented-ellipsoid', center: [-58, 36, -62], radii: [40, 11, 11], u: b.u, v: b.v, w: b.w, taperU: 0.45 };
}

/** Distancia con signo a la luz vesicular (negativa dentro; la pared va de 0 a `wallMm`). */
export function gallbladderSdf(m: Vec3, body: OrientedEllipsoid): number {
  return sdOrientedEllipsoid(m, body);
}

/** Gemelo GLSL, con la normal del contorno. */
export const GALLBLADDER_GLSL = /* glsl */ `
float gallbladderSdf(vec3 m, out vec3 n) {
  return sdOrientedEllipsoid(m, uGbC, uGbR, uGbU, uGbV, uGbW, uGbExtra.x, n);
}
`;
