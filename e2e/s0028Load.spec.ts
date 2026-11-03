import { test, expect } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

test('s0028 carga una sola persona, dibuja y rechaza procedencia corrupta', async ({ page }) => {
  budget(20_000, 2);
  const assets: string[] = [];
  page.on('response', (r) => {
    if (/(?:atlas|surface|direct|capacity|skin-polar|candidate-manifest).*\.(?:bin|json)/.test(r.url())) assets.push(r.url());
  });
  const errors = await bootWithoutErrors(page, '?e2e=1&abdomen=s0028');
  expect(await page.evaluate(() => window.__vexusTest!.sim().scene.identity.person)).toBe('s0028');
  expect(assets.filter((u) => /abdominal-atlas|thoracic-atlas|abdominal-surface|thoracic-surface/.test(u))).toEqual([]);
  expect(errors).toEqual([]);
  await page.route('**/candidate-manifest-*.bin', async (route) => {
    const r = await route.fetch();
    const body = Buffer.from(await r.body());
    body[0] ^= 1;
    await route.fulfill({ response: r, body });
  });
  await page.goto('/?e2e=1&abdomen=s0028');
  await expect(page.locator('body')).toContainText('procedencia alterados');
  expect(await page.evaluate(() => window.__vexusTest)).toBeUndefined();
});
