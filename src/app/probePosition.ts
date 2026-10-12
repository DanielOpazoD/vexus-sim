import type { ProbePose } from '../probe/probe';
import type { RespiratoryPattern } from '../physiology/patientState';
import type { ImagingMode } from './equipment';
import type { EquipmentSettings } from './simulator';

/** Mandos actuales, no una exportación del cuadro de cine ni del historial fisiológico. */
export interface ProbePositionInput {
  source: { version: string; commit: string; buildTime: string; anatomy: 'atlas' | 'reference' | 'legacy'; transducer: string };
  pose: ProbePose;
  equipment: EquipmentSettings;
  context: { caseId: string; seed: number; respiration: RespiratoryPattern; timeS: number; mode: ImagingMode; frozen: boolean };
}

/** JSON conserva la precisión de los números del modelo; los grados son solo una lectura auxiliar. */
export function probePositionText(input: ProbePositionInput): string {
  const { phi, z, yaw, tilt, rock, lift } = input.pose;
  const degrees = 180 / Math.PI;
  return JSON.stringify(
    {
      format: 'vexus-probe-position/1',
      scope: 'current-probe-and-equipment',
      units: { poseAngles: 'rad', poseDistances: 'mm' },
      ...input,
      readout: {
        phiDeg: phi * degrees,
        zCm: z / 10,
        rotationDeg: yaw * degrees,
        inclinationDeg: tilt * degrees,
        rockingDeg: rock * degrees,
        pressureMm: -lift,
      },
    },
    null,
    2,
  );
}
