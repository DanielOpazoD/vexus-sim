import { describe, expect, it } from 'vitest';
import { probePositionText, type ProbePositionInput } from '../app/probePosition';
import { defaultEquipment } from '../app/simulator';

describe('Posición compartida de la sonda', () => {
  it('conserva precisión, unidades y contexto sin convertir una pose en evidencia del cine', () => {
    const pose = {
      phi: 3.019419873456789,
      z: -40.0000123456789,
      yaw: -1.2566370614359172,
      rock: -0.10471975511965977,
      tilt: -0.03490658503988659,
      lift: -1.23456789,
    };
    const input: ProbePositionInput = {
      source: { version: '0.5.0', commit: '123abcd', buildTime: '2026-10-11T14:00:00Z', anatomy: 'atlas', transducer: 'convex-c35' },
      pose,
      equipment: defaultEquipment(),
      context: { caseId: 'normal-adult', seed: 42, respiration: 'apnea-expiratory', timeS: 19.123456789, mode: 'triplex', frozen: true },
    };
    const text = probePositionText(input);
    const result = JSON.parse(text) as ProbePositionInput & {
      format: string;
      scope: string;
      units: object;
      readout: { pressureMm: number };
    };
    expect(result.pose).toEqual(pose);
    expect(result.equipment).toEqual(input.equipment);
    expect(result.context).toEqual(input.context);
    expect(result.source).toEqual(input.source);
    expect(result.format).toBe('vexus-probe-position/1');
    expect(result.scope).toBe('current-probe-and-equipment');
    expect(result.units).toEqual({ poseAngles: 'rad', poseDistances: 'mm' });
    expect(result.readout.pressureMm).toBe(1.23456789);
    // La copia ya formada sigue siendo la del clic aunque el operador continúe moviéndose.
    pose.z = -50;
    input.equipment.bmode.tgcDb = [1, 2, 3, 4, 5, 6, 7, 8];
    expect((JSON.parse(text) as ProbePositionInput).pose.z).toBe(-40.0000123456789);
    expect((JSON.parse(text) as ProbePositionInput).equipment.bmode.tgcDb).toEqual(defaultEquipment().bmode.tgcDb);
  });
});
