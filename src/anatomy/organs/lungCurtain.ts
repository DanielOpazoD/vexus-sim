import type { Vec3 } from '../../core/vec3';

/**
 * Cortina pulmonar (decisión 43) como módulo de órgano (decisión 46): el pulmón entra en el
 * receso costofrénico lateral y posterior derecho como una lámina de 3 mm pegada a la cara
 * interna de la pared, desde la cúpula hasta z = z0 − descenso diafragmático. En inspiración
 * baja y tapa la parte alta del hígado; el rayo que la toca se refleja y deja líneas A.
 * TS y GLSL (uniform `uCurtain` del esquema único) viven aquí juntos.
 */
export const LUNG_CURTAIN = { z0: 18, thicknessMm: 3, xMax: -45, yMax: 40 } as const;

/**
 * Distancia a la frontera si el punto está dentro de la cortina, `null` si no. `insideWallMm` es
 * la profundidad bajo la cara interna de la pared; `caudalMm`, el descenso diafragmático.
 */
export function lungCurtainDistance(m: Vec3, insideWallMm: number, caudalMm: number): number | null {
  const c = LUNG_CURTAIN;
  if (insideWallMm >= c.thicknessMm || m[0] > c.xMax || m[1] > c.yMax) return null;
  const zEdge = c.z0 - caudalMm;
  if (m[2] < zEdge) return null;
  return Math.min(insideWallMm, c.thicknessMm - insideWallMm, m[2] - zEdge);
}

/** Gemelo GLSL: devuelve la distancia a la frontera (≥ 0) o −1 fuera de la cortina. */
export const LUNG_CURTAIN_GLSL = /* glsl */ `
float lungCurtainDistance(vec3 m, float insideWall) {
  if (insideWall < uCurtain.y && m.x <= uCurtain.z && m.y <= uCurtain.w && m.z >= uCurtain.x)
    return min(min(insideWall, uCurtain.y - insideWall), m.z - uCurtain.x);
  return -1.0;
}
`;
