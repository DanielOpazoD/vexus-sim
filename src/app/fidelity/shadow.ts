/**
 * Sombra ósea del banco: su resumen en la imagen mostrada (`ShadowStats`) y el fin de la umbra en un perfil de la
 * transmisión de la pasada A.
 */

/**
 * Sombra ósea en la imagen mostrada: tejido blando 10–40 mm detrás del primer hueso de la línea.
 * El núcleo son las líneas cuya vecindad ±3 también toca hueso; el perfil del borde da el nivel
 * (dB bajo el techo) a −4…+4 líneas del borde geométrico de cada sombra (negativo = fuera, 0 = la
 * primera línea que toca hueso), promediado entre bordes: un escalón es una sombra de un solo
 * rayo; una rampa, la penumbra de la apertura.
 */
export interface ShadowStats {
  coreLines: number;
  /** Nivel del hígado puro menos el del núcleo de la sombra (dB): una sombra limpia llega al suelo. */
  coreDbBelowLiver: number;
  coreGray: number;
  edgeProfileDb: number[];
  /**
   * Fin de la umbra (mm tras la cara del hueso) en la transmisión de la pasada A, sin ruido: la mediana
   * sobre las líneas del núcleo, en pasos de 1 mm, de la transmisión con apertura respecto a la del hígado
   * (la del rayo justo antes del hueso con la atenuación del hígado desde ahí) sube de −40 dB (`umbraEndMm`).
   * De la mirada 0 y, con las miradas del anillo (decisión 58), del compuesto (media de sus transmisiones);
   * `umbraShiftMm` = mirada 0 − compuesto, NaN si la mirada 0 no sale de −40 dB antes de 40 mm.
   */
  umbraEndLook0Mm: number;
  umbraEndCompoundMm: number;
  umbraShiftMm: number;
}

/** Nivel respecto al hígado que marca el fin de la umbra (dB) y alcance de la búsqueda tras el hueso (mm). */
export const UMBRA_DB = -40;
export const UMBRA_SEARCH_MM = 40;

/**
 * Fin de la umbra en un perfil (dB respecto al hígado cada 1 mm tras el hueso, desde 0): el primer cruce de
 * `UMBRA_DB` hacia arriba, interpolado en dB; NaN si no sale de la umbra (o nunca estuvo en ella).
 */
export function umbraEndMm(profileDb: readonly number[], stepMm = 1, threshold = UMBRA_DB): number {
  for (let i = 1; i < profileDb.length; i++) {
    const a = profileDb[i - 1];
    const b = profileDb[i];
    if (a < threshold && b >= threshold) return (i - 1 + (threshold - a) / (b - a)) * stepMm;
  }
  return Number.NaN;
}
