import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';
import fixtures from '../src/validation/fixtures/s0028-wall-chart.json' with { type: 'json' };

test('la GPU s0028 conserva la banda D/E con identidad U y el panículo regional CPU', async ({ page }) => {
  budget(60_000);
  const errors = await bootWithoutErrors(page, '?e2e=1&abdomen=s0028');
  const rows = await page.evaluate((fixtures) => {
    const sim = window.__vexusTest!.sim();
    const points = fixtures.flatMap((f) => [f.point, f.skin.map((s, k) => s - 10 * f.normal[k])]);
    const gpu = sim.gpuQuery(new Float32Array(points.flat()), sim.frame, false);
    return points.map((p, i) => ({
      p,
      cpu: sim.anatomy.classifyWorld([p[0], p[1], p[2]], sim.sample).tissue,
      gpu: gpu.tissue[i],
    }));
  }, fixtures);
  expect(
    rows.every((row) => row.cpu === row.gpu),
    JSON.stringify(rows),
  ).toBe(true);
  expect(errors).toEqual([]);
});
