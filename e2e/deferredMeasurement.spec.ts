import { expect, test } from '@playwright/test';
import { budget } from './support';

test('PW diferido: no se descarga al arrancar y la captura preparada es síncrona', async ({ page }) => {
  budget(90_000);
  let requests = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/pwMeasurements-*.js', async (route) => {
    requests++;
    await ready;
    await route.continue();
  });
  // Sin ganchos: el alumno no descarga el análisis ni la verdad al abrir la aplicación.
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/\d+ fps/, { timeout: 300_000 });
  expect(requests).toBe(0);
  await page.getByRole('tab', { name: 'Medir' }).click();
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Suprahepática', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preparando medición…' })).toBeDisabled();
  await expect.poll(() => requests).toBe(1);
  release();
  await expect(page.getByRole('button', { name: 'Capturar', exact: true })).toBeEnabled();
  // La lectura y el resultado ocurren en el mismo turno del clic, sin await ni ventana
  // para capturar otro paciente/equipo. La cadena con flujo válido la cubre smoke.spec.
  const result = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Capturar')!;
    const card = button.closest<HTMLElement>('.callout')!;
    button.click();
    return { completed: card.hidden, result: document.querySelector('.result')?.textContent };
  });
  expect(result.completed).toBe(true);
  expect(result.result).toContain('VSH:');
  expect(requests).toBe(1);
});
