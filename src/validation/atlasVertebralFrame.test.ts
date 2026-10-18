import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setThoracicAtlas, boneSurfaceFrame } from '../anatomy/thoracicAtlas';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';

beforeAll(() => {
  for (const [path, set] of [
    ['src/anatomy/abdominal-atlas.gzip.bin', setAbdominalAtlas],
    ['src/anatomy/thoracic-atlas.gzip.bin', setThoracicAtlas],
  ] as const) {
    const b = gunzipSync(readFileSync(path));
    set(new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
});
afterAll(() => {
  setAbdominalAtlas();
  setThoracicAtlas();
});

it('la cortical registrada no hereda la curvatura ni el eje de la antigua columna analítica', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  // Lumbar witnesses from the acquired renal plane, outside the thoracic-only
  // field: using just thoracicFrame would incorrectly give zero curvature.
  const points: Vec3[] = [
    [-17.99, -41.28, -108.17],
    [-20.94, -36.37, -139.84],
    [-19.59, -31.92, -170.89],
  ];
  const before = points.map((p) => scene.faceGradient(p, BASELINE_CALIBER, 'spine')!);
  scene.spine.r *= 1.7;
  scene.spine.x0 += 30;
  scene.spine.y0 -= 20;
  const after = points.map((p) => scene.faceGradient(p, BASELINE_CALIBER, 'spine')!);
  expect(after).toEqual(before);
  expect(before.some((g) => g.curvature > 0)).toBe(true);
  for (const g of before) {
    expect(g.axis!.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...g.axis!)).toBeCloseTo(1, 8);
    expect(Number.isFinite(g.curvature)).toBe(true);
  }
});

it('el marco estima curvatura de esfera, plano y campo constante sin generar valores no finitos', () => {
  const sphere = boneSurfaceFrame([30, 0, 0], (p) => Math.hypot(...p) - 30);
  // Central second differences over h=3 mm: relative truncation O(h²/R²).
  expect(sphere.curvature).toBeCloseTo(1 / 30, 3);
  expect(boneSurfaceFrame([0, 0, 0], (p) => p[1]).curvature).toBe(0);
  expect(boneSurfaceFrame([0, 0, 0], () => 16)).toEqual({ axis: [0, 0, 1], curvature: 0 });
});
