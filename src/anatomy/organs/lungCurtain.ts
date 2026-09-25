import type { Vec3 } from '../../core/vec3';

/**
 * Cortina pulmonar (decisión 43) como módulo de órgano (decisión 46): el pulmón entra en el
 * receso costofrénico lateral y posterior derecho como una lámina de 3 mm pegada a la cara
 * interna de la pared, desde la cúpula hasta z = z0 − descenso diafragmático. En inspiración
 * baja y tapa la parte alta del hígado. Su cara superior es la pleura parietal: la imagen la dibuja
 * con su eco, la serie de reverberaciones de la pared y el deslizamiento (decisión 61,
 * `ultrasound/pleura.ts`), no con el espejo del diafragma.
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

/**
 * Pulmón de la cortina (decisión 61): un punto que `classify` da como pulmón es de la lámina bajo la
 * pared (la pleura parietal) y no del tórax bajo la cúpula (el espejo del diafragma, decisión 57). La
 * cortina se mira antes que la cúpula en `classify`, así que basta con que el punto esté en la lámina.
 */
export function inLungCurtain(m: Vec3, insideWallMm: number, caudalMm: number): boolean {
  return lungCurtainDistance(m, insideWallMm, caudalMm) !== null;
}

/**
 * Distancia con signo (mm) de un punto de la cara interna de la pared al borde caudal de la cortina,
 * positiva hacia el pulmón (z − z_borde), dentro de la huella del receso (x ≤ xMax, y ≤ yMax); `null`
 * fuera de ella. La pasada A0 la evalúa en el cruce de la pleura de cada línea: el borde blando de la
 * cortina (decisión 61) sale de ella.
 */
export function lungCurtainEdgeMm(m: Vec3, caudalMm: number): number | null {
  const c = LUNG_CURTAIN;
  if (m[0] > c.xMax || m[1] > c.yMax) return null;
  return m[2] - (c.z0 - caudalMm);
}

/** Gemelo GLSL: devuelve la distancia a la frontera (≥ 0) o −1 fuera de la cortina. */
export const LUNG_CURTAIN_GLSL = /* glsl */ `
float lungCurtainDistance(vec3 m, float insideWall) {
  if (insideWall < uCurtain.y && m.x <= uCurtain.z && m.y <= uCurtain.w && m.z >= uCurtain.x)
    return min(min(insideWall, uCurtain.y - insideWall), m.z - uCurtain.x);
  return -1.0;
}
bool inLungCurtain(vec3 m, float insideWall) { return lungCurtainDistance(m, insideWall) >= 0.0; }
float lungCurtainEdgeMm(vec3 m) { return m.x <= uCurtain.z && m.y <= uCurtain.w ? m.z - uCurtain.x : -1e3; }
`;
