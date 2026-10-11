import { expect, test, type Page } from '@playwright/test';
import { bootWithoutErrors, budget, withinFrames } from './support';

async function pointAtLiver(page: Page) {
  const p = await page.locator('#cutmap').evaluate((el) => {
    const c = el as HTMLCanvasElement,
      data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const positions: number[] = [];
    for (let k = 0; k < data.length; k += 4) if (data[k] === 140 && data[k + 1] === 90 && data[k + 2] === 60) positions.push(k / 4);
    if (!positions.length) return null;
    const i = positions[Math.floor(positions.length / 2)],
      box = c.getBoundingClientRect();
    return {
      x: box.x + (((i % c.width) + 0.5) / c.width) * box.width,
      y: box.y + ((Math.floor(i / c.width) + 0.5) / c.height) * box.height,
    };
  });
  expect(p).not.toBeNull();
  return p!;
}

test('clic fija órgano sobre mapas nuevos; salir conserva, Escape y paciente cancelan, señal intacta', async ({ page }, info) => {
  budget(90_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('.win-card').filter({ hasText: 'Porta · intrahepática' }).click();
  await withinFrames(
    page,
    100,
    'portal',
    async () => (await page.evaluate(() => Math.abs(window.__vexusTest!.sim().pose.z + 40) < 1e-8)) || 'pose en tránsito',
  );
  await page.locator('#freeze').click();
  await expect.poll(() => pointAtLiver(page)).not.toBeNull();
  const snapshot = () =>
    page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      return { gray: Array.from(s.renderer.readDisplay().gray), equipment: s.equipment, pose: s.pose, time: s.physiology.clock.t };
    });
  const before = await snapshot(),
    p = await pointAtLiver(page);
  await page.mouse.click(p.x, p.y);
  await page.mouse.move(750, 25);
  await expect(page.locator('#cutmap')).toHaveAttribute('data-selected-key', 'o:1');
  await expect(page.locator('#overlay')).toHaveAttribute('data-anatomy-hover', 'Hígado');
  await page.screenshot({ path: info.outputPath('pinned-liver.png') });
  expect(await snapshot()).toEqual(before);
  await page.locator('#cutmap').press('Escape');
  await expect(page.locator('#cutmap')).not.toHaveAttribute('data-selected-key');
  await expect(page.locator('#overlay')).not.toHaveAttribute('data-anatomy-hover');
  await page.mouse.click(p.x, p.y);
  await page.mouse.move(750, 25);
  await page.locator('#freeze').click();
  await withinFrames(
    page,
    50,
    'selección estable en vivo',
    async () => (await page.locator('#cutmap').getAttribute('data-selected-key')) === 'o:1' || 'selección ausente',
  );
  const n = await page.evaluate(() => window.__vexusTest!.framesRendered());
  await page.waitForFunction((old) => window.__vexusTest!.framesRendered() > old + 20, n);
  await expect(page.locator('#cutmap')).toHaveAttribute('data-selected-key', 'o:1');
  await page.selectOption('#case-select', 'severe-congestion');
  await expect(page.locator('#cutmap')).not.toHaveAttribute('data-selected-key');
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
});

test('arrastre real3D conserva ejes en el paciente; girar sigue siendo un gesto explícito', async ({ page }, info) => {
  budget(90_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('.win-card').filter({ hasText: 'Hepatorrenal' }).click();
  await withinFrames(
    page,
    100,
    'hepatorrenal',
    async () => (await page.evaluate(() => Math.abs(window.__vexusTest!.sim().pose.z + 113) < 1e-8)) || 'pose en tránsito',
  );
  const nav = await page.locator('#nav3d canvas').boundingBox();
  expect(nav).not.toBeNull();
  const frame = () =>
    page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      return { pose: s.pose, axial: s.frame.axial, lateral: s.frame.lateral, elevation: s.frame.elevation };
    });
  const before = await frame();
  const records = [];
  await page.mouse.move(nav!.x + nav!.width * 0.56, nav!.y + nav!.height * 0.62);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(nav!.x + nav!.width * 0.56 + (18 * i) / 8, nav!.y + nav!.height * 0.62 - (12 * i) / 8);
    const now = await frame();
    records.push(now);
    for (const axis of ['axial', 'lateral', 'elevation'] as const)
      for (let j = 0; j < 3; j++) expect(now[axis][j]).toBeCloseTo(before[axis][j], 8);
  }
  await page.mouse.up();
  const after = await frame();
  expect(Math.abs(after.pose.phi - before.pose.phi) + Math.abs(after.pose.z - before.pose.z)).toBeGreaterThan(1);
  await page.screenshot({ path: info.outputPath('rigid-translation.png') });
  await info.attach('translation-frames', { body: JSON.stringify({ before, records, after }), contentType: 'application/json' });
  await page.mouse.wheel(0, 100);
  const rotated = await frame();
  expect(Math.abs(rotated.pose.yaw - after.pose.yaw)).toBeGreaterThan(0.01);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
});
