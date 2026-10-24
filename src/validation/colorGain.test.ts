import { describe, expect, it } from 'vitest';
import { colorPowerGain } from '../ultrasound/colorGain';
import { EQUIPMENT_LIMITS } from '../app/equipment';
import { decodeColorCorrelation } from '../ultrasound/colorCorrelation';
import { portalPreset } from '../app/portalPreset';

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

  it.each([
    [false, false, false, false],
    [true, false, false, false],
    [true, true, false, false],
    [true, true, true, false],
    [true, true, false, true],
  ])('el preset portal conserva su potencia al migrar unidades (%s/%s/%s/%s)', (reference, atlas, trunk, subcostal) => {
    const color = portalPreset(reference, 2.5e6, atlas, trunk, subcostal).find((command) => command.type === 'color');
    if (color?.type !== 'color' || color.patch.gainDb === undefined) throw new Error('Missing portal Color gain');
    // Historical preset 12 used 10^(dB/20) on R1. Preserve that linear signal,
    // including its noise, without tuning a new gain against image thresholds.
    const previousPower = 2 * 10 ** (12 / 20);
    expect(colorPowerGain(color.patch.gainDb)).toBe(previousPower);
    expect(colorPowerGain(12)).not.toBe(previousPower);
  });
});
