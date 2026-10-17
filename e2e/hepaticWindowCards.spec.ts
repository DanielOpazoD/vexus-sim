import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { exportAcquiredFrame } from '../tools/fidelity/registeredAcquisition';
import { bootWithoutErrors, budget, windowAcquired } from './support';

for (const reference of [false, true]) {
  test(`ventanas hepáticas: rama, porta subcostal y cava longitudinal, reference=${reference}`, async ({ page }, info) => {
    budget(180_000);
    const errors = await bootWithoutErrors(page, `?e2e=app&abdomen=legacy${reference ? '&reference=1' : ''}`);
    const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const capture = async (name: string) => {
      // La captura documenta una adquisición concreta; no espera al compositor con el rayo vivo cambiando.
      await page.locator('#freeze').click();
      const state = await page.evaluate(() => {
        const s = window.__vexusTest!.sim();
        return { frozen: s.frozen, shown: s.renderer.displayedFrame?.anatomy.pose, requested: s.pose };
      });
      expect(state.frozen).toBe(true);
      expect(state.shown).toEqual(state.requested);
      await exportAcquiredFrame(page, info.outputPath(name + '-acquired'), sourceSha);
      await page.screenshot({ path: info.outputPath(name + '.png') });
      await page.locator('#freeze').click();
    };
    await page.locator('[data-window="portal"]').click();
    await windowAcquired(page, 'portal');
    await capture('porta-intrahepatica');
    await page.locator('[data-window="portalSubcostal"]').click();
    await windowAcquired(page, 'portalSubcostal');
    await capture('porta-subcostal');
    await page.locator('[data-window="subxiphoid"]').click();
    await windowAcquired(page, 'subxiphoid');
    await capture('cava-longitudinal');
    expect(errors).toEqual([]);
  });
}
