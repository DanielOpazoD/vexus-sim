import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { exportAcquiredFrame } from '../tools/fidelity/registeredAcquisition';
import { bootWithoutErrors, budget } from './support';

for (const reference of [false, true]) {
  test(`ventanas hepáticas: rama, tronco PW y cava longitudinal, reference=${reference}`, async ({ page }, info) => {
    budget(180_000);
    const errors = await bootWithoutErrors(page, `?e2e=app${reference ? '&reference=1' : ''}`);
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
    await capture('porta-intrahepatica');
    await page.locator('.win-card').filter({ hasText: 'Porta · tronco PW' }).click();
    await page.waitForFunction(() => {
      const s = window.__vexusTest!.sim();
      return Math.abs(s.pose.z - (s.scene.torso.profile ? -55 : -66)) < 0.01;
    });
    await capture('porta-tronco-pw');
    await page.locator('.win-card').filter({ hasText: 'Subcostal · VCI longitudinal' }).click();
    await page.waitForFunction(() => {
      const s = window.__vexusTest!.sim();
      return Math.abs(s.pose.z - (s.scene.torso.profile ? -15 : -20)) < 0.01;
    });
    await capture('cava-longitudinal');
    expect(errors).toEqual([]);
  });
}
