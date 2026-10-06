import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';
import { Interface } from '../src/anatomy/interfaces';
import { Tissue } from '../src/anatomy/tissues';

test('doce pares, extremos libres y esternón: misma barrera CPU/GPU', async ({ page }, info) => {
  budget(180_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=legacy');
  const report = await page.evaluate(() => {
    const sim = window.__vexusTest!.sim();
    const points: [number, number, number][] = [
      [0, 89.25, 80],
      [0, 95.35, 80],
      [0, 89.25, 140],
      [0, 89.25, 10],
      [0, -89.25, 80],
      [50, 89.25, 140],
      [0, 89.25, -15],
      [0, 89.25, 17.7615],
      [0, 89.25, 18.7615],
    ];
    const tags = [
      'body',
      'cortex',
      'manubrium',
      'xiphoid',
      'posterior-negative',
      'lateral-negative',
      'old-xiphoid-negative',
      'junction-cartilage',
      'junction-bone',
    ];
    for (const rib of sim.scene.ribs) {
      if (!rib.frontPhi) continue;
      for (const phi of [rib.frontPhi - 0.15, rib.frontPhi + 0.15, (rib.frontPhi + 4.15) / 2]) {
        const shape = rib.shape!;
        const z = rib.zAnterior + rib.tilt * (0.5 - 0.5 * Math.sin(phi)) + shape[3] * Math.cos(phi);
        for (const side of [-1, 1]) {
          points.push([side * shape[0] * Math.cos(phi), shape[2] + shape[1] * Math.sin(phi), z]);
          tags.push(`rib-${rib.number}/${side}/${phi < rib.frontPhi ? 'negative' : 'positive'}`);
        }
      }
    }
    const caliber = sim.anatomy.caliberFor(sim.sample);
    const cpu = points.map((p) => sim.scene.classify(p, caliber));
    const world = new Float32Array(points.flatMap((p) => sim.anatomy.deformation.toWorld(p, sim.sample.resp)));
    const gpu = sim.gpuQuery(world, sim.frame, true, { normals: true });
    return points.map((p, i) => ({
      tag: tags[i],
      p,
      tissue: cpu[i].tissue,
      gpuTissue: gpu.tissue[i],
      iface: cpu[i].interface,
      gpuIface: gpu.iface[i],
      ifd: cpu[i].interfaceDistance,
      gpuIfd: gpu.ifd[i],
      normal: sim.scene.faceGradient(p, caliber)?.normal ?? null,
      gpuNormal: Array.from(gpu.normal!.slice(i * 3, i * 3 + 3)),
    }));
  });
  await info.attach('thoracic-field-parity.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  for (const p of report) {
    expect(p.gpuTissue, p.tag).toBe(p.tissue);
    expect(p.gpuIface, p.tag).toBe(p.iface);
    if (p.iface !== Interface.None) {
      expect(Math.abs(p.gpuIfd - p.ifd), p.tag).toBeLessThan(0.002);
      const dot = p.normal!.reduce((sum, v, i) => sum + v * p.gpuNormal[i], 0);
      expect(dot, p.tag).toBeGreaterThan(0.99);
    }
  }
  expect(report.filter((p) => p.tag.includes('positive')).every((p) => p.tissue === report[0].tissue)).toBe(true);
  expect(report.filter((p) => p.tag.includes('negative')).every((p) => p.tissue !== report[0].tissue)).toBe(true);
  expect(report.find((p) => p.tag === 'old-xiphoid-negative')!.tissue).not.toBe(Tissue.Cartilage);
  expect(report.find((p) => p.tag === 'junction-cartilage')!.tissue).toBe(Tissue.Cartilage);
  expect(report.find((p) => p.tag === 'junction-bone')!.tissue).toBe(Tissue.Bone);
  await page.screenshot({ path: info.outputPath('thoracic-app.png') });
  expect(errors).toEqual([]);
});
