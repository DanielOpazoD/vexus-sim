import { test, expect } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach } from './support';
import { Interface } from '../src/anatomy/interfaces';
import { Tissue } from '../src/anatomy/tissues';
import { SPINE_SHAPE } from '../src/anatomy/primitives';
import type { Vec3 } from '../src/core/vec3';
checkAfterEach();
for (const reference of [false, true])
  test(`cortical vertebral: cara, normales y hueso CPU/GPU (${reference ? 'referencia' : 'legacy'})`, async ({ page }, info) => {
    budget(180_000);
    await bootWithoutErrors(page, reference ? '?e2e=1&reference=1' : '?e2e=1');
    const { spine: s } = await page.evaluate(() => window.__vexusTest!.corticalSamples([]));
    const points: Vec3[] = [];
    for (const z of [-4, -3, -2, -1, 0].map((level) => SPINE_SHAPE.z0Mm + level * SPINE_SHAPE.levelMm))
      for (let j = 0; j < 48; j++)
        for (const d of [-1, -0.2, 0.08, 0.3, 0.7]) {
          const a = (j * Math.PI) / 24;
          points.push([s.x0 + (s.r * SPINE_SHAPE.aspect + d) * Math.sin(a), s.y0 + (s.r / SPINE_SHAPE.aspect + d) * Math.cos(a), z]);
        }
    for (const z of [-140, -110, -80])
      for (const side of [-1, 1])
        for (const d of [-0.2, 0.1, 0.4])
          for (const fraction of [0.15, 0.4, 0.7])
            points.push([s.x0 + side * (s.archHalfWidth + d), s.archY0 + (s.archY1 - s.archY0) * fraction, z]);
    for (const level of [-4, -3, -2, -1, 0])
      for (const side of [-1, 1])
        for (const d of [-0.2, 0.08, 0.3, 0.7, 1.6])
          for (const x of [-10, 0, 10])
            points.push([s.x0 + x, s.y0, SPINE_SHAPE.z0Mm + level * SPINE_SHAPE.levelMm + side * (SPINE_SHAPE.bodyMm / 2 + d)]);
    const { rows } = await page.evaluate((points) => window.__vexusTest!.corticalSamples(points), points);
    let faces = 0,
      bone = 0,
      minDot = 1,
      maxError = 0;
    for (const r of rows) {
      expect(r[7]).toBe(r[0]);
      expect(r[8]).toBe(r[1]);
      if (r[0] === Number(Tissue.Vertebra)) {
        bone++;
        expect(r[1]).toBe(Interface.None);
      }
      if (r[1] !== Number(Interface.VertebralCortex)) continue;
      faces++;
      maxError = Math.max(maxError, Math.abs(r[2] - r[9]));
      minDot = Math.min(minDot, r[3] * r[10] + r[4] * r[11] + r[5] * r[12]);
      expect(Math.abs(r[6] - r[13])).toBeLessThan(0.01);
    }
    expect(faces).toBeGreaterThan(300);
    expect(bone).toBeGreaterThan(200);
    expect(maxError).toBeLessThan(0.02);
    expect(minDot).toBeGreaterThan(0.99);
    info.annotations.push({
      type: 'vertebral-parity',
      description: JSON.stringify({ samples: rows.length, faces, bone, minDot, maxError }),
    });
  });
