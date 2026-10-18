import { expect, it } from 'vitest';
import { outsideTubeSphere } from '../anatomy/scene';
import type { Vec3 } from '../core/vec3';

it('conserva la norma original a ambos lados de la esfera, incluidos redondeo y extremos numéricos', () => {
  let mismatches = 0,
    points = 0;
  const center: Vec3 = [-31.4, 12.8, -87.5];
  for (const r of [-32, 0, 1e-320, 1e-150, 0.1, 7, 32, 170, 1e150, 1e300, Infinity])
    for (let i = 0; i < 60; i++)
      for (const scale of [0, 0.99, 1 - 4 * Number.EPSILON, 1 - Number.EPSILON, 1, 1 + Number.EPSILON, 1 + 4 * Number.EPSILON, 1.01, 2]) {
        const a = i * 0.713,
          b = i * 0.239;
        const p: Vec3 = [
          center[0] + r * scale * Math.cos(a) * Math.cos(b),
          center[1] + r * scale * Math.sin(a) * Math.cos(b),
          center[2] + r * scale * Math.sin(b),
        ];
        const old = Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]) > r;
        if (outsideTubeSphere(p, center, r) !== old) mismatches++;
        points++;
      }
  for (const p of [
    [NaN, 0, 0],
    [Infinity, 0, 0],
    [-Infinity, NaN, 0],
  ] as Vec3[])
    expect(outsideTubeSphere(p, center, 32)).toBe(Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]) > 32);
  expect(points).toBe(5940);
  expect(mismatches).toBe(0);
});
