import { describe, expect, it } from 'vitest';
import { CtCaseFrame, NATIVE_RAS_TO_LAS, type CtGrid } from '../../tools/anatomy/ctFrame';
import { sourcePoint, type Registration } from '../../tools/anatomy/registration';

const grid: CtGrid = {
  source: { dataset: 'coordinate-phantom', version: '1', case: 'oblique-anisotropic' },
  ctSha256: 'a'.repeat(64),
  shape: [9, 10, 11],
  affineRASmm: [
    [0, -2, 0, 10],
    [3, 0, 0, -30],
    [0, 0, 4, 50],
    [0, 0, 0, 1],
  ],
  unitsDeclared: 'mm',
  millimeterEvidence: null,
  allMasksShareOriginalGrid: true,
};

describe('TAC original y un registro físico común para todos los tejidos', () => {
  it('localiza puntos de un phantom oblicuo de espaciado3/2/4mm y conserva su distancia', () => {
    const ct = new CtCaseFrame(grid, NATIVE_RAS_TO_LAS);
    // Valores calculados por geometría del phantom, también contrastados fuera de TS con NiBabel.
    expect(ct.voxelToPatient([1, 2, 3])).toEqual([-6, -27, 62]);
    expect(ct.patientToVoxel([-6, -27, 62], ct.id)).toEqual({ voxel: [1, 2, 3], inside: true });
    expect(ct.voxelToPatient([2, 3, 4])).toEqual([-4, -24, 66]);
    const a = ct.voxelToPatient([1, 2, 3]),
      b = ct.voxelToPatient([2, 3, 4]);
    expect(Math.hypot(...b.map((v, i) => v - a[i]))).toBeCloseTo(Math.sqrt(29), 12);
    const at = ct.patientToVoxel([-5, -25.5, 64], ct.id);
    expect(at.voxel).toEqual([1.5, 2.5, 3.5]);
    expect(at.inside).toBe(true);
  });

  it('aplica el mismo origen a órganos y vasos y deshace el registro sin deformarlos', () => {
    const registration: Registration = { ...NATIVE_RAS_TO_LAS, sourceOrigin: [10, -30, 50], targetOriginMm: [0, 85, 0] };
    const ct = new CtCaseFrame(grid, registration);
    expect(ct.voxelToPatient([1, 2, 3])).toEqual([4, 88, 12]);
    expect(ct.patientToVoxel([4, 88, 12], ct.id).voxel).toEqual([1, 2, 3]);
    expect(sourcePoint([4, 88, 12], registration)).toEqual([6, -27, 62]);
    expect(ct.descriptor().registration.evidence.landmarks).toBe('pending');
  });

  it('informa el campo físico y rechaza otra fuente, otro caso o un registro por órgano', () => {
    const ct = new CtCaseFrame(grid, NATIVE_RAS_TO_LAS);
    expect(ct.patientToVoxel(ct.voxelToPatient([-0.5, 0, 0]), ct.id).inside).toBe(true);
    expect(ct.patientToVoxel(ct.voxelToPatient([8.5, 0, 0]), ct.id).inside).toBe(false);
    expect(ct.patientToVoxel(ct.voxelToPatient([9, 0, 0]), ct.id).voxel).toEqual([9, 0, 0]);
    for (const other of [
      new CtCaseFrame({ ...grid, ctSha256: 'b'.repeat(64) }, NATIVE_RAS_TO_LAS),
      new CtCaseFrame({ ...grid, source: { ...grid.source, case: 'held-out' } }, NATIVE_RAS_TO_LAS),
      new CtCaseFrame(grid, { ...NATIVE_RAS_TO_LAS, targetOriginMm: [1, 0, 0] }),
    ])
      expect(() => ct.patientToVoxel([0, 0, 0], other.id)).toThrow('Marco anatómico distinto');
    expect(
      () =>
        new CtCaseFrame(grid, {
          ...NATIVE_RAS_TO_LAS,
          axes: [
            [1, 0.1, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
        }),
    ).toThrow();
  });

  it('rechaza entradas ambiguas y conserva el registro ante mutación de su descriptor', () => {
    for (const bad of [
      { ...grid, unitsDeclared: 'cm' },
      { ...grid, unitsDeclared: 'unknown' },
      { ...grid, allMasksShareOriginalGrid: false },
      { ...grid, ctSha256: 'unverified' },
      {
        ...grid,
        affineRASmm: [
          [0, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
          [0, 0, 0, 1],
        ],
      },
    ])
      expect(() => new CtCaseFrame(bad, NATIVE_RAS_TO_LAS)).toThrow();
    const ct = new CtCaseFrame(grid, NATIVE_RAS_TO_LAS);
    const descriptor = ct.descriptor();
    descriptor.registration.axes[0][0] = 5;
    descriptor.grid.affineRASmm[0][0] = 0.1;
    expect(ct.voxelToPatient([1, 2, 3])).toEqual([-6, -27, 62]);
    expect(() => ct.voxelToPatient([NaN, 0, 0])).toThrow();
  });
});
