import { describe, expect, it } from 'vitest';
import {
  eligibleForIntegration,
  registeredNormal,
  registeredPoint,
  registeredTriangle,
  validateRegistration,
  type Registration,
} from '../../tools/anatomy/registration';

const r: Registration = {
  sourceUnit: 'mm',
  axes: [
    [1, 0, 0],
    [0, -1, 0],
    [0, 0, 1],
  ],
  sourceOrigin: [0, -200, 1180],
  targetOriginMm: [0, 100, 0],
  evidence: { units: 'pending', orientation: 'pending', landmarks: 'pending' },
};
describe('registro común externo, sin dimensiones clínicas implícitas', () => {
  it('conserva distancias, transforma ambos lados y corrige winding reflejado', () => {
    expect(validateRegistration(r)).toBe(-1);
    expect(registeredPoint([0, -200, 1180], r)).toEqual([0, 100, 0]);
    expect(registeredPoint([30, -210, 1200], r)).toEqual([30, 110, 20]);
    expect(registeredPoint([-30, -210, 1200], r)).toEqual([-30, 110, 20]);
    expect(registeredTriangle([0, 1, 2], r)).toEqual([0, 2, 1]);
    expect(registeredNormal([0, -2, 0], r)).toEqual([0, 1, 0]);
    expect(registeredPoint([3, -21, 120], { ...r, sourceUnit: 'cm', sourceOrigin: [0, -20, 118] })).toEqual([30, 110, 20]);
  });
  it('no declara lista una transformación sin evidencia y rechaza escala por eje, shear y NaN', () => {
    expect(eligibleForIntegration(r)).toBe(false);
    expect(eligibleForIntegration({ ...r, evidence: {} as Registration['evidence'] })).toBe(false);
    expect(eligibleForIntegration({ ...r, evidence: { units: 'verified', orientation: 'verified', landmarks: 'verified' } })).toBe(true);
    expect(() =>
      validateRegistration({
        ...r,
        axes: [
          [2, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
      }),
    ).toThrow();
    expect(() =>
      validateRegistration({
        ...r,
        axes: [
          [1, 0.2, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
      }),
    ).toThrow();
    expect(() => registeredPoint([NaN, 0, 0], r)).toThrow();
    expect(() => registeredPoint([1, 2, 3, 4] as unknown as [number, number, number], r)).toThrow();
    expect(() => registeredNormal([0, 0, 0], r)).toThrow();
  });
});
