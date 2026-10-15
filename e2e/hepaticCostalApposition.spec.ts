import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';
import { Interface } from '../src/anatomy/interfaces';

test('registered costal cortical interfaces precede bone in the production atlas', async ({ page }, info) => {
  budget(180000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('.win-card').nth(2).click();
  await page.waitForFunction(() => Math.abs(window.__vexusTest!.sim().pose.yaw + 1.2) < 0.001);
  await page.locator('#freeze').click();
  const report = await page.evaluate((ribInterface) => {
    const s = window.__vexusTest!.sim(),
      a = s.renderer.displayedAnatomy!;
    const points: [number, number, number][] = [],
      cpu: number[] = [],
      normals: number[][] = [];
    const caliber = s.anatomy.caliberFor(a.sample);
    for (let z = -90.3; z < -15; z += 5.1)
      for (let x = -150.3; x < -90; x += 3.1)
        for (let y = -30.2; y < 65; y += 5.1) {
          const p: [number, number, number] = [x, y, z],
            c = s.scene.classify(p, caliber, false);
          if (c.interface !== ribInterface || c.interfaceDistance < 0.08 || c.interfaceDistance > 0.3) continue;
          const n = s.scene.faceGradient(p, caliber);
          if (!n) throw Error('Costal interface has no normal');
          points.push(p);
          cpu.push(c.tissue);
          normals.push(n.normal);
        }
    const world = points.map((p) => s.anatomy.deformation.toWorld(p, a.sample.resp));
    const gpu = s.gpuQuery(new Float32Array(world.flat()), a.frame, true, { normals: true });
    const marker = a.frame.lateral;
    return {
      points,
      cpu,
      gpu: Array.from(gpu.tissue),
      interfaces: Array.from(gpu.iface),
      normals: Array.from(gpu.normal!),
      marker,
      errors: window.__vexusTest!.loggedErrors(),
    };
  }, Interface.RibCortex);
  // Thaw through the real UI: a direct frozen flag can leave the old cine image shown.
  await page.locator('#freeze').click();
  await page.evaluate(() => {
    const T = window.__vexusTest!,
      s = T.sim();
    T.setCompound(false);
    T.setPose({ ...s.pose, phi: 3, z: -60, yaw: 0, rock: 0, tilt: 0, lift: 0 });
  });
  const frame = await page.evaluate(() => window.__vexusTest!.framesRendered());
  await page.waitForFunction((f) => window.__vexusTest!.framesRendered() > f + 5, frame);
  await page.locator('#freeze').click();
  const shadow = await page.evaluate(() => {
    const s = window.__vexusTest!.sim(),
      g = s.renderer.readSegments(s.displayed.bmode.depthMm),
      t = s.renderer.readTransmission(),
      ratios: number[] = [];
    for (let l = 0; l < g.lines; l++) {
      const hit = g.hitBoneSeg![l];
      if (hit < 2 || hit + 12 >= g.rows) continue;
      const before = t.single[(hit - 2) * t.lines + l];
      if (before > 0) ratios.push(t.single[(hit + 12) * t.lines + l] / before);
    }
    return { ratios, frame: window.__vexusTest!.framesRendered(), pose: s.pose, errors: window.__vexusTest!.loggedErrors() };
  });
  await info.attach('costal-interfaces-and-shadow.json', { body: JSON.stringify({ report, shadow }), contentType: 'application/json' });
  expect(report.points.length).toBeGreaterThan(5);
  expect(report.gpu).toEqual(report.cpu);
  expect(report.interfaces.every((i) => i === Number(Interface.RibCortex))).toBe(true);
  expect(report.normals.every(Number.isFinite)).toBe(true);
  expect(report.marker[1]).toBeLessThan(-0.5);
  expect(shadow.ratios.length).toBeGreaterThan(5);
  expect(Math.max(...shadow.ratios)).toBeLessThan(0.01);
  expect(report.errors).toEqual([]);
  expect(shadow.errors).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('cortex-before-costal-shadow.png') });
});
