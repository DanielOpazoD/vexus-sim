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
  // ?e2e expone ganchos de prueba estables (window.__vexusTest); nada más cambia
  await page.goto('/?e2e=1');
  await expect(page.locator('#status')).toContainText(/\d+ fps/, { timeout: 30_000 });
  // los ganchos de prueba se cargan de forma diferida (import dinámico)
  await expect.poll(() => page.evaluate(() => typeof window.__vexusTest), { timeout: 30_000 }).toBe('object');
  return errors;
}

test('arranca, renderiza cuadros y no emite errores', async ({ page }) => {
  const errors = await bootWithoutErrors(page);
  // El reloj de simulación avanza: con SwiftShader un cuadro puede tardar segundos
  // (el bucle limita dt a 0,25 s por cuadro), así que se espera a que t cambie en
  // vez de fijar un plazo; los fps redondeados pueden ser 0 y no se exigen.
  const tOf = (s: string | null) => Number(/t ([\d.]+) s/.exec(s ?? '')?.[1] ?? 0);
  const t1 = tOf(await page.locator('#status').textContent());
  await expect.poll(async () => tOf(await page.locator('#status').textContent()), { timeout: 30_000 }).toBeGreaterThan(t1);
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
  test.setTimeout(180_000);
  const errors = await bootWithoutErrors(page);
  await page.keyboard.press('p');
  await expect(page.locator('#mode-pw')).toHaveClass(/active/);
  await expect(page.locator('#hud-br')).toContainText('PW');
  await page.getByRole('tab', { name: 'Medir' }).click();
  await page.getByRole('button', { name: 'Suprahepática', exact: true }).click();
  // La puerta sobre la suprahepática (técnica del operador) y 7 s de espectro sin renderizar:
  // con SwiftShader el reloj avanza despacio y 2,5 s de espera no daban latidos completos
  expect(await page.evaluate(() => window.__vexusTest!.placeGate(['hvRight', 'hvMiddle']))).toBe(true);
  await page.evaluate(() => window.__vexusTest!.advance(7));
  await page.getByRole('button', { name: 'Capturar' }).click();
  // Un valor numérico: «VSH: —» (captura fallida) ya no pasa
  await expect(page.locator('.result')).toContainText(/VSH: S -?\d+\.\d · D -?\d+\.\d/);
  // Docente: el panel de depuración existe y se actualiza (la verdad fisiológica
  // necesita t > 8 s de simulación, inalcanzable con SwiftShader en CI; se prueba en local).
  // `force`: con render por software el hilo principal no deja al elemento «estable».
  await page.locator('#debug-toggle').check({ force: true });
  await page.getByRole('tab', { name: 'Docente' }).click({ force: true });
  await expect(page.locator('.debug')).toContainText(/t [\d.]+ s · latido/, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('sobrevive a la pérdida del contexto WebGL: avisa, se recupera y el reloj sigue', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await bootWithoutErrors(page);
  await page.evaluate(() => {
    const gl = (document.getElementById('gl') as HTMLCanvasElement).getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_lose_context')!;
    (window as unknown as { __lc: WEBGL_lose_context }).__lc = ext;
    ext.loseContext();
  });
  await expect(page.locator('.banner')).toContainText('Contexto GPU perdido', { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { __lc: WEBGL_lose_context }).__lc.restoreContext());
  await expect(page.locator('.banner')).toHaveCount(0, { timeout: 60_000 });
  const tOf = (s: string | null) => Number(/t ([\d.]+) s/.exec(s ?? '')?.[1] ?? 0);
  const t1 = tOf(await page.locator('#status').textContent());
  await expect.poll(async () => tOf(await page.locator('#status').textContent()), { timeout: 60_000 }).toBeGreaterThan(t1);
  expect(errors).toEqual([]);
});
