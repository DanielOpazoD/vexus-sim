import { prfFromNyquistCms } from '../core/units';
import type { EquipmentCommand } from './equipment';
import { portalPreset } from './portalPreset';
import { renalPreset } from './renalPreset';
import type { StartPoint } from './startPoints';

const TERRITORY = {
  subxiphoid: 'caval',
  epigastric: 'caval',
  flank: 'caval',
  intercostal: 'hepatic',
  subcostal: 'hepatic',
  portal: 'portal',
  portalTrunk: 'portal',
  portalSubcostal: 'portal',
  renal: 'renal',
  hepatorenal: 'renal',
} as const satisfies Record<StartPoint['id'], string>;

/** Explicit starting equipment per window, independent of case/diagnosis and prior window.
 * Applied only on card selection. Mode switches and free probe motion preserve manual settings.
 * Cursor starts at a neutral point; no vessel is selected. Harmonic preference is retained.
 * Requested scales remain subject to the physical B/Color/PW acquisition schedule.
 */
export function windowPreset(id: StartPoint['id'], f0Hz: number, reference: boolean, atlas: boolean): readonly EquipmentCommand[] {
  const territory = TERRITORY[id];
  const commands: EquipmentCommand[] = [
    {
      type: 'bmode',
      patch: { depthMm: 180, focusMm: 90, gainDb: 0, dynamicRangeDb: 70, tgcDb: [0, 0, 0, 0, 0, 0], persistence: 0.35, compound: true },
    },
    {
      type: 'color',
      patch: {
        theta0: -0.25,
        theta1: 0.25,
        r0: 60,
        r1: 120,
        prfHz: prfFromNyquistCms(30, f0Hz),
        wallFilterHz: 50,
        gainDb: 6,
        invert: false,
        ensemble: 8,
      },
    },
    {
      type: 'pw',
      patch: {
        theta: 0,
        depthMm: 90,
        gateMm: 4,
        prfHz: prfFromNyquistCms(territory === 'hepatic' ? 60 : 40, f0Hz),
        wallFilterHz: 20,
        gainDb: 0,
        sweepMmS: 50,
        baselineShift: territory === 'hepatic' ? -0.2 : territory === 'portal' ? 0.2 : 0,
        angleCorrection: 0,
        invert: false,
      },
    },
  ];
  if (territory === 'portal') commands.push(...portalPreset(reference, f0Hz, atlas, id === 'portalTrunk', id === 'portalSubcostal'));
  if (territory === 'renal') commands.push(...renalPreset(f0Hz, atlas));
  return commands;
}
