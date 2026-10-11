import { expect, test } from '@playwright/test';
import { startupEntry, type StartupEntry } from '../src/app/startupTrace';
import { bootWithoutErrors, budget, checkAfterEach } from './support';

checkAfterEach();
test('atlas: torso real y cargas diferidas disponibles antes de adquirir, sin bloquear el arranque', async ({ page }, info) => {
  budget(60_000);
  const stages: StartupEntry[] = [];
  page.on('console', (message) => {
    const entry = startupEntry(message.text());
    if (entry) stages.push(entry);
  });
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('#freeze').click();
  const order = stages.map((s) => s.stage);
  for (const stage of ['cut:ready', 'hooks:ready', 'navigator:ready', 'navigator:drawn'] as const) {
    expect(order, `vista real disponible: ${stage}`).toContain(stage);
    expect(order.indexOf(stage)).toBeLessThan(order.indexOf('frame:first'));
  }
  const state = await page.evaluate(() => ({
    frame: window.__vexusTest!.framesRendered(),
    frozen: window.__vexusTest!.sim().frozen,
    atlas: window.__vexusTest!.sim().scene.hasAbdominalAtlas,
    navigatorCanvas: !!document.querySelector('#nav3d canvas'),
    width: (document.querySelector('#gl') as HTMLCanvasElement).width,
  }));
  expect(state.atlas).toBe(true);
  expect(state.navigatorCanvas).toBe(true);
  expect(state.frame).toBeGreaterThanOrEqual(2);
  expect(state.width).toBeGreaterThan(320);
  expect(state.frozen).toBe(true);
  await page.screenshot({ path: info.outputPath('atlas-startup-ready.png') });
  await info.attach('ordered-startup', { body: JSON.stringify({ stages, state }), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
