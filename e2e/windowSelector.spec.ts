import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, windowAcquired, withinFrames } from './support';

test('el selector ofrece ocho accesos en cuatro territorios y Enter abre la porta subcostal en 2D', async ({ page }, info) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await expect(page.getByRole('heading', { name: 'Ventanas', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('VExUS LAB');
  await expect(page.locator('.brand')).toHaveText('VExUS LAB');
  expect(await page.locator('.brand img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const menu = page.locator('#start-points');
  const expected = [
    ['Porta', ['Intrahepática', 'Subcostal']],
    ['Suprahepáticas', ['Intercostal', 'Subcostal']],
    ['VCI', ['Eje corto', 'Eje largo']],
    ['Renal', ['Focalizada', 'Hepatorrenal']],
  ] as const;
  await expect(menu.locator('.win-group')).toHaveCount(4);
  await expect(menu.locator('.win-card')).toHaveCount(8);
  for (const [name, labels] of expected) {
    const group = menu.getByRole('group', { name, exact: true });
    await expect(group.locator('.win-name')).toHaveText([...labels]);
    for (const label of labels) {
      const button = group.getByRole('button', { name: `${label} · ${name}`, exact: true });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(32);
    }
  }
  // La simplificación no exige desplazarse para encontrar un territorio en escritorio.
  expect(await menu.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  const first = menu.getByRole('button', { name: 'Intrahepática · Porta', exact: true });
  await first.focus();
  await page.keyboard.press('Tab');
  const subcostal = menu.getByRole('button', { name: 'Subcostal · Porta', exact: true });
  await expect(subcostal).toBeFocused();
  await page.locator('#mode-color').click();
  await page.locator('#mode-pw').click();
  await page.locator('#freeze').click();
  await subcostal.focus();
  await page.keyboard.press('Enter');
  await windowAcquired(page, 'portalSubcostal');
  await expect(subcostal).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#mode-b')).toHaveAttribute('aria-pressed', 'true');
  for (const mode of ['m', 'color', 'pw']) await expect(page.locator(`#mode-${mode}`)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#freeze')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#cine-bar')).toBeHidden();
  await expect(page.getByLabel('Profundidad', { exact: true })).toHaveValue('150');
  await expect(page.getByLabel('Foco', { exact: true })).toHaveValue('100');
  await page.locator('#freeze').click();
  await withinFrames(page, 90, 'corte de la adquisición portal subcostal congelada', async () =>
    page.evaluate(
      () =>
        Number(document.querySelector<HTMLElement>('#cutmap')!.dataset.acquiredFrame) ===
          window.__vexusTest!.sim().renderer.displayedFrame!.n || 'pendiente',
    ),
  );
  const result = await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    return {
      pose: s.pose,
      shown: s.renderer.displayedAnatomy!.pose,
      color: s.renderer.displayedFrame!.color.enabled,
      acquiredFrame: s.renderer.displayedFrame!.n,
      cutFrame: Number(document.querySelector<HTMLElement>('#cutmap')!.dataset.acquiredFrame),
      errors: window.__vexusTest!.loggedErrors(),
    };
  });
  expect(result.shown).toEqual(result.pose);
  expect(result.color).toBe(false);
  expect(result.cutFrame).toBe(result.acquiredFrame);
  expect(result.errors).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('selector-portal-subcostal.png') });
  await info.attach('selector.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});
