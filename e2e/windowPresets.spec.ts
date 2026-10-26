import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach, windowAcquired } from './support';

checkAfterEach();

test('preajustes por ventana: Color renal independiente, PW visible y línea de base habitual', async ({ page }, info) => {
  budget(180_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const caseId of ['normal-adult', 'severe-congestion']) {
    await page.selectOption('#case-select', caseId);
    await page.locator('[data-window="renal"]').click();
    await windowAcquired(page, 'renal');
    const settings = await page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      return { color: s.equipment.color, pw: s.equipment.pw, f0: s.transducer.f0Doppler };
    });
    expect((settings.color.prfHz * 1540000) / (4 * settings.f0 * 10)).toBeCloseTo(15);
    expect((settings.pw.prfHz * 1540000) / (4 * settings.f0 * 10)).toBeCloseTo(40);
    await page
      .locator('button', { hasText: /Apnea\s*esp/ })
      .first()
      .click();
    await page.evaluate(() => window.__vexusTest!.advance(30));
    await page.locator('#mode-pw').click();
    if (caseId === 'severe-congestion') await page.locator('#mode-color').click();
    expect(await page.evaluate(() => window.__vexusTest!.placeGate(['interlobarVein1', 'interlobarVein2', 'interlobarVein3']))).toBe(true);
    await page.evaluate(() => {
      window.__vexusTest!.advance(8);
      window.__vexusTest!.sim().render();
    });
    await page.locator('#freeze').click();
    await page.getByRole('tab', { name: 'Medir', exact: true }).click();
    await page.getByRole('button', { name: 'Renal', exact: true }).click();
    await page.getByRole('button', { name: 'Capturar', exact: true }).click();
    await expect(page.locator('.result')).toContainText(/Renal: máx\. sist\. \d+\.\d · diást\. \d+\.\d/);
    await page.getByRole('tab', { name: 'Doppler', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Avanzado', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('slider', { name: 'Línea de base', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${caseId}-renal-pw.png`) });
    await page.getByRole('slider', { name: 'Línea de base', exact: true }).evaluate((el: HTMLInputElement) => {
      el.value = '0.4';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  // Switching windows must replace manual baseline/scale, rather than leak renal settings into VSH.
  await page.locator('[data-window="intercostal"]').click();
  await windowAcquired(page, 'intercostal');
  const hepatic = await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    return { scale: (s.equipment.pw.prfHz * 1540000) / (4 * s.transducer.f0Doppler * 10), baseline: s.pw.baselineShift };
  });
  expect(hepatic.scale).toBeCloseTo(60);
  expect(hepatic.baseline).toBe(-0.2);
  expect(errors).toEqual([]);
});
