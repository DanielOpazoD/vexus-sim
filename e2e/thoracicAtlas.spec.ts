import { expect, test } from '@playwright/test';
import witnesses from '../docs/anatomy/costal-heldout-witnesses.json' with { type: 'json' };
import { bootWithoutErrors, budget } from './support';

test('all 24 registered ribs agree in production CPU/GPU and preserve intercostal spaces', async ({ page }, info) => {
  budget(90_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('#freeze').click();
  const result = await page.evaluate((w) => {
    const s = window.__vexusTest!.sim(),
      points = [...w.boneInterior, ...w.intercostalSpaces],
      world = points.map((x) => s.anatomy.deformation.toWorld(x.p as [number, number, number], s.sample.resp)),
      gpu = s.gpuQuery(new Float32Array(world.flat()), s.frame, true, { normals: true });
    const rows = world.map((p, i) => {
      const c = s.anatomy.classifyWorld(p, s.sample);
      return { cpu: c.tissue, gpu: gpu.tissue[i], bd: c.boundaryDistance };
    });
    return { rows, logged: window.__vexusTest!.loggedErrors() };
  }, witnesses);
  for (const [i, row] of result.rows.entries()) {
    expect(row.gpu, JSON.stringify({ i, row })).toBe(row.cpu);
    if (i < witnesses.boneInterior.length) expect([11, 22], JSON.stringify({ i, row })).toContain(row.cpu);
    else expect([11, 22], JSON.stringify({ i, row })).not.toContain(row.cpu);
  }
  expect(errors).toEqual([]);
  expect(result.logged).toEqual([]);
  await page.screenshot({ path: info.outputPath('registered-ribs.png') });
});
