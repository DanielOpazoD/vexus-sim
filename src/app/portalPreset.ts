import type { EquipmentCommand } from './equipment';

/** Ajuste estimado de la adquisición intrahepática; se aplica al elegir la tarjeta, no al mover la sonda. */
export function portalPreset(reference: boolean, f0Doppler: number, abdominalAtlas = false): readonly EquipmentCommand[] {
  return [
    { type: 'bmode', patch: { depthMm: abdominalAtlas ? 130 : 150, focusMm: 100, gainDb: -2, dynamicRangeDb: 65 } },
    {
      type: 'color',
      patch: {
        theta0: abdominalAtlas ? -0.2 : reference ? 0.1 : -0.1,
        theta1: abdominalAtlas ? 0.2 : reference ? 0.52 : 0.32,
        r0: 70,
        r1: 125,
        prfHz: (4 * f0Doppler * 350) / 1_540_000,
        gainDb: 12,
        wallFilterHz: 60,
      },
    },
  ];
}
