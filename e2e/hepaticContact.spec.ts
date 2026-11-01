import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, windowAcquired } from './support';

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`registered hepatic contact agrees across the production classifiers (${caseId})`, async ({ page }, info) => {
    budget(120_000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    await page.locator('[data-window="subcostal"]').click();
    await windowAcquired(page, 'subcostal');
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
          points.push({ m, dz, tissue: Number(c.tissue), vessel: c.vessel });
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

test('subcostal portal window restores its own depth after the intrahepatic window', async ({ page }, info) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('[data-window="portal"]').click();
  await expect(page.getByLabel('Profundidad', { exact: true })).toHaveValue('130');
  await page.locator('[data-window="portalSubcostal"]').click();
  await expect(page.getByLabel('Profundidad', { exact: true })).toHaveValue('150');
  await windowAcquired(page, 'portalSubcostal');
  await page.locator('#freeze').click();
  const result = await page.evaluate(() => {
    const s = window.__vexusTest!.sim(),
      a = s.renderer.displayedAnatomy!,
      hits = [],
      inner: number[] = [],
      cpu: number[] = [];
    for (let v = 0; v < 180; v++)
      for (let u = 0; u < 96; u++) {
        const theta = (((u + 0.5) / 96) * 2 - 1) * s.transducer.halfSector,
          r = ((v + 0.5) / 180) * s.displayed.bmode.depthMm;
        const p = a.frame.curvatureCenter.map(
          (x, i) => x + (s.transducer.curvatureRadius + r) * (a.frame.axial[i] * Math.cos(theta) + a.frame.lateral[i] * Math.sin(theta)),
        ) as [number, number, number];
        const q = s.anatomy.classifyWorld(p, a.sample);
        if (q.vessel === 'pvRight') {
          hits.push({ theta, r });
          if (q.boundaryDistance > 1.2) {
            inner.push(...p);
            cpu.push(q.tissue);
          }
        }
      }
    return {
      depth: s.displayed.bmode.depthMm,
      focus: s.displayed.bmode.focusMm,
      pose: s.pose,
      hits,
      cpu,
      gpu: Array.from(s.gpuQuery(new Float32Array(inner), a.frame, true).tissue),
      errors: window.__vexusTest!.loggedErrors(),
    };
  });
  await info.attach('right-portal-subcostal-window.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('right-portal-subcostal-window.png') });
  expect(result.depth).toBe(150);
  expect(result.focus).toBe(100);
  expect(result.hits.length).toBeGreaterThan(20);
  expect(result.cpu.length).toBeGreaterThan(0);
  expect(result.gpu).toEqual(result.cpu);
  expect(Math.max(...result.hits.map((p) => p.r)) - Math.min(...result.hits.map((p) => p.r))).toBeGreaterThan(8);
  expect(result.errors).toEqual([]);
  expect(errors).toEqual([]);
  // Each examination restores its own preset (renal atlas 140 mm, decision 309).
  for (const [id, depth] of [
    ['renal', '140'],
    ['hepatorenal', '140'],
    ['subxiphoid', '180'],
  ]) {
    await page.locator(`[data-window="${id}"]`).click();
    await expect(page.getByLabel('Profundidad', { exact: true })).toHaveValue(depth);
    await expect(page.getByLabel('Foco', { exact: true })).toHaveValue('90');
  }
});
