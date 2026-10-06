import { expect, test, type Page } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

async function pointAt(page: Page, rgb: number[]) {
  const p = await page.locator('#cutmap').evaluate((el, color) => {
    const c = el as HTMLCanvasElement,
      d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const points: number[] = [];
    for (let k = 0; k < d.length; k += 4) if (color.every((v, j) => d[k + j] === v)) points.push(k / 4);
    if (!points.length) return null;
    const i = points[Math.floor(points.length / 2)],
      box = c.getBoundingClientRect();
    return {
      x: box.x + (((i % c.width) + 0.5) / c.width) * box.width,
      y: box.y + ((Math.floor(i / c.width) + 0.5) / c.height) * box.height,
    };
  }, rgb);
  expect(p, `estructura presente en el plano: ${rgb.join(',')}`).not.toBeNull();
  await page.mouse.move(p!.x, p!.y);
}

test('identifica y demarca hígado/porta sin alterar señal; sale, cambia plano y revisa cine', async ({ page }, info) => {
  budget(180_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('.win-card').filter({ hasText: 'Porta · intrahepática' }).click();
  await page.waitForFunction(() => Math.abs(window.__vexusTest!.sim().pose.phi - 3.25) < 0.0001, undefined, { timeout: 90_000 });
  await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    for (let i = 0; i < 6; i++) {
      s.advance(s.physiology.clock.dt);
      s.render();
    }
  });
  await page.locator('#freeze').click();
  await page.locator('#cutmap').scrollIntoViewIfNeeded();
  const snapshot = () =>
    page.evaluate(() => {
      const s = window.__vexusTest!.sim(),
        gl = s.renderer.gl,
        c = s.renderer.canvas;
      const pixels = new Uint8Array(c.width * c.height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let hash = 2166136261;
      for (const v of pixels) hash = Math.imul(hash ^ v, 16777619);
      return { hash, pose: s.pose, equipment: s.equipment };
    });
  await expect
    .poll(() =>
      page.locator('#cutmap').evaluate((el) => {
        const c = el as HTMLCanvasElement;
        return c
          .getContext('2d')!
          .getImageData(0, 0, c.width, c.height)
          .data.some((v) => v === 140);
      }),
    )
    .toBe(true);
  const before = await snapshot();
  await pointAt(page, [140, 90, 60]);
  await expect(page.locator('.anatomy-tooltip')).toContainText('Hígado');
  await expect(page.locator('#overlay')).toHaveAttribute('data-anatomy-hover', 'Hígado');
  await expect
    .poll(() =>
      page.locator('#overlay').evaluate((el) => {
        const c = el as HTMLCanvasElement,
          d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let k = 0; k < d.length; k += 4) if (d[k] < 120 && d[k + 1] > 190 && d[k + 2] > 160 && d[k + 3] > 128) n++;
        return n;
      }),
    )
    .toBeGreaterThan(50);
  await page.screenshot({ path: info.outputPath('hover-liver.png') });
  await pointAt(page, [225, 120, 225]);
  await expect(page.locator('.anatomy-tooltip')).toContainText('porta');
  await expect(page.locator('#cutmap')).toHaveAttribute('data-hover-key', /v:pv/);
  await expect(page.locator('#overlay')).toHaveAttribute('data-anatomy-hover', /porta/);
  await page.screenshot({ path: info.outputPath('hover-portal.png') });
  expect(await snapshot()).toEqual(before);
  await page.mouse.move(700, 20);
  await expect(page.locator('.anatomy-tooltip')).toBeHidden();
  await expect(page.locator('#overlay')).not.toHaveAttribute('data-anatomy-hover');

  // Frozen old image must retain its old anatomy even when the live probe changes.
  await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    s.pose = { ...s.pose, phi: s.pose.phi + 0.4 };
  });
  await pointAt(page, [140, 90, 60]);
  await expect(page.locator('#overlay')).toHaveAttribute('data-anatomy-hover', 'Hígado');
  expect((await snapshot()).hash).toBe(before.hash);
  await page.mouse.move(700, 20);
  await page.selectOption('#case-select', 'severe-congestion');
  await expect(page.locator('#overlay')).not.toHaveAttribute('data-anatomy-hover');
  await expect(page.locator('.anatomy-tooltip')).toBeHidden();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
});
