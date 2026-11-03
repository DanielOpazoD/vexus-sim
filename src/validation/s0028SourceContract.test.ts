import { readFileSync } from 'node:fs';
import { Tissue } from '../anatomy/tissues';
import { describe, expect, it } from 'vitest';
import manifest from '../../tools/anatomy/s0028-case.json';
import { parseFields, requireCategorical } from '../../tools/anatomy/s0028-contract';
import { CtCaseFrame, NATIVE_RAS_TO_LAS } from '../../tools/anatomy/ctFrame';
import type { CtGrid } from '../../tools/anatomy/ctFrame';

describe('s0028 P0 sin datos de paciente en CI', () => {
  it('fija una persona, hashes, rejilla y registro único; ningún runtime instalado', () => {
    expect(manifest.person).toBe('s0028');
    expect(manifest.ctSha256).toBe('d11b8acbf137277d157930f7d0cb3a5f259364a5e5af18dafcd3cac0ecf4168c');
    expect(manifest.requiredMasks).toHaveLength(117);
    expect(manifest.runtimeInstalled).toBe(false);
    expect(manifest.classificationOrderUsed).toBe(false);
    expect(Object.keys(manifest.masks).sort()).toEqual([...manifest.requiredMasks].sort());
    for (const mask of Object.values(manifest.masks)) {
      expect(mask.person).toBe(manifest.person);
      expect(mask.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(mask.path).toMatch(/^segmentations\/[A-Za-z0-9_]+\.nii\.gz$/);
    }
    expect(manifest.pitchMm).toBe(1.5);
    expect(manifest.rasToLASmm.slice(0, 3).map((r) => r.slice(0, 3))).toEqual([
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });
  it('documenta los 42 tejidos con su identidad conservada y procedencia explícita', () => {
    const doc = readFileSync(new URL('../../docs/anatomia/migracion-s0028.md', import.meta.url), 'utf8');
    const rows = [...doc.matchAll(/^\|\s*(\d+)\s*\|\s*(\w+)\s*\|/gm)];
    expect(rows).toHaveLength(42);
    for (const row of rows) expect(Tissue[Number(row[1])]).toBe(row[2]);
  });
  it('rechaza etiquetas interpoladas y descriptores que esconden otra resolución', () => {
    requireCategorical([0, 1, 3], [0, 1, 3]);
    expect(() => requireCategorical([1, 1.5, 3], [0, 1, 3])).toThrow('interpolada');
    const field = {
      name: 'phantom',
      asset: 'abdominal',
      status: 'synthetic',
      dimensions: [2, 3, 4],
      originMm: [0, 0, 0],
      rawBytes: 96,
      gzipBytes: 30,
      sha256Raw: 'a'.repeat(64),
    };
    expect(parseFields({ fields: [field] })[0].dimensions).toEqual([2, 3, 4]);
    expect(() => parseFields({ fields: [{ ...field, rawBytes: 48 }] })).toThrow('RG16F');
  });
  it('el marco físico cambia con affine o donante y rechaza la superposición con el id anterior', () => {
    const grid: CtGrid = {
      source: { dataset: 'synthetic', version: '1', case: 'a' },
      ctSha256: 'a'.repeat(64),
      shape: [2, 3, 4],
      affineRASmm: [
        [1.5, 0, 0, 10],
        [0, 1.5, 0, 20],
        [0, 0, 1.5, 30],
        [0, 0, 0, 1],
      ],
      unitsDeclared: 'mm',
      millimeterEvidence: null,
      allMasksShareOriginalGrid: true,
    };
    const frame = new CtCaseFrame(grid, NATIVE_RAS_TO_LAS);
    expect(frame.voxelToPatient([1, 1, 1])).toEqual([-11.5, 21.5, 31.5]);
    const other = new CtCaseFrame({ ...grid, source: { ...grid.source, case: 'b' } }, NATIVE_RAS_TO_LAS);
    expect(() => other.patientToVoxel([-11.5, 21.5, 31.5], frame.id)).toThrow('Marco');
    expect(() => new CtCaseFrame({ ...grid, unitsDeclared: 'meter' }, NATIVE_RAS_TO_LAS)).toThrow('Unidades');
  });
});
