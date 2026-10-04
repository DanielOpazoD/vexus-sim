import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

for (const [id, pattern] of [
  ['normal-adult', 'continuo'],
  ['severe-congestion', 'monofásico'],
] as const) {
  test(`calibración territorial renal: captura adquirida ${id}`, async ({ page }, testInfo) => {
    budget(240_000);
    const errors = await bootWithoutErrors(page);
    await page.selectOption('#case-select', id);
    await page
      .locator('button', { hasText: /Apnea\s*esp/ })
      .first()
      .click();
    await page.locator('#mode-pw').click();
    expect(
      await page.evaluate(() => {
        const t = window.__vexusTest!;
        t.goToStartPoint('renal');
        return t.placeGate(['interlobarVein1', 'interlobarVein2', 'interlobarVein3']);
      }),
    ).toBe(true);
    await page.getByRole('tab', { name: 'Doppler', exact: true }).click();
    await page
      .getByRole('slider', { name: 'Escala', exact: true })
      .last()
      .evaluate((el: HTMLInputElement) => {
        el.value = '50';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await page.evaluate(() => {
      const t = window.__vexusTest!;
      t.advance(30);
      t.advance(8);
      t.sim().render();
    });
    await page.locator('#freeze').click();
    await expect(page.locator('#freeze')).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('tab', { name: 'Medir', exact: true }).click();
    await page.getByRole('button', { name: 'Renal', exact: true }).click();
    await page.getByRole('button', { name: 'Capturar', exact: true }).click();
    await expect(page.locator('.result')).toContainText(new RegExp(`Renal: S [\\d.]+ · D [\\d.]+ · mín [-\\d.]+ cm/s → ${pattern}`));
    console.log(JSON.stringify({ case: id, result: await page.locator('.result').innerText() }));
    await page.screenshot({ path: testInfo.outputPath(`venous-renal-territory-${id}.png`) });
    expect(errors).toEqual([]);
  });
}
