import { expect, test, type Page } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

const snapshot = (page: Page) =>
  page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    return {
      t: s.physiology.clock.t,
      revision: s.pwChain.revision,
      particles: s.sampleVolume.particleCount,
      columns: s.spectral.columns.map((c) => [c.t, c.prfHz, c.powerDb.reduce((a, b) => a + b, 0)]),
    };
  });

const spectralPixels = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#spectrum')!;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let y = 35; y < canvas.height - 25; y++)
      for (let x = 80; x < canvas.width - 80; x++) {
        const i = (y * canvas.width + x) * 4,
          r = pixels[i];
        if (r >= 12 && Math.abs(pixels[i + 1] - 0.95 * r) < 2 && Math.abs(pixels[i + 2] - 0.75 * r) < 2) count++;
      }
    return count;
  });

async function setSlider(page: Page, name: string, value: string) {
  await page.getByRole('slider', { name, exact: true }).evaluate((input, next) => {
    (input as HTMLInputElement).value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('PW congelado: filtro y ganancia invalidan la señal sin reinterpretar capturas guardadas', async ({ page }) => {
  budget(180_000);
  const errors = await bootWithoutErrors(page, '?e2e=1&abdomen=legacy');
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  await page.keyboard.press('p');
  expect(
    await page.evaluate(() => {
      window.__vexusTest!.goToStartPoint('portalTrunk');
      return window.__vexusTest!.placeGate(['pvTrunk']);
    }),
  ).toBe(true);
  await page.evaluate(() => {
    window.__vexusTest!.advance(8);
    window.__vexusTest!.advance(3);
  });
  await page.locator('#freeze').click();
  await expect(page.locator('#freeze')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: 'Medir' }).click();
  await page.getByRole('button', { name: 'Porta PF', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();
  await expect(page.locator('.result')).toContainText(/Porta: \d+\.\d\/\d+\.\d cm\/s/);
  const captured = await page.locator('.result').innerText();
  const initial = await snapshot(page);
  expect(initial.columns.length).toBeGreaterThan(100);
  expect(await spectralPixels(page)).toBeGreaterThan(100);
  await test.info().attach('pw-before-change', { body: await page.locator('#spectrum').screenshot(), contentType: 'image/png' });
  await page.getByRole('tab', { name: 'Doppler' }).click();
  await setSlider(page, 'Línea de base', '0.2');
  await page.getByRole('button', { name: 'Invertir espectro', exact: true }).click();
  expect(await snapshot(page)).toEqual(initial);
  await page.getByRole('button', { name: 'Invertir espectro', exact: true }).click();
  await setSlider(page, 'Línea de base', '0');
  for (const [name, value, original] of [
    ['Filtro de pared', '100', '25'],
    ['Ganancia', '12', '0'],
  ]) {
    await page.getByRole('tab', { name: 'Doppler' }).click();
    const before = await snapshot(page);
    await setSlider(page, name, value);
    await setSlider(page, name, original);
    const after = await snapshot(page);
    expect(after.t).toBe(initial.t);
    expect(after.particles).toBe(initial.particles);
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.columns).toEqual([]);
    await expect.poll(() => spectralPixels(page)).toBe(0);
    await test.info().attach(`pw-empty-${name}`, { body: await page.locator('#spectrum').screenshot(), contentType: 'image/png' });
    await page.getByRole('tab', { name: 'Medir' }).click();
    await expect(page.locator('.result')).toContainText('captura previa');
    expect((await page.locator('.result').innerText()).replace(' · captura previa', '')).toBe(captured);
    await page.getByRole('button', { name: 'Porta PF', exact: true }).click();
    await page.getByRole('button', { name: 'Capturar', exact: true }).click();
    await expect(
      page.getByText('Adquiere señal nueva antes de capturar. Si está congelada, reanuda el PW.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar (Esc)', exact: true }).click();
  }
  await page.locator('#freeze').click();
  await page.evaluate(() => {
    window.__vexusTest!.advance(8);
    window.__vexusTest!.advance(3);
  });
  await page.locator('#freeze').click();
  await page.getByRole('button', { name: 'Porta PF', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();
  await expect(page.locator('.result')).toContainText(/Porta: \d+\.\d\/\d+\.\d cm\/s/);
  await expect(page.locator('.result')).not.toContainText('captura previa');
  expect(errors).toEqual([]);
});
