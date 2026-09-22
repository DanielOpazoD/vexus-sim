/**
 * Cadencia física del Doppler color (decisión 39). Un cuadro de color cuesta
 * `líneas × ensemble` disparos a la PRF elegida, y el equipo intercala un
 * cuadro B (cada línea tarda 2·profundidad/c). La frecuencia de cuadro cae al
 * ampliar la caja, bajar la PRF o subir el ensemble: esa es la penalización real
 * que el usuario debe sentir al «abrir la caja». Todo en unidades SI salvo mm.
 */
export const COLOR_LINE_SPACING_RAD = (1.0 * Math.PI) / 180; // densidad de líneas de color (1° en un convexo)
export const COLOR_PACKET_MM = 1.0; // longitud axial de la celda (paquete) de color

export function colorLineCount(theta0: number, theta1: number): number {
  return Math.max(4, Math.ceil(Math.abs(theta1 - theta0) / COLOR_LINE_SPACING_RAD));
}

export interface ColorTiming {
  lines: number;
  /** Duración del cuadro de color solo (s). */
  colorFrameS: number;
  /** Duración del cuadro B intercalado (s). */
  bFrameS: number;
  /** Frecuencia de cuadro resultante (Hz). */
  frameHz: number;
}

export function colorTiming(
  theta0: number,
  theta1: number,
  prfHz: number,
  ensemble: number,
  bLines: number,
  depthMm: number,
  cMmS = 1_540_000,
): ColorTiming {
  const lines = colorLineCount(theta0, theta1);
  const colorFrameS = (lines * ensemble) / Math.max(100, prfHz);
  const bFrameS = (bLines * 2 * depthMm) / cMmS;
  const frameHz = 1 / (colorFrameS + bFrameS);
  return { lines, colorFrameS, bFrameS, frameHz };
}
