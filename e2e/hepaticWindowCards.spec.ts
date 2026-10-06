import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

for (const reference of [false, true]) {
  test(`ventanas hepáticas: rama, tronco PW y cava longitudinal, reference=${reference}`, async ({ page }, info) => {
    budget(180_000);
    const errors = await bootWithoutErrors(page, `?e2e=app${reference ? '&reference=1' : ''}`);
    await page.locator('.win-card').filter({ hasText: 'Porta · intrahepática' }).click();
    await page.waitForFunction(() => {
      const s = window.__vexusTest!.sim();
      return Math.abs(s.pose.phi - 3.5) < 0.0001 && Math.abs(s.pose.z - (s.scene.torso.profile ? -60 : -90)) < 0.01;
    });
    await page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      s.advance(s.physiology.clock.dt);
      s.advance(s.physiology.clock.dt);
      s.render();
    });
    await page.screenshot({ path: info.outputPath('porta-intrahepatica.png') });
    await page.locator('.win-card').filter({ hasText: 'Porta · tronco PW' }).click();
    await page.waitForFunction(() => {
      const s = window.__vexusTest!.sim();
      return Math.abs(s.pose.z - (s.scene.torso.profile ? -55 : -66)) < 0.01;
    });
    await page.screenshot({ path: info.outputPath('porta-tronco-pw.png') });
    await page.locator('.win-card').filter({ hasText: 'Subcostal · VCI longitudinal' }).click();
    await page.waitForFunction(() => {
      const s = window.__vexusTest!.sim();
      return Math.abs(s.pose.z - (s.scene.torso.profile ? -15 : -20)) < 0.01;
    });
    await page.screenshot({ path: info.outputPath('cava-longitudinal.png') });
    expect(errors).toEqual([]);
  });
}
