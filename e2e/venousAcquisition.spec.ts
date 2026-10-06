import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach, withinFrames } from './support';

checkAfterEach();
for (const caseId of ['normal-adult', 'severe-congestion'])
  test(
    'ventana renal pareada: cambia puerta, conserva paciente y no oculta calidad' +
      (caseId === 'severe-congestion' ? ' (congestión grave)' : ''),
    async ({ page }, info) => {
      budget(120_000);
      const errors = await bootWithoutErrors(page, '?e2e=1&abdomen=legacy&docente=1');
      await page.selectOption('#case-select', caseId);
      await page
        .locator('button', { hasText: /Apnea\s*esp/ })
        .first()
        .click();
      await page.locator('#debug-toggle').check({ force: true });
      await page.getByRole('tab', { name: 'Docente' }).click({ force: true });
      await page.evaluate(() => window.__vexusTest!.advance(30));
      await page.locator('#freeze').click({ force: true });
      const before = await page.evaluate(() => ({
        t: window.__vexusTest!.sim().physiology.clock.t,
        frozen: window.__vexusTest!.sim().frozen,
      }));
      await page.getByRole('button', { name: 'Abrir comparación venosa' }).click({ force: true });
      const dialog = page.getByRole('dialog', { name: 'Comparación venosa' });
      const selector = dialog.getByRole('combobox', { name: 'Ventana renal PW' });
      const renal = dialog.locator('.venous-row').nth(2);
      const canvas = renal.locator('canvas');
      const ready = () =>
        withinFrames(
          page,
          140,
          'ventana renal adquirida',
          async () =>
            (await canvas.evaluate((el) => Number((el as HTMLCanvasElement).dataset.lastTime))) > before.t - 0.15 || 'IQ incompleta',
        );
      await expect(selector).toHaveValue('venous');
      await ready();
      const original = await canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
      await selector.selectOption('paired');
      await ready();
      await expect(renal).toContainText('inspección: predominio arterial');
      await expect(renal.locator('.venous-limits')).toContainText(/arterial|arteria/i);
      expect(await canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL())).not.toBe(original);
      await expect(canvas).toHaveAttribute('data-marks', '');
      await page.setViewportSize({ width: 1280, height: 1380 });
      await renal.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('venous-paired-renal-window.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await renal.scrollIntoViewIfNeeded();
      // Compact persistent context/actions must not cover the Doppler or its keyboard-focused controls.
      const header = dialog.locator('.venous-header');
      const headerBounds = await header.boundingBox();
      expect(headerBounds!.height).toBeLessThan(170);
      await selector.focus();
      await selector.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const selectorBounds = await selector.boundingBox();
      const stuckBounds = await header.boundingBox();
      expect(selectorBounds!.y).toBeGreaterThanOrEqual(stuckBounds!.y + stuckBounds!.height);
      await expect(header.getByRole('button', { name: 'Cerrar', exact: true })).toBeInViewport();
      await expect(header.getByRole('button', { name: 'Pausar vista', exact: true })).toBeInViewport();
      await page.screenshot({ path: info.outputPath('venous-paired-renal-mobile.png') });
      await selector.selectOption('venous');
      await ready();
      await expect(renal).toContainText('centrada en vena');
      await expect(renal.locator('.venous-limits')).not.toContainText('domina la arteria');
      expect(
        await page.evaluate(() => ({ t: window.__vexusTest!.sim().physiology.clock.t, frozen: window.__vexusTest!.sim().frozen })),
      ).toEqual(before);
      await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
      expect(errors).toEqual([]);
    },
  );

test('ventana ausente: aviso de adquisición, bucle estable y recuperación sin cambiar el paciente', async ({ page }, info) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=1&abdomen=legacy&docente=1&reference=1');
  await page.locator('#freeze').click({ force: true });
  await page.locator('#debug-toggle').check({ force: true });
  await page.getByRole('tab', { name: 'Docente' }).click({ force: true });
  await page.evaluate(() => {
    const sim = window.__vexusTest!.sim();
    sim.patient.respiratoryPattern = 'quiet';
    while (sim.physiology.clock.t < 8 - 1e-9) sim.physiology.step();
  });
  const open = page.getByRole('button', { name: 'Abrir comparación venosa' });
  await open.click({ force: true });
  const dialog = page.getByRole('dialog', { name: 'Comparación venosa' });
  await expect(dialog.locator('.venous-status')).toContainText('Ventana PW no disponible (intercostal)');
  await expect(dialog.locator('.venous-sampling').first()).toHaveText('Sin datos de muestreo');
  await expect(dialog.locator('.venous-row figcaption span').first()).toHaveText('Sin adquisición');
  await expect(dialog.locator('.venous-spectrum').first()).toHaveAttribute('data-columns', '0');
  await withinFrames(page, 140, 'porta y riñón conservan adquisiciones independientes', async () => {
    const times = await dialog
      .locator('.venous-spectrum')
      .evaluateAll((els) => els.slice(1).map((e) => Number((e as HTMLElement).dataset.lastTime)));
    return times.every((t) => t >= 7.85) || 'reconstruyendo las ventanas disponibles';
  });
  for (const index of [1, 2]) await expect(dialog.locator('.venous-sampling').nth(index)).toContainText('FFT 128');
  const available = () =>
    dialog.locator('.venous-spectrum').evaluateAll((els) =>
      els.slice(1).map((el) => {
        const canvas = el as HTMLCanvasElement;
        let hash = 2166136261;
        for (const char of canvas.toDataURL()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
        return {
          hash,
          columns: canvas.dataset.columns,
          time: canvas.dataset.lastTime,
          gate: canvas.dataset.gateCenter,
          prf: canvas.dataset.prfHz,
        };
      }),
    );
  const availableBefore = await available();
  const frames = await page.evaluate(() => window.__vexusTest!.framesRendered());
  await withinFrames(
    page,
    20,
    'el fallo de ventana no degrada el bucle',
    async () => (await page.evaluate(() => window.__vexusTest!.framesRendered())) > frames || 'sin cuadros nuevos',
  );
  await dialog.getByRole('button', { name: 'Pausar vista', exact: true }).click();
  const cursor = dialog.getByRole('slider', { name: 'Cursor sincronizado' });
  await cursor.focus();
  await page.keyboard.press('ArrowLeft');
  expect(
    await dialog
      .locator('.venous-row figcaption span')
      .allTextContents()
      .then((v) => v.slice(0, 3)),
  ).toEqual(['Sin adquisición', 'PW simulado', 'PW simulado']);
  await dialog.getByRole('button', { name: 'Reanudar vista', exact: true }).click();
  await dialog.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: info.outputPath('venous-window-unavailable.png') });
  const samePatient = await page.evaluate(() => ({
    t: window.__vexusTest!.sim().physiology.clock.t,
    patient: JSON.stringify(window.__vexusTest!.sim().patient),
  }));
  const hepaticWindow = dialog.getByRole('combobox', { name: 'Ventana suprahepática PW' });
  await hepaticWindow.selectOption('tilted');
  await withinFrames(
    page,
    140,
    'inclinación física recupera la puerta sin cambiar el paciente',
    async () =>
      (await dialog
        .locator('.venous-spectrum')
        .first()
        .evaluate((el) => Number((el as HTMLCanvasElement).dataset.lastTime))) >=
        samePatient.t - 0.15 || 'historial IQ incompleto',
  );
  await expect(dialog.locator('.venous-status')).not.toContainText('Ventana PW no disponible');
  expect(
    await page.evaluate(() => ({
      t: window.__vexusTest!.sim().physiology.clock.t,
      patient: JSON.stringify(window.__vexusTest!.sim().patient),
    })),
  ).toEqual(samePatient);
  await dialog.evaluate((el) => {
    el.scrollTop = 0;
  });
  expect(await available()).toEqual(availableBefore);
  await page.screenshot({ path: info.outputPath('venous-hepatic-tilted.png') });
  await hepaticWindow.selectOption('standard');
  await expect(dialog.locator('.venous-status')).toContainText('Ventana PW no disponible (intercostal)');
  await expect(dialog.locator('.venous-sampling').first()).toHaveText('Sin datos de muestreo');
  expect(await available()).toEqual(availableBefore);
  const mode = dialog.getByRole('combobox', { name: 'Tipo de visualización venosa' });
  await mode.selectOption('reference');
  await expect(dialog.locator('.venous-status')).not.toContainText('Ventana PW no disponible');
  await expect(dialog.locator('.venous-wave').first()).toHaveAttribute('d', /L/);
  await page.evaluate(() => {
    const sim = window.__vexusTest!.sim();
    sim.patient.respiratoryPattern = 'apnea-expiratory';
    while (sim.physiology.clock.t < 16 - 1e-9) sim.physiology.step();
  });
  const before = await page.evaluate(() => ({ t: window.__vexusTest!.sim().physiology.clock.t, frozen: window.__vexusTest!.sim().frozen }));
  await mode.selectOption('pw');
  await withinFrames(
    page,
    140,
    'recuperación real de IQ después de corregir la respiración',
    async () =>
      (await dialog
        .locator('.venous-spectrum')
        .first()
        .evaluate((el) => Number((el as HTMLCanvasElement).dataset.columns))) > 30 || 'sin IQ',
  );
  await expect(dialog.locator('.venous-status')).not.toContainText('Ventana PW no disponible');
  expect(
    await page.evaluate(() => ({ t: window.__vexusTest!.sim().physiology.clock.t, frozen: window.__vexusTest!.sim().frozen })),
  ).toEqual(before);
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(open).toBeFocused();
  expect(errors).toEqual([]);
});
