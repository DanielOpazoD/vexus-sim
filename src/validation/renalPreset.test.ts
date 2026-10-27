import { expect, it } from 'vitest';
import { renalPreset } from '../app/renalPreset';
import { reduceEquipment } from '../app/equipment';
import { defaultEquipment } from '../app/simulator';
import { nyquistVelocityCms, C_RECONSTRUCTION_MM_S } from '../core/units';
import { CONVEX_C35 } from '../probe/probe';

it.each([true, false])('el preset renal reemplaza la escala heredada y permite seguir ajustándola (atlas=%s)', (atlas) => {
  const ctx = { halfSectorRad: CONVEX_C35.halfSector, cMmS: C_RECONSTRUCTION_MM_S };
  let equipment = defaultEquipment();
  equipment.color.wallFilterHz = 400;
  equipment.pw.angleCorrection = 0.7;
  for (const command of renalPreset(CONVEX_C35.f0Doppler, atlas)) equipment = reduceEquipment(equipment, command, ctx);
  for (const mode of ['color', 'pw'] as const) {
    expect(nyquistVelocityCms(equipment[mode].prfHz, CONVEX_C35.f0Doppler)).toBeCloseTo(mode === 'color' ? 15 : 40, 1);
    expect(equipment[mode].wallFilterHz).toBe(mode === 'color' ? 50 : 20);
  }
  expect(equipment.color.r1).toBeLessThan(equipment.bmode.depthMm);
  expect(equipment.pw.angleCorrection).toBe(0);
  equipment = reduceEquipment(equipment, { type: 'color', patch: { prfHz: 2000, wallFilterHz: 20 } }, ctx);
  expect(equipment.color.prfHz).toBe(2000);
  expect(equipment.color.wallFilterHz).toBe(20);
  expect(equipment.pw.wallFilterHz).toBe(20);
});
