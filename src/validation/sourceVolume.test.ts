import { describe, expect, it } from 'vitest';
import { DataUtils } from 'three';
import { sourceDistance, sourceLabel, type SourceVolume } from '../anatomy/sourceVolume';
import type { Vec3 } from '../core/vec3';

// Analytic affine field with categorical node IDs in an offset brick. The
// surrounding texels deliberately belong to a different structure.
const dimensions = [9, 8, 7] as const;
const f: SourceVolume = { originMm: [-1, -2, -3], dimensions: [3, 3, 3], offset: [2, 3, 1], pitchMm: 1.5 };
const data = new Uint16Array(2 * dimensions[0] * dimensions[1] * dimensions[2]).fill(DataUtils.toHalfFloat(99));
for (let z = 0; z < 3; z++)
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++) {
      const i = 2 * ((z + 1) * 9 * 8 + (y + 3) * 9 + x + 2);
      data[i] = DataUtils.toHalfFloat(-(x + 2 * y + 4 * z));
      data[i + 1] = DataUtils.toHalfFloat(1 + x + 3 * y + 9 * z);
    }
const world = (q: Vec3): Vec3 => q.map((v, i) => f.originMm[i] + v * f.pitchMm) as Vec3;

describe('campo fuente en el mismo registro material', () => {
  it('reproduce el campo afín en el interior y en nodos finales sin leer otro ladrillo', () => {
    for (const q of [
      [0, 0, 0],
      [2, 2, 2],
      [0.125, 1.25, 1.875],
      [2, 0.375, 1.75],
      [0.5, 2, 0.75],
    ] as Vec3[]) {
      expect(sourceDistance(data, world(q), f, dimensions)).toBe(0 - (q[0] + 2 * q[1] + 4 * q[2]));
      expect(sourceLabel(data, world(q), f, dimensions)).toBe(1 + Math.round(q[0]) + 3 * Math.round(q[1]) + 9 * Math.round(q[2]));
    }
  });

  it('las etiquetas son categóricas aunque la distancia sea continua en la bisectriz de dos nodos', () => {
    for (const x of [0.5 - 1e-6, 0.5, 0.5 + 1e-6]) {
      const p = world([x, 1, 1]);
      expect(sourceDistance(data, p, f, dimensions)).toBeCloseTo(-x - 6, 12);
      expect(sourceLabel(data, p, f, dimensions)).toBe(x < 0.5 ? 13 : 14);
    }
  });

  it('fuera de cada cara devuelve soporte vacío y conserva los límites inclusivos', () => {
    for (let axis = 0; axis < 3; axis++)
      for (const value of [-1e-6, 2 + 1e-6]) {
        const q: Vec3 = [1, 1, 1];
        q[axis] = value;
        expect(sourceDistance(data, world(q), f, dimensions)).toBe(16);
        expect(sourceLabel(data, world(q), f, dimensions)).toBe(0);
      }
    expect(sourceDistance(data, world([2, 2, 2]), f, dimensions)).toBe(-14);
    expect(sourceLabel(data, world([2, 2, 2]), f, dimensions)).toBe(27);
  });

  it('distancia saturada16 dentro del soporte no significa ausencia de estructura', () => {
    const saturated = data.slice();
    for (let i = 0; i < saturated.length; i += 2) saturated[i] = DataUtils.toHalfFloat(16);
    expect(sourceDistance(saturated, world([1.25, 1.25, 1.25]), f, dimensions)).toBe(16);
    expect(sourceLabel(saturated, world([1.25, 1.25, 1.25]), f, dimensions)).toBe(14);
  });
});
