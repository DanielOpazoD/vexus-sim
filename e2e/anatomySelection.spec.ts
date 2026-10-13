import { expect, test, type Page } from '@playwright/test';
import { startPointsFor } from '../src/app/startPoints';
import { bootWithoutErrors, budget, withinFrames, checkAfterEach } from './support';

checkAfterEach();
async function liverPoint(page: Page) {
  return page.locator('#cutmap').evaluate((el) => {
    const c = el as HTMLCanvasElement,
      data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const pixels: number[] = [];
    for (let i = 0; i < data.length; i += 4) if (data[i] === 140 && data[i + 1] === 90 && data[i + 2] === 60) pixels.push(i / 4);
    if (!pixels.length) return null;
    const index = pixels[Math.floor(pixels.length / 2)],
      box = c.getBoundingClientRect();
    return {
      x: box.x + (((index % c.width) + 0.5) / c.width) * box.width,
      y: box.y + ((Math.floor(index / c.width) + 0.5) / c.height) * box.height,
    };
  });
}

for (const model of ['legacy', 'reference', 'atlas'] as const)
  test(`clic permanece en mapas/cine y salir; cancelación explícita sin alterar señal, modelo=${model}`, async ({ page }, info) => {
    budget(120_000);
    // Atlas is the default: reference=1 alone no longer selects the historical torso.
    const errors = await bootWithoutErrors(
      page,
      `?e2e=app&abdomen=${model === 'atlas' ? 'atlas' : 'legacy'}${model === 'reference' ? '&reference=1' : ''}`,
    );
    const observedModel = await page.evaluate(() => {
      const scene = window.__vexusTest!.sim().scene;
      return scene.hasAbdominalAtlas ? 'atlas' : scene.torso.profile ? 'reference' : 'legacy';
    });
    expect(observedModel).toBe(model);
    const torso = await page.evaluate(() => window.__vexusTest!.sim().scene.torso);
    const sp = startPointsFor(torso).find((x) => x.id === 'portal')!;
    await page.locator('.win-card').filter({ hasText: 'Porta · intrahepática' }).click();
    await withinFrames(page, 100, 'preset completo', async () =>
      page.evaluate((sp) => {
        const p = window.__vexusTest!.sim().pose;
        return (
          ['phi', 'z', 'yaw', 'rock', 'tilt'].every((k) => Math.abs(Reflect.get(p, k) - (Reflect.get(sp, k) ?? 0)) < 1e-8) ||
          'en movimiento'
        );
      }, sp),
    );
    await page.locator('#freeze').click();
    await withinFrames(page, 30, 'mapa hepático del cuadro congelado', async () => {
      const matches = await page
        .locator('#cutmap')
        .evaluate((el) => el.dataset.acquiredFrame === String(window.__vexusTest!.sim().renderer.displayedFrame!.n));
      return (matches && (await liverPoint(page)) !== null) || 'mapa aún pendiente del cuadro';
    });
    const snapshot = () =>
      page.evaluate(() => {
        const s = window.__vexusTest!.sim();
        return { gray: Array.from(s.renderer.readDisplay().gray), pose: s.pose, equipment: s.equipment, time: s.physiology.clock.t };
      });
    const before = await snapshot(),
      point = (await liverPoint(page))!;
    expect(before.gray.some((x) => x !== 0)).toBe(true);
    await page.mouse.click(point.x, point.y);
    await page.mouse.move(750, 25);
    await expect(page.locator('#cutmap')).toHaveAttribute('data-selected-key', 'o:1');
    await expect(page.locator('#overlay')).toHaveAttribute('data-anatomy-hover', 'Hígado');
    expect(await snapshot()).toEqual(before);
    await page.screenshot({ path: info.outputPath('selected-liver.png') });
    await page.locator('#cutmap').press('Escape');
    await expect(page.locator('#cutmap')).not.toHaveAttribute('data-selected-key');
    await page.mouse.click(point.x, point.y);
    await page.mouse.move(750, 25);
    await page.locator('#freeze').click();
    const f = await page.evaluate(() => window.__vexusTest!.framesRendered());
    await withinFrames(page, 30, 'selección sobre mapas vivos', async () => {
      const next = await page.evaluate(() => window.__vexusTest!.framesRendered());
      return next >= f + 20 || 'faltan cuadros';
    });
    await expect(page.locator('#cutmap')).toHaveAttribute('data-selected-key', 'o:1');
    await page.selectOption('#case-select', 'severe-congestion');
    await expect(page.locator('#cutmap')).not.toHaveAttribute('data-selected-key');
    await expect(page.locator('#overlay')).not.toHaveAttribute('data-anatomy-hover');
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
  });
