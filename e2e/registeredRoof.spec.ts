import { test, expect } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach } from './support';
import { Interface } from '../src/anatomy/interfaces';
import { Tissue } from '../src/anatomy/tissues';
checkAfterEach();
test('techo registrado y vecinos mantienen tejidos, interfaces y normales CPU/GPU', async ({ page }, info) => {
  budget(180_000);
  await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  const points = await page.evaluate(() => {
    const sim = window.__vexusTest!.sim(),
      cal = sim.anatomy.caliberFor(sim.sample),
      points: [number, number, number][] = [];
    for (const [x, y] of [
      [-31, -45],
      [-52.5, -68],
      [51, -18],
      [-30.47, -58.43],
      [-19.37, -14.03],
    ])
      for (const dx of [-0.37, 0, 0.41])
        for (const target of [-1.25, 0.25, 0.75, 1.15, 1.35, 1.75, 2.25, 3.25]) {
          let lo = -150,
            hi = 150;
          for (let i = 0; i < 35; i++) {
            const z = (lo + hi) / 2,
              d = sim.scene.faceSdf([x + dx, y, z], cal, 'dome')!;
            if (d > target) lo = z;
            else hi = z;
          }
          points.push([x + dx, y, (lo + hi) / 2]);
        }
    // Actual cava centerline witnesses rejected by the first roof candidate.
    points.push([-15.1, -5.6166666667, 10.1666666667], [-15, -5, 35], [-15, -5, 43]);
    return points;
  });
  const { rows } = await page.evaluate((points) => window.__vexusTest!.corticalSamples(points), points);
  expect(rows).toHaveLength(123);
  for (const r of rows.slice(-3)) {
    expect(r[0]).toBe(Number(Tissue.Blood));
    expect(r[7]).toBe(Number(Tissue.Blood));
  }
  let faces = 0,
    maxError = 0,
    minDot = 1;
  for (const [i, r] of rows.entries()) {
    expect(r[7], `tejido ${i}`).toBe(r[0]);
    expect(r[8], `interfaz ${i}`).toBe(r[1]);
    if (r[1] !== Number(Interface.DiaphragmLiver)) continue;
    faces++;
    maxError = Math.max(maxError, Math.abs(r[2] - r[9]));
    minDot = Math.min(minDot, r[3] * r[10] + r[4] * r[11] + r[5] * r[12]);
    // Same existing diaphragm parity tolerances: Float32 interpolation, not clinical precision.
    expect(Math.abs(r[6] - r[13])).toBeLessThan(0.01);
  }
  expect(faces).toBeGreaterThan(10);
  expect(maxError).toBeLessThan(0.02);
  expect(minDot).toBeGreaterThan(0.99);
  info.annotations.push({ type: 'registered-roof-parity', description: JSON.stringify({ samples: rows.length, faces, maxError, minDot }) });
});
