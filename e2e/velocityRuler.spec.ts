import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

test('escala PW lateral: cero, inversión, tamaño y ECG alineados', async ({ page }, testInfo) => {
  budget(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = await bootWithoutErrors(page);
  await page.locator('#mode-pw').click();
  await page.getByRole('tab', { name: 'Doppler', exact: true }).click();
  await page
    .getByRole('slider', { name: 'Escala', exact: true })
    .last()
    .evaluate((el: HTMLInputElement) => {
      el.value = '40';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await page.getByRole('slider', { name: 'Línea de base', exact: true }).evaluate((el: HTMLInputElement) => {
    el.value = '0.25';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#pw-scale')).toHaveAttribute('aria-label', /-20\.0 a 60\.0/);
  async function geometry() {
    return page.evaluate(() => {
      const box = (id: string) => {
        const r = document.getElementById(id)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right };
      };
      return { ecg: box('ecg'), spectrum: box('spectrum'), scale: box('pw-scale') };
    });
  }
  for (const width of [1440, 800]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(async () => {
        const g = await geometry();
        return Math.abs(g.ecg.width - g.spectrum.width) + Math.abs(g.scale.height - g.spectrum.height) + Math.abs(g.scale.y - g.spectrum.y);
      })
      .toBeLessThan(1);
    const g = await geometry();
    expect(g.scale.x).toBeGreaterThanOrEqual(g.spectrum.right - 1);
    expect(g.scale.width).toBeGreaterThanOrEqual(50);
  }
  await page.getByRole('button', { name: 'Invertir espectro', exact: true }).click();
  await expect(page.locator('#pw-scale')).toHaveAttribute('aria-label', /-60\.0 a 20\.0/);
  await page.screenshot({ path: testInfo.outputPath('venous-pw-lateral-scale.png') });
  await page.locator('#mode-pw').click();
  await expect(page.locator('#pw-scale')).not.toBeVisible();
  expect(errors).toEqual([]);
});
