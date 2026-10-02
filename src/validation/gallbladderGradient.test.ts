import { describe, expect, it } from 'vitest';
import { gallbladderBody, gallbladderGradient, gallbladderSdf, gbSegmentGradient } from '../anatomy/organs/gallbladder';
import type { Vec3 } from '../core/vec3';
const shape = gallbladderBody();
function numeric(p: Vec3): Vec3 {
  const h = 1e-5;
  return [0, 1, 2].map((i) => {
    const a: Vec3 = [...p],
      b: Vec3 = [...p];
    a[i] += h;
    b[i] -= h;
    return (gallbladderSdf(a, shape) - gallbladderSdf(b, shape)) / (2 * h);
  }) as Vec3;
}
describe('gradiente vesicular de la geometría que produce el eco', () => {
  it('en las tapas no prolonga artificialmente la pendiente de radio', () => {
    const a = { p: [0, 0, 0] as Vec3, r: 12 },
      b = { p: [0, 0, 20] as Vec3, r: 4 };
    expect(gbSegmentGradient([0, 0, -13], a, b)).toEqual([0, 0, -1]);
    expect(gbSegmentGradient([0, 0, 25], a, b)).toEqual([0, 0, 1]);
    expect(gbSegmentGradient([10, 0, 10], a, b)).toEqual([1, 0, 0.4]);
  });
  it('diferencia la unión suave completa, no el segmento que gana', () => {
    let n = 0,
      worst = 0;
    for (let x = -92.13; x < -25; x += 2.9)
      for (let y = 2.17; y < 64; y += 3.1)
        for (let z = -101.27; z < -35; z += 3.7) {
          const p: Vec3 = [x, y, z];
          if (Math.abs(gallbladderSdf(p, shape)) > 2) continue;
          const g = gallbladderGradient(p, shape),
            ref = numeric(p);
          worst = Math.max(worst, Math.hypot(...g.map((v, i) => v - ref[i])));
          n++;
        }
    expect(n).toBeGreaterThan(500);
    expect(worst).toBeLessThan(1e-6);
  });
  it('conserva la forma, pared y volumen: el gradiente no desplaza la luz', () => {
    const before = shape.nodes.map((n) => ({ p: [...n.p], r: n.r }));
    for (const p of [
      [-78, 46, -86],
      [-67, 36, -72],
      [-45, 17, -64],
    ] as Vec3[]) {
      const d = gallbladderSdf(p, shape);
      gallbladderGradient(p, shape);
      expect(gallbladderSdf(p, shape)).toBe(d);
      expect(d).toBeLessThan(0);
    }
    expect(shape.nodes).toEqual(before);
  });
});
