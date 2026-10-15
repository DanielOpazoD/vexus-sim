import { expect, it } from 'vitest';
import { FACE_GRADIENT_EPS_MM } from '../anatomy/interfaces';
import { assembleQueryGradient } from '../ultrasound/queryGradient';

it('reúne diferencias centrales y conserva su norma física', () => {
  const h = 2 * FACE_GRADIENT_EPS_MM;
  const axes = [3, -4, 0].map((g) => new Float32Array([g * h, g * h, g * h, -1]));
  const result = assembleQueryGradient(axes, new Float32Array([0, 1, 0, 0]));
  expect(result[0]).toBeCloseTo(0.6, 6);
  expect(result[1]).toBeCloseTo(-0.8, 6);
  expect(result[2]).toBe(0);
  expect(result[3]).toBeCloseTo(5, 6);
});

it('conserva las normales analíticas sin reinterpretarlas como diferencias', () => {
  const value = new Float32Array([0.6, 0.8, 0, 2]);
  expect(assembleQueryGradient([value, value, value], new Float32Array(4))).toEqual(value);
});

it('conserva el fallback de faceGradient si las tres diferencias son cero', () => {
  const axis = new Float32Array([0, 0, 0, -1, 0, 0, 0, -1]);
  expect(assembleQueryGradient([axis, axis, axis], new Float32Array([0, 0, -2, 0, 0, 0, 0, 0]))).toEqual(
    new Float32Array([0, 0, -1, 1, 0, 1, 0, 1]),
  );
});
