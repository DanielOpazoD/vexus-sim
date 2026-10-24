import { describe, expect, it } from 'vitest';
import { colorPowerGain } from '../ultrasound/colorGain';
import { EQUIPMENT_LIMITS } from '../app/equipment';
import { decodeColorCorrelation } from '../ultrasound/colorCorrelation';

describe('ganancia Color en unidades de potencia de autocorrelación', () => {
  it('conserva la referencia de potencia a cero dB', () => {
    expect(colorPowerGain(0)).toBe(2);
  });

  it.each([EQUIPMENT_LIMITS.colorGainDb.min, -6, 3, 10, 12, EQUIPMENT_LIMITS.colorGainDb.max])(
    '%s dB cambia la potencia declarada, sin alterar fase o velocidad',
    (db) => {
      // Convención independiente: dB = 10 log10(P/P0), no 20 log10(P/P0).
      const reference = decodeColorCorrelation(3, -4, 2000);
      const factor = colorPowerGain(db) / colorPowerGain(0);
      const acquired = decodeColorCorrelation(3 * factor, -4 * factor, 2000);
      expect(10 * Math.log10(acquired.power / reference.power)).toBeCloseTo(db, 12);
      expect(acquired.frequencyHz).toBeCloseTo(reference.frequencyHz, 12);
    },
  );
});
