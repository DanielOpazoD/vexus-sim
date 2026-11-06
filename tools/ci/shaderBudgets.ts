/** Mínimo de MAX_FRAGMENT_UNIFORM_VECTORS en WebGL2; la guarda deja un 20 % de margen. */
export const WEBGL2_MIN_FRAGMENT_VECTORS = 224;
export const SLOT_GUARD = Math.floor(0.8 * WEBGL2_MIN_FRAGMENT_VECTORS);

/** Unidades de textura por shader de fragmentos garantizadas por WebGL2. */
export const SAMPLER_GUARD = 16;
