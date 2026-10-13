import { describe, expect, it } from 'vitest';
import { buildTubeGrid, TUBE_GRID_PITCH_MM, type TubeGrid, type TubeSphere } from './tubeGrid';

function candidates(g: TubeGrid, p: readonly number[]): number[] {
  // Float arithmetic and flattened addressing used by the shader.
  const q = p.map((v, k) => Math.floor(Math.fround(Math.fround(Math.fround(v) - g.origin[k]) / TUBE_GRID_PITCH_MM)));
  if (q.some((v, k) => v < 0 || v >= g.size[k])) return [];
  const cell = q[0] + g.size[0] * (q[1] + g.size[1] * q[2]);
  const first = g.data[cell * 2],
    count = g.data[cell * 2 + 1];
  return Array.from({ length: count }, (_, i) => g.data[(first + i) * 2]);
}

describe('conservative tube candidate grid', () => {
  it('retains every sphere containing a point, including signed cell boundaries and tangencies', () => {
    const spheres: TubeSphere[] = [
      [0, 0, 0, 0],
      [-32, 32, 64, 32],
      [31.99999, -64, 0, 0.0001],
    ];
    let state = 4729;
    const random = () => (state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32;
    for (let i = 0; i < 50; i++) spheres.push([random() * 600 - 300, random() * 400 - 200, random() * 800 - 400, random() * 45]);
    const grid = buildTubeGrid(spheres)!;
    for (let i = 0; i < spheres.length; i++) {
      const s = spheres[i];
      for (let axis = 0; axis < 3; axis++)
        for (const sign of [-1, 0, 1]) {
          const p = s.slice(0, 3);
          p[axis] += sign * s[3];
          expect(candidates(grid, p)).toContain(i);
        }
    }
    for (let i = 0; i < 2000; i++) {
      const p = [random() * 700 - 350, random() * 500 - 250, random() * 900 - 450];
      const list = candidates(grid, p);
      expect(list).toEqual([...new Set(list)].sort((a, b) => a - b));
      spheres.forEach((s, index) => {
        if (Math.hypot(...p.map((v, k) => v - s[k])) <= s[3]) expect(list).toContain(index);
      });
    }
  });

  it('keeps tied and overlapping tubes in their original order and excludes distant cells', () => {
    const grid = buildTubeGrid([
      [0, 0, 0, 5],
      [0, 0, 0, 5],
      [200, 200, 200, 3],
    ])!;
    expect(candidates(grid, [0, 0, 0])).toEqual([0, 1]);
    expect(candidates(grid, [200, 200, 200])).toEqual([2]);
    expect(candidates(grid, [10000, 0, 0])).toEqual([]);
  });

  it('falls back to the original loop for empty, invalid or oversized inputs', () => {
    const cases: TubeSphere[][] = [[], [[NaN, 0, 0, 1]], [[0, 0, 0, -1]], [[1e9, 0, 0, 1]], [[0, 0, 0, 32000]]];
    for (const s of cases) expect(buildTubeGrid(s)).toBeNull();
  });
});
