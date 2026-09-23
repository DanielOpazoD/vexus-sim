/**
 * Curva de grises de la presentación (pasada de conversión de barrido, `FRAG_SCANCONVERT`):
 *
 *   g = ((1 + c)^y − 1) / c,   y = nivel en el rango dinámico (0 = suelo, 1 = techo)
 *
 * Expande el extremo brillante: la desviación del gris crece con el nivel, como en las imágenes
 * reales (EchoTwin, decisión 90). Una sola constante para el shader y para el banco de fidelidad,
 * que invierte la curva para medir la imagen mostrada en dB.
 */
export const GREY_CURVE = 3.5;

/** Gris (0–1) de un nivel normalizado y (0–1). */
export function greyOfLevel(y: number, c: number = GREY_CURVE): number {
  return (Math.pow(1 + c, y) - 1) / c;
}

/** Nivel normalizado y (0–1) de un gris (0–1): inversa de `greyOfLevel`. */
export function levelOfGrey(g: number, c: number = GREY_CURVE): number {
  return Math.log(1 + c * g) / Math.log(1 + c);
}
