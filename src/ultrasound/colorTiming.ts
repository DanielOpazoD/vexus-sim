export const COLOR_LINE_SPACING_RAD = (1.0 * Math.PI) / 180; // densidad de líneas de color (1° en un convexo)
export const COLOR_PACKET_MM = 1.0; // longitud axial de la celda (paquete) de color

export function colorLineCount(theta0: number, theta1: number, spacingRad = COLOR_LINE_SPACING_RAD): number {
  return Math.max(4, Math.ceil(Math.abs(theta1 - theta0) / spacingRad));
}

export interface ColorTiming {
  lines: number;
  /** Tiempo de los pulsos Color a su frecuencia efectiva (s). */
  colorFrameS: number;
  /** Duración del cuadro B intercalado (s). */
  bFrameS: number;
  /** Fracción real del periodo PW ocupada por su recepción; 0 sin PW. */
  pwDuty: number;
  /** Frecuencia de cuadro resultante (Hz). */
  frameHz: number;
}
