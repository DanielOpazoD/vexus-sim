import { expect, test, type Page } from '@playwright/test';

/**
 * Humo de extremo a extremo: lo que ninguna prueba unitaria puede ver — que el
 * módulo arranca en el navegador, que WebGL2 renderiza cuadros, que la UI está
 * cableada (caso, modos, medición) y que no hay errores de consola.
 */
async function bootWithoutErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/\d+ fps/, { timeout: 30_000 });
  return errors;
}

test('arranca, renderiza cuadros y no emite errores', async ({ page }) => {
  const errors = await bootWithoutErrors(page);
  // El reloj de simulación avanza (t crece) y hay cuadros por segundo
  const t1 = await page.locator('#status').textContent();
  await page.waitForTimeout(1500);
  const t2 = await page.locator('#status').textContent();
  const tOf = (s: string | null) => Number(/t ([\d.]+) s/.exec(s ?? '')?.[1] ?? 0);
  expect(tOf(t2)).toBeGreaterThan(tOf(t1));
  expect(Number(/(\d+) fps/.exec(t2 ?? '')?.[1])).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('cambia de caso y el HUD lo refleja', async ({ page }) => {
  const errors = await bootWithoutErrors(page);
  await page.selectOption('#case-select', 'severe-congestion');
  await expect(page.locator('#hud-tl')).toContainText('Congestión venosa grave');
  await page.selectOption('#case-select', 'af-moderate-congestion');
  await expect(page.locator('#hud-tr')).toContainText('FA');
  expect(errors).toEqual([]);
});

test('modos por teclado, pestaña Medir y captura de una medición', async ({ page }) => {
  const errors = await bootWithoutErrors(page);
  await page.keyboard.press('p');
  await expect(page.locator('#mode-pw')).toHaveClass(/active/);
  await expect(page.locator('#hud-br')).toContainText('PW');
  await page.getByRole('tab', { name: 'Medir' }).click();
  await page.getByRole('button', { name: 'Suprahepática', exact: true }).click();
  await page.waitForTimeout(2500); // unos latidos de espectro
  await page.getByRole('button', { name: 'Capturar' }).click();
  await expect(page.locator('.result')).toContainText('VSH');
  // Docente muestra la verdad fisiológica y la comprobación TS ↔ GLSL
  await page.locator('#debug-toggle').check();
  await page.getByRole('tab', { name: 'Docente' }).click();
  await expect(page.locator('.debug')).toContainText('VERDAD FISIOLÓGICA', { timeout: 20_000 });
  expect(errors).toEqual([]);
});
