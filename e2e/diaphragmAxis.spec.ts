import { test, expect } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach } from './support';
import { Interface } from '../src/anatomy/interfaces';
checkAfterEach();
for (const reference of [false, true])
  test(`eje diafragmático sin singularidad CPU/GPU (${reference ? 'referencia' : 'legacy'})`, async ({ page }, info) => {
    budget(180_000);
    await bootWithoutErrors(page, reference ? '?e2e=1&reference=1' : '?e2e=1');
    const points = await page.evaluate(() => {
      const sim = window.__vexusTest!.sim(),
        cal = sim.anatomy.caliberFor(sim.sample);
      const points: [number, number, number][] = [];
      for (const radius of [0, 0.03, 0.3, 3, 6, 14])
        for (let i = 0; i < (radius === 0 ? 1 : 12); i++) {
          const phi = (i * Math.PI) / 6,
            x = radius * Math.cos(phi),
            y = (sim.scene.torso.y0 ?? 0) + radius * Math.sin(phi);
          for (const target of [-0.75, 0.5, 1.75, 2.75]) {
            let lo = -150,
              hi = 150;
            for (let j = 0; j < 35; j++) {
              const z = (lo + hi) / 2;
              if (sim.scene.faceSdf([x, y, z], cal, 'dome')! > target) lo = z;
              else hi = z;
            }
            points.push([x, y, (lo + hi) / 2]);
          }
        }
      return points;
    });
    const { rows } = await page.evaluate((p) => window.__vexusTest!.corticalSamples(p), points);
    expect(rows).toHaveLength(244);
    let faces = 0,
      minDot = 1,
      maxError = 0,
      maxNormError = 0;
    for (const [i, r] of rows.entries()) {
      expect(r.every(Number.isFinite), `muestra ${i}`).toBe(true);
      expect(r[7], `tejido ${i}`).toBe(r[0]);
      expect(r[8], `cara ${i}`).toBe(r[1]);
      if (r[1] !== Number(Interface.DiaphragmLiver)) continue;
      faces++;
      maxError = Math.max(maxError, Math.abs(r[2] - r[9]));
      minDot = Math.min(minDot, r[3] * r[10] + r[4] * r[11] + r[5] * r[12]);
      maxNormError = Math.max(maxNormError, Math.abs(r[6] - r[13]));
    }
    expect(faces).toBeGreaterThan(20);
    expect(maxError).toBeLessThan(0.02);
    expect(minDot).toBeGreaterThan(0.99);
    expect(maxNormError).toBeLessThan(0.01);
    info.annotations.push({
      type: 'diaphragm-axis-parity',
      description: JSON.stringify({ samples: rows.length, faces, minDot, maxError, maxNormError }),
    });
  });
