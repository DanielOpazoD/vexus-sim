import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`registered hepatic contact agrees across the production classifiers (${caseId})`, async ({ page }, info) => {
    budget(120_000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    await page.locator('.win-card').nth(3).click();
    const f = await page.evaluate(() => window.__vexusTest!.framesRendered());
    await page.waitForFunction((f) => window.__vexusTest!.framesRendered() > f + 50, f, { timeout: 120_000 });
    await page.locator('#freeze').click();
    const result = await page.evaluate(() => {
      const s = window.__vexusTest!.sim(),
        a = s.renderer.displayedAnatomy!,
        world: number[] = [],
        cpu: number[] = [],
        points = [];
      for (const [x, y] of [
        [-60, -15],
        [-80, 10],
        [-40, -25],
        [-45, 10],
        [-25, 20],
      ]) {
        let hi = 30,
          lo: number | undefined;
        for (let z = 28.5; z >= -80; z -= 1.5) {
          if (s.scene.liverBaseSdf([x, y, z]) < 0) {
            lo = z;
            break;
          }
          hi = z;
        }
        if (lo === undefined) throw Error('Independent hepatic roof missing');
        let lower: number = lo;
        for (let k = 0; k < 24; k++) {
          const z: number = (lower + hi) / 2;
          if (s.scene.liverBaseSdf([x, y, z]) < 0) lower = z;
          else hi = z;
        }
        const roof = (lower + hi) / 2;
        for (const dz of [-3, 1, 6]) {
          const m: [number, number, number] = [x, y, roof + dz],
            p = s.anatomy.deformation.toWorld(m, a.sample.resp);
          const c = s.anatomy.classifyWorld(p, a.sample);
          world.push(...p);
          cpu.push(c.tissue);
          points.push({ m, dz, tissue: c.tissue, vessel: c.vessel });
        }
      }
      const gpu = s.gpuQuery(new Float32Array(world), a.frame, true, { normals: true });
      return {
        points,
        cpu,
        gpu: Array.from(gpu.tissue),
        normals: Array.from(gpu.normal ?? []),
        errors: window.__vexusTest!.loggedErrors(),
      };
    });
    await info.attach('hepatic-contact.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('hepatic-contact.png') });
    expect(result.gpu).toEqual(result.cpu);
    expect(result.points.filter((p) => p.dz === -3 && p.tissue === 4).length).toBeGreaterThanOrEqual(3);
    expect(result.points.filter((p) => p.dz === 1 && p.tissue === 9).length).toBe(5);
    expect(result.points.filter((p) => p.dz === 6 && [10, 30, 31, 6].includes(p.tissue)).length).toBe(5);
    expect(result.normals.every(Number.isFinite)).toBe(true);
    expect(result.errors).toEqual([]);
    expect(errors).toEqual([]);
  });

test('main portal PW window restores its own depth after the intrahepatic window', async ({ page }, info) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('.win-card').nth(5).click();
  await expect(page.getByLabel('Profundidad', { exact: true })).toHaveValue('130');
  await page.locator('.win-card').nth(6).click();
  await expect(page.getByLabel('Profundidad', { exact: true })).toHaveValue('160');
  const f = await page.evaluate(() => window.__vexusTest!.framesRendered());
  await page.waitForFunction((f) => window.__vexusTest!.framesRendered() > f + 50, f, { timeout: 120_000 });
  await page.locator('#freeze').click();
  const result = await page.evaluate(() => {
    const s = window.__vexusTest!.sim(),
      a = s.renderer.displayedAnatomy!,
      hits = [];
    for (let v = 0; v < 180; v++)
      for (let u = 0; u < 96; u++) {
        const theta = (((u + 0.5) / 96) * 2 - 1) * s.transducer.halfSector,
          r = ((v + 0.5) / 180) * s.displayed.bmode.depthMm;
        const p = a.frame.curvatureCenter.map(
          (x, i) => x + (s.transducer.curvatureRadius + r) * (a.frame.axial[i] * Math.cos(theta) + a.frame.lateral[i] * Math.sin(theta)),
        ) as [number, number, number];
        if (s.anatomy.classifyWorld(p, a.sample).vessel === 'pvTrunk') hits.push({ theta, r });
      }
    return {
      depth: s.displayed.bmode.depthMm,
      focus: s.displayed.bmode.focusMm,
      pose: s.pose,
      hits,
      errors: window.__vexusTest!.loggedErrors(),
    };
  });
  await info.attach('main-portal-window.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('main-portal-window.png') });
  expect(result.hits.length).toBeGreaterThan(20);
  expect(Math.max(...result.hits.map((p) => p.r)) - Math.min(...result.hits.map((p) => p.r))).toBeGreaterThan(8);
  expect(result.errors).toEqual([]);
  expect(errors).toEqual([]);
});
