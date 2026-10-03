import { test, expect } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach } from './support';
import { Interface } from '../src/anatomy/interfaces';
checkAfterEach();
for (const reference of [false, true])
  test(`unión diafragmática y tejidos vecinos CPU/GPU (${reference ? 'referencia' : 'legacy'})`, async ({ page }, info) => {
    budget(180_000);
    await bootWithoutErrors(page, reference ? '?e2e=1&reference=1' : '?e2e=1');
    const points = await page.evaluate(() => {
      const sim = window.__vexusTest!.sim(),
        cal = sim.anatomy.caliberFor(sim.sample),
        points: [number, number, number][] = [];
      for (const x of [16, 18, 20, 22, 24])
        for (const y of [-40, -20, 0, 20, 40])
          for (const target of [-1.25, 0.25, 0.75, 1.25, 1.75, 2.25, 3.25]) {
            let lo = -150,
              hi = 150;
            for (let i = 0; i < 35; i++) {
              const z = (lo + hi) / 2,
                d = sim.scene.faceSdf([x, y, z], cal, 'dome')!;
              if (d > target) lo = z;
              else hi = z;
            }
            points.push([x, y, (lo + hi) / 2]);
          }
      return points;
    });
    const { rows } = await page.evaluate((points) => window.__vexusTest!.corticalSamples(points), points);
    let faces = 0,
      minDot = 1,
      maxError = 0;
    for (const r of rows) {
      expect(r[7]).toBe(r[0]);
      expect(r[8]).toBe(r[1]);
      if (r[1] !== Number(Interface.DiaphragmLiver)) continue;
      faces++;
      maxError = Math.max(maxError, Math.abs(r[2] - r[9]));
      minDot = Math.min(minDot, r[3] * r[10] + r[4] * r[11] + r[5] * r[12]);
      expect(Math.abs(r[6] - r[13])).toBeLessThan(0.01);
    }
    expect(faces).toBeGreaterThan(10);
    expect(maxError).toBeLessThan(0.02);
    expect(minDot).toBeGreaterThan(0.99);
    info.annotations.push({
      type: 'diaphragm-junction-parity',
      description: JSON.stringify({ samples: rows.length, faces, minDot, maxError }),
    });
  });
