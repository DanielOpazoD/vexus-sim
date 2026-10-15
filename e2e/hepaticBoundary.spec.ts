import { test, expect } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach } from './support';
import { Interface } from '../src/anatomy/interfaces';
import { Tissue } from '../src/anatomy/tissues';
import { SPINE_SHAPE } from '../src/anatomy/primitives';
import type { Vec3 } from '../src/core/vec3';
checkAfterEach();
for (const reference of [false, true])
  test(`plano retrohepático: cápsula y tejido blando CPU/GPU (${reference ? 'referencia' : 'legacy'})`, async ({ page }, info) => {
    budget(180_000);
    await bootWithoutErrors(page, reference ? '?e2e=1&abdomen=legacy&reference=1' : '?e2e=1&abdomen=legacy');
    const { spine: s } = await page.evaluate(() => window.__vexusTest!.corticalSamples([]));
    const points: Vec3[] = [];
    // Los centros discales regresan la discontinuidad hepática detectada al conciliar PR119/144.
    for (const z of [-50, -20, 0, 20, 40, ...[-1, 0, 1].map((level) => SPINE_SHAPE.z0Mm + (level + 0.5) * SPINE_SHAPE.levelMm)])
      for (let j = 0; j < 48; j++)
        for (const d of [2.8, 3.2, 3.6, 4.4, 6, 8]) {
          const a = (j * Math.PI) / 24;
          points.push([s.x0 + (s.r + d) * Math.sin(a), s.y0 + (s.r + d) * Math.cos(a), z]);
        }
    const { rows } = await page.evaluate((points) => window.__vexusTest!.corticalSamples(points), points);
    let capsule = 0,
      fat = 0,
      minDot = 1,
      maxError = 0;
    for (const r of rows) {
      expect(r[7]).toBe(r[0]);
      expect(r[8]).toBe(r[1]);
      if (r[0] === Number(Tissue.RetroperitonealFat)) fat++;
      if (r[1] !== Number(Interface.LiverCapsule)) continue;
      capsule++;
      maxError = Math.max(maxError, Math.abs(r[2] - r[9]));
      // La cara capsular es no orientada: liverInner GLSL y faceSdf TS tienen signos opuestos.
      minDot = Math.min(minDot, Math.abs(r[3] * r[10] + r[4] * r[11] + r[5] * r[12]));
      expect(Math.abs(r[6] - r[13])).toBeLessThan(0.01);
    }
    expect(capsule).toBeGreaterThan(20);
    expect(fat).toBeGreaterThan(100);
    expect(maxError).toBeLessThan(0.02);
    expect(minDot).toBeGreaterThan(0.99);
    info.annotations.push({
      type: 'hepatic-boundary-parity',
      description: JSON.stringify({ samples: rows.length, capsule, fat, minDot, maxError }),
    });
  });
