import { prfFromNyquistCms } from '../core/units';
import type { EquipmentCommand } from './equipment';

/** Ajuste inicial modificable para buscar vasos interlobares, sin elegir la puerta por el alumno. */
export function renalPreset(f0Doppler: number, atlas: boolean): readonly EquipmentCommand[] {
  const prfHz = prfFromNyquistCms(15, f0Doppler);
  return [
    { type: 'bmode', patch: { depthMm: atlas ? 160 : 180, focusMm: 90, gainDb: -2, dynamicRangeDb: 65 } },
    { type: 'color', patch: { theta0: -0.35, theta1: 0.35, r0: 45, r1: atlas ? 110 : 125, prfHz, wallFilterHz: 20, gainDb: 6 } },
    {
      type: 'pw',
      patch: { prfHz: prfFromNyquistCms(40, f0Doppler), wallFilterHz: 20, baselineShift: 0, angleCorrection: 0, invert: false },
    },
  ];
}
