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
/**
 * `xMax`/`yMax`: huella de la LÁMINA que baja sobre el hígado con la inspiración (receso costofrénico lateral y posterior).
 * `pleuraXMax` (decisión 71): huella de la PLEURA, todo el hemitórax derecho hasta la línea media, delante, al lado y
 * detrás: donde el pulmón aireado toca la pared (la lámina, o el pulmón del tórax por encima de la inserción del
 * diafragma), la imagen es la pleura parietal con sus líneas A y su deslizamiento. Antes la pleura usaba la huella de la
 * lámina y bajo la pared torácica anterior el pulmón se dibujaba como el espejo del diafragma, sin líneas A.
 */
export const LUNG_CURTAIN = { z0: 18, thicknessMm: 3, xMax: -45, yMax: 40, pleuraXMax: 10 } as const;

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
 * pared y no del tórax bajo la cúpula. La cortina se mira antes que la cúpula en `classify`, así que basta
 * con que el punto esté en la lámina. Solo TS (pruebas y banco): la GPU usa `inLungRecess`.
 */
export function inLungCurtain(m: Vec3, insideWallMm: number, caudalMm: number): boolean {
  return lungCurtainDistance(m, insideWallMm, caudalMm) !== null;
}

/**
 * Pulmón en el receso bajo la pared (decisión 61): un punto que `classify` da como pulmón y que está a menos
 * del espesor de la cortina bajo la cara interna de la pared, en la huella del receso: el de la cortina o el
 * del tórax que toca la pared por encima de la inserción del diafragma. Allí empieza la pleura parietal (A0).
 */
export function inLungRecess(m: Vec3, insideWallMm: number): boolean {
  const c = LUNG_CURTAIN;
  return insideWallMm < c.thicknessMm && m[0] <= c.pleuraXMax;
}

/**
 * Distancia con signo (mm) de un punto de la cara interna de la pared al borde caudal del pulmón que la
 * toca, positiva hacia el pulmón, en el hemitórax derecho (x ≤ pleuraXMax, decisión 71); `null` fuera de él. En la
 * huella de la lámina (x ≤ xMax, y ≤ yMax) el borde puede ser el de la lámina; fuera, la inserción del diafragma.
 * El borde es el más bajo de la cortina (z0 − descenso) y la inserción del diafragma en ese punto (`domeZ`,
 * la altura de la cúpula: por encima, el pulmón del tórax toca la pared), z − min(z_borde, domeZ). La pasada
 * A0 la evalúa en el cruce de la pleura de cada línea: el borde blando de la cortina (decisión 61) sale de ella.
 */
export function lungCurtainEdgeMm(m: Vec3, caudalMm: number, domeZ: number): number | null {
  const c = LUNG_CURTAIN;
  if (m[0] > c.pleuraXMax) return null;
  // fuera de la lámina (la pared anterior): el borde del pulmón que toca la pared es la inserción del diafragma
  if (m[0] > c.xMax || m[1] > c.yMax) return m[2] - domeZ;
  return m[2] - Math.min(c.z0 - caudalMm, domeZ);
}

/** Gemelo GLSL: devuelve la distancia a la frontera (≥ 0) o −1 fuera de la cortina. */
export const LUNG_CURTAIN_GLSL = /* glsl */ `
float lungCurtainDistance(vec3 m, float insideWall) {
  if (insideWall < uCurtain.y && m.x <= uCurtain.z && m.y <= uCurtain.w && m.z >= uCurtain.x)
    return min(min(insideWall, uCurtain.y - insideWall), m.z - uCurtain.x);
  return -1.0;
}
const float PLEURA_X_MAX = ${LUNG_CURTAIN.pleuraXMax.toFixed(1)};
bool inLungRecess(vec3 m, float insideWall) { return insideWall < uCurtain.y && m.x <= PLEURA_X_MAX; }
float lungCurtainEdgeMm(vec3 m) {
  if (m.x > PLEURA_X_MAX) return -1e3;
  return m.x <= uCurtain.z && m.y <= uCurtain.w ? m.z - min(uCurtain.x, domeHeight(m.x, m.y)) : m.z - domeHeight(m.x, m.y);
}
`;
