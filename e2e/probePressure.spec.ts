import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, withinFrames } from './support';

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`pressure control commands the full physical lift range, ${caseId}`, async ({ page }, info) => {
    budget(120_000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    await page.selectOption('#case-select', caseId);
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.getByRole('tab', { name: 'Adquirir', exact: true }).click();
      const slider = page.getByRole('slider', { name: 'Presión', exact: true });
      // La presión manda hundimiento (-lift). El modelo ya admite lift -6..25 mm;
      // el mando debe ejecutar sus extremos y exponer toda la separación.
      await expect(slider).toHaveAttribute('min', '-25');
      await expect(slider).toHaveAttribute('max', '6');
      for (const [key, pressure] of [
        ['End', 6],
        ['Home', -25],
      ] as const) {
        await slider.focus();
        await slider.press(key);
        await expect(slider).toHaveValue(String(pressure));
        await withinFrames(page, 12, `adquisición de presión ${pressure}`, async () =>
          page.evaluate((p) => {
            const s = window.__vexusTest!.sim();
            const acquired = s.renderer.displayedAnatomy;
            return (s.pose.lift === -p && acquired?.pose.lift === -p) || 'mando y adquisición aún no coinciden';
          }, pressure),
        );
      }
      // El control real debe devolver la pose y la imagen desde la separación a contacto.
      await slider.evaluate((element: HTMLInputElement) => {
        element.value = '0';
        element.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await withinFrames(page, 12, 'contacto recuperado', async () =>
        page.evaluate(() => {
          const s = window.__vexusTest!.sim();
          return (s.pose.lift === 0 && s.renderer.displayedAnatomy?.pose.lift === 0) || 'contacto pendiente';
        }),
      );
      await expect(slider).toHaveValue('0');
      await page.screenshot({ path: info.outputPath(`pressure-${caseId}-${viewport.width}.png`) });
    }
    expect(errors).toEqual([]);
  });
