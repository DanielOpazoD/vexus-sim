/**
 * Recepción de la pasada B: ruido del receptor y transitorio del transductor en el campo cercano. Una
 * sola fuente para el renderer (el uniform `uNoise`) y para el GLSL (`RECEIVER_GLSL`, interpolado).
 *
 * El transitorio es un moteado anclado a la sonda (línea, r), no al tejido, de amplitud
 * TRANSIENT_AMPLITUDE·e^(−r/TRANSIENT_DECAY_MM)·acoplamiento [EXTRAPOLACIÓN PROPIA]. Cae por debajo del
 * ruido del receptor hacia los 29 mm, pero la pasada B lo calculaba en toda la profundidad (un campo de
 * dispersores más por muestra). Ahora se omite desde TRANSIENT_SKIP_MM, donde su escala es la décima
 * parte de la del ruido (−20 dB) en el punto en que ambos se suman, antes de la PSF: ahí lo que se deja
 * de sumar es ≤ ruido/10. Las pasadas C y D (núcleos de energía unidad) no cambian la potencia del ruido,
 * que es blanco, pero sí dan ganancia coherente al transitorio, correlacionado en profundidad: en la
 * imagen lo omitido llega a ≈ ruido/7 (−17 dB) con 60 mm de profundidad seleccionada (la mínima, el peor
 * caso), ruido/8 con 90 mm y ruido/14 con 240 mm. El suelo de ruido sube así ≤ 0,1 dB a partir del corte,
 * y el ruido, nuevo en cada cuadro, lo tapa (`receiver.test.ts`).
 */

/**
 * Ruido del receptor (escala del gaussiano complejo por componente) ≈ −72 dB respecto al eco hepático
 * sin atenuar; con el techo de compensación el campo profundo queda como «nieve» gris oscura
 * [EXTRAPOLACIÓN PROPIA].
 */
export const RECEIVER_NOISE = 2.5e-4;
/** Amplitud del transitorio en la cara del transductor (misma escala que el ruido). */
export const TRANSIENT_AMPLITUDE = 0.35;
/** Decaimiento del transitorio con la profundidad (mm). */
export const TRANSIENT_DECAY_MM = 4;
/** Fracción del ruido del receptor bajo la que el transitorio se omite (−20 dB al sumarse, antes de la PSF). */
export const TRANSIENT_SKIP_NOISE_FRACTION = 0.1;
/**
 * Profundidad desde la que la pasada B omite el transitorio: donde su escala vale
 * TRANSIENT_SKIP_NOISE_FRACTION × el ruido del receptor al sumarse (antes de la PSF),
 * D·ln(A / (f·ruido)) = 38,2 mm.
 */
export const TRANSIENT_SKIP_MM = TRANSIENT_DECAY_MM * Math.log(TRANSIENT_AMPLITUDE / (TRANSIENT_SKIP_NOISE_FRACTION * RECEIVER_NOISE));

/** Escala del transitorio a la profundidad `rMm` sin el acoplamiento (≤ 1), la que multiplica al campo. */
export function transientScale(rMm: number): number {
  return TRANSIENT_AMPLITUDE * Math.exp(-rMm / TRANSIENT_DECAY_MM);
}

/**
 * Literal GLSL de un número de TS: los enteros con punto decimal (GLSL ES 3.0 no convierte int en
 * float) y el resto con todos sus dígitos, para que el float32 del shader sea el de TS.
 */
export const glslFloat = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** Constantes del transitorio para la pasada B (`FRAG_RAWFIELD`). */
export const RECEIVER_GLSL = /* glsl */ `
const float TRANSIENT_AMPLITUDE = ${glslFloat(TRANSIENT_AMPLITUDE)};
const float TRANSIENT_DECAY_MM = ${glslFloat(TRANSIENT_DECAY_MM)};
const float TRANSIENT_SKIP_MM = ${glslFloat(TRANSIENT_SKIP_MM)};
`;
