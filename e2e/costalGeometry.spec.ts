import { expect, test } from '@playwright/test';
import { Tissue } from '../src/anatomy/tissues';
import { bootWithoutErrors, budget, withinFrames } from './support';

test('pares costales bilaterales existen en la anatomía GPU y el navegador', async ({ page }, info) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=1&abdomen=legacy&torso=legacy');
  const report = await page.evaluate(() => {
    const sim = window.__vexusTest!.sim();
    const points: number[] = [];
    for (const rib of sim.scene.ribs)
      for (const side of [-1, 1]) {
        const [ax, by, y0, zc] = rib.shape ?? [sim.scene.torso.a * rib.scale, sim.scene.torso.b * rib.scale, 0, 0];
        const endX = rib.anteriorEndX ?? Math.min(15, 15 + 1.53 * rib.zAnterior);
        // Sample cartilage lateral to the new sternum, and actual free ends on 11/12.
        const front = rib.frontPhi !== undefined ? rib.frontPhi + 0.15 : Math.acos(Math.max(-1, Math.min(-40, endX - 10) / ax));
        const phis = rib.frontPhi !== undefined ? [front, (front + 4.15) / 2, 4.15] : [Math.PI, Math.PI * 1.35, front];
        for (const phi of phis) {
          const m: [number, number, number] = [
            side * ax * Math.abs(Math.cos(phi)),
            y0 + by * Math.sin(phi),
            rib.zAnterior + rib.tilt * (0.5 - 0.5 * Math.sin(phi)) + zc * Math.cos(phi),
          ];
          points.push(...sim.anatomy.deformation.toWorld(m, sim.sample.resp));
        }
      }
    const pts = new Float32Array(points);
    const gpu = sim.gpuQuery(pts, sim.frame, true);
    const cpu = Array.from(
      { length: pts.length / 3 },
      (_, i) => sim.anatomy.classifyWorld([pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]], sim.sample).tissue,
    );
    return { gpu: Array.from(gpu.tissue), cpu };
  });
  expect(report.gpu).toEqual(report.cpu);
  // Two bony samples per side on all twelve pairs, plus the four floating anterior ends.
  expect(report.cpu.filter((t) => t === Tissue.Bone)).toHaveLength(52);
  // Anterior cartilage exists on ten pairs; ribs 11–12 have free bony ends.
  expect(report.cpu.filter((t) => t === Tissue.Cartilage)).toHaveLength(20);
  await page.evaluate(() => {
    const sim = window.__vexusTest!.sim();
    sim.setPose({ ...sim.pose, phi: 0, z: 14, lift: 0 });
  });
  await withinFrames(page, 20, 'render de ventana costal izquierda', async () => {
    const phi = await page.evaluate(() => window.__vexusTest!.sim().pose.phi);
    return phi === 0 ? true : `phi=${phi}`;
  });
  const rendered = await page.evaluate(() => window.__vexusTest!.framesRendered());
  await expect.poll(() => page.evaluate(() => window.__vexusTest!.framesRendered())).toBeGreaterThan(rendered + 1);
  await page.screenshot({ path: info.outputPath('costal-left-ultrasound.png') });
  await page.locator('#nav-layers').click();
  await page.locator('#layer-skin').uncheck();
  await page.locator('#layer-organs').uncheck();
  await expect(page.locator('#layer-vessels')).toBeDisabled();
  await page.locator('#nav-layers').click();
  await page.screenshot({ path: info.outputPath('shared-costal-skeleton.png') });
  expect(errors).toEqual([]);
});
