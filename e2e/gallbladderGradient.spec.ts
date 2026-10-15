import { test, expect } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach } from './support';
import { gallbladderBody, gallbladderSdf } from '../src/anatomy/organs/gallbladder';
import { Interface } from '../src/anatomy/interfaces';
import type { Vec3 } from '../src/core/vec3';
checkAfterEach();
const shape = gallbladderBody();
const points: Vec3[] = [];
for (let x = -92.13; x < -25; x += 2.1)
  for (let y = 2.17; y < 64; y += 2.3)
    for (let z = -101.27; z < -35; z += 2.7) {
      const p: Vec3 = [x, y, z],
        d = gallbladderSdf(p, shape);
      if (Math.abs(d) < 0.6 && Math.abs(d) > 0.03) points.push(p);
    }
for (const reference of [false, true])
  test(`pared vesicular: gradiente de la unión suave CPU/GPU (${reference ? 'referencia' : 'legacy'})`, async ({ page }, info) => {
    budget(180_000);
    await bootWithoutErrors(page, reference ? '?e2e=1&abdomen=legacy&reference=1' : '?e2e=1&abdomen=legacy');
    const { rows } = await page.evaluate((p) => window.__vexusTest!.corticalSamples(p), points);
    let n = 0,
      minDot = 1,
      maxNormError = 0;
    for (const r of rows) {
      if (r[1] !== Number(Interface.GallbladderLumen)) continue;
      expect(r[8]).toBe(r[1]);
      expect(r[7]).toBe(r[0]);
      expect(Math.abs(r[9] - r[2])).toBeLessThan(0.02);
      n++;
      minDot = Math.min(minDot, r[3] * r[10] + r[4] * r[11] + r[5] * r[12]);
      maxNormError = Math.max(maxNormError, Math.abs(r[6] - r[13]));
    }
    expect(n).toBeGreaterThan(150);
    expect(minDot).toBeGreaterThan(0.999);
    expect(maxNormError).toBeLessThan(0.002);
    info.annotations.push({ type: 'gallbladder-gradient', description: JSON.stringify({ n, minDot, maxNormError }) });
  });
