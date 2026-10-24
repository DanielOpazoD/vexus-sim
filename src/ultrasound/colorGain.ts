/** Referencia histórica de potencia Color: ×2 a 0 dB. Se conserva, no se recalibra. */
export const COLOR_GAIN_REF = 2;

/** R1 tiene unidades de potencia (IQ × conjugado de IQ): +10 dB multiplica por diez. */
export function colorPowerGain(gainDb: number): number {
  return COLOR_GAIN_REF * Math.pow(10, gainDb / 10);
}
