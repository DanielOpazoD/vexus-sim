import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

test('hepatic obstacle and registered posterior supports agree in actual CPU/GPU acquisition', async ({ page }, info) => {
  budget(180000, 0);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('#freeze').click();
  const result = await page.evaluate(() => {
    const s = window.__vexusTest!.sim(),
      a = s.renderer.displayedAnatomy!;
    const points: [number, number, number][] = [
      [-102.5214446, -7.9255744, -14.6906777],
      [-119.2229074, 31.9839385, -28.6120199],
    ];
    for (const side of [-1, 1])
      for (let z = -210; z <= -120; z += 10)
        for (let x = 45; x <= 95; x += 10) for (let y = -90; y <= -55; y += 5) points.push([side * x, y, z]);
    const world = points.map((m) => s.anatomy.deformation.toWorld(m, a.sample.resp));
    const cpu = world.map((p) => s.anatomy.classifyWorld(p, a.sample).tissue),
      gpu = s.gpuQuery(new Float32Array(world.flat()), a.frame, true, { normals: true });
    return { points, cpu, gpu: Array.from(gpu.tissue), normals: Array.from(gpu.normal ?? []), errors: window.__vexusTest!.loggedErrors() };
  });
  await info.attach('registered-supports-and-hepatic-obstacle.json', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.cpu[0]).toBe(4);
  expect(result.cpu[1]).toBe(39);
  expect(result.cpu.filter((t) => t === 28).length).toBeGreaterThan(100);
  expect(result.gpu).toEqual(result.cpu);
  expect(result.normals.every(Number.isFinite)).toBe(true);
  expect(result.errors).toEqual([]);
  expect(errors).toEqual([]);
});
