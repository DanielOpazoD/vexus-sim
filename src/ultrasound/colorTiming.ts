/**
 * Cadencia física del Doppler color (decisión 39). Un cuadro de color cuesta
 * `líneas × ensemble` disparos a la PRF elegida, y el equipo intercala un
 * cuadro B (cada línea tarda 2·profundidad/c). La frecuencia de cuadro cae al
 * ampliar la caja, bajar la PRF o subir el ensemble: esa es la penalización real
 * que el usuario debe sentir al «abrir la caja». En tríplex (decisión 66) el PW intercalado se lleva
 * su parte del tiempo y la imagen se refresca aún más despacio. Todo en unidades SI salvo mm.
 */
export const COLOR_LINE_SPACING_RAD = (1.0 * Math.PI) / 180; // densidad de líneas de color (1° en un convexo)
export const COLOR_PACKET_MM = 1.0; // longitud axial de la celda (paquete) de color

export function colorLineCount(theta0: number, theta1: number, spacingRad = COLOR_LINE_SPACING_RAD): number {
  return Math.max(4, Math.ceil(Math.abs(theta1 - theta0) / spacingRad));
}

export interface ColorTiming {
  lines: number;
  /** Duración del cuadro de color solo (s). */
  colorFrameS: number;
  /** Duración del cuadro B intercalado (s). */
  bFrameS: number;
  /** Fracción del tiempo que se lleva el PW intercalado (tríplex, decisión 66); 0 sin PW. */
  pwDuty: number;
  /** Frecuencia de cuadro resultante (Hz). */
  frameHz: number;
}

/**
 * Fracción del tiempo de disparo que ocupa el PW en tríplex (decisión 66): cada disparo PW espera el
 * eco del fondo de la puerta (2·d/c) y se repite a su PRF sin huecos, porque el espectro no puede
 * interrumpirse; la imagen (B + color) solo se adquiere en el tiempo que queda. Acotada a 0,8.
 */
export function pwDutyCycle(prfHz: number, gateFarMm: number, cMmS = 1_540_000): number {
  return Math.min(0.8, Math.max(0, prfHz) * ((2 * Math.max(0, gateFarMm)) / cMmS));
}

export function colorTiming(
  theta0: number,
  theta1: number,
  prfHz: number,
  ensemble: number,
  bLines: number,
  depthMm: number,
  cMmS = 1_540_000,
  lineSpacingRad = COLOR_LINE_SPACING_RAD,
  pwDuty = 0,
): ColorTiming {
  const lines = colorLineCount(theta0, theta1, lineSpacingRad);
  const colorFrameS = (lines * ensemble) / Math.max(100, prfHz);
  const bFrameS = (bLines * 2 * depthMm) / cMmS;
  const duty = Math.min(0.8, Math.max(0, pwDuty));
  const frameHz = (1 - duty) / (colorFrameS + bFrameS);
  return { lines, colorFrameS, bFrameS, pwDuty: duty, frameHz };
}
