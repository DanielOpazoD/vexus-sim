import { C_RECONSTRUCTION_MM_S, nyquistVelocityCms, prfFromNyquistCms } from '../core/units';
import type { TransducerProfile } from '../ultrasound/transducerProfile';
import { AcquisitionEquipment } from './acquisitionEquipment';
import { reduceEquipment, type EquipmentCommand } from './equipment';
import type { EquipmentSettings } from './simulator';

/** A scale gesture starts at the displayed value, then snaps across physical plateaus.
 * Bounded by the existing slider range; never changes the other requested mode.
 * Only runs on operator input, not per frame or IQ sample.
 */
export function dopplerScaleCommand(
  e: EquipmentSettings,
  profile: TransducerProfile,
  mode: 'color' | 'pw',
  value: number,
): EquipmentCommand {
  const cache = new AcquisitionEquipment(),
    tr = profile.geometry;
  const read = (settings: EquipmentSettings) => cache.get(settings, tr.lines, profile.colorLineSpacingRad, C_RECONSTRUCTION_MM_S)[mode];
  const scale = (settings: EquipmentSettings) => Math.round(nyquistVelocityCms(read(settings).prfHz, tr.f0Doppler));
  const start = scale(e),
    direction = Math.sign(value - start);
  let prfHz = e[mode].prfHz;
  if (direction)
    for (let next = value; next >= (mode === 'color' ? 4 : 5) && next <= (mode === 'color' ? 60 : 120); next += direction) {
      prfHz = Math.round(prfFromNyquistCms(next, tr.f0Doppler));
      const candidate = reduceEquipment(e, { type: mode, patch: { prfHz } }, { halfSectorRad: tr.halfSector, cMmS: C_RECONSTRUCTION_MM_S });
      if (Math.sign(scale(candidate) - start) === direction) break;
    }
  return { type: mode, patch: { prfHz } };
}
