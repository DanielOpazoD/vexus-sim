import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach, withinFrames } from './support';

checkAfterEach();
test('comparación venosa: reloj único, cursor, pausa, escala y cierre accesible sin cambiar al paciente', async ({ page }, info) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=1&docente=1');
  await page.locator('#debug-toggle').check({ force: true });
  await page.getByRole('tab', { name: 'Docente' }).click({ force: true });
  await page.evaluate(() => window.__vexusTest!.advance(8));
  const open = page.getByRole('button', { name: 'Abrir comparación venosa' });
  await open.click({ force: true });
  const dialog = page.getByRole('dialog', { name: 'Comparación venosa' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Tipo de visualización venosa' }).selectOption('reference');
  await expect(dialog).toContainText('no espectro PW adquirido');
  await expect(dialog.locator('.venous-wave')).toHaveCount(5);
  await withinFrames(page, 20, 'curvas con datos', async () => {
    const paths = await dialog.locator('.venous-wave').evaluateAll((els) => els.map((e) => e.getAttribute('d')));
    return paths.every((p) => p && p.includes('L')) || 'sin trazas completas';
  });
  const runningAt = await page.evaluate(() => window.__vexusTest!.sim().physiology.clock.t);
  await withinFrames(
    page,
    20,
    'el reloj continúa con el visor abierto',
    async () => (await page.evaluate(() => window.__vexusTest!.sim().physiology.clock.t)) > runningAt || 'reloj detenido',
  );
  await dialog.getByRole('button', { name: 'Pausar vista', exact: true }).click();
  const pausedPaths = await dialog.locator('.venous-wave').evaluateAll((els) => els.map((e) => e.getAttribute('d')));
  const cursor = dialog.getByRole('slider', { name: 'Cursor sincronizado' });
  await expect(cursor).toBeEnabled();
  // Contraste numérico con la muestra original, no con otra copia del observador.
  const shown = await dialog.locator('.venous-row figcaption span').allTextContents();
  const expected = await page.evaluate(() => {
    const time = Number(document.querySelector('.venous-readout')!.textContent.match(/^t ([\d.]+)/)![1]);
    const sample = window.__vexusTest!.sim().physiology.samples.find((s) => Math.abs(s.t - time) < 0.00051)!;
    return [sample.velocities.hvRight / 10, sample.velocities.pvTrunk / 10, sample.velocities.interlobarVein1 / 10];
  });
  expect(shown.slice(0, 3)).toEqual(expected.map((v) => `${v.toFixed(2)} cm/s`));
  for (let i = 0; i < 3; i++) {
    const xy = pausedPaths[i]!.match(/L([\d.-]+),([\d.-]+)$/)!;
    expect(Number(xy[1])).toBe(800);
    expect(Math.abs(Number(xy[2]) - (45 - (expected[i] / 60) * 40))).toBeLessThanOrEqual(0.051);
  }
  const previous = await cursor.inputValue();
  await cursor.focus();
  await page.keyboard.press('ArrowLeft');
  expect(Number(await cursor.inputValue())).toBe(Number(previous) - 1);
  const markers = await dialog.locator('.venous-cursor').evaluateAll((els) => els.map((e) => e.getAttribute('d')));
  expect(new Set(markers).size).toBe(1);
  // Atajos del ecógrafo de fondo no deben cambiar modo ni congelación desde el modal.
  const frozen = await page.evaluate(() => window.__vexusTest!.sim().frozen);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__vexusTest!.sim().frozen)).toBe(frozen);
  await page.evaluate(() => window.__vexusTest!.advance(1));
  expect(await dialog.locator('.venous-wave').evaluateAll((els) => els.map((e) => e.getAttribute('d')))).toEqual(pausedPaths);
  await dialog.getByRole('combobox', { name: 'Escala común de velocidad' }).selectOption('20');
  await expect(dialog.locator('.venous-status')).toContainText('fuera de escala');
  await dialog.getByRole('combobox', { name: 'Escala común de velocidad' }).selectOption('120');
  await expect(dialog.locator('.venous-limits').first()).toHaveText('+120 / 0 / −120 cm/s');
  await dialog.getByRole('combobox', { name: 'Escala común de velocidad' }).selectOption('60');
  await dialog.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: info.outputPath('venous-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await dialog.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: info.outputPath('venous-mobile.png') });
  await dialog.locator('.venous-readout').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('venous-mobile-cursor.png') });
  await dialog.getByRole('button', { name: 'Reanudar vista' }).click();
  await expect(cursor).toBeDisabled();
  await expect(dialog.locator('.venous-status')).toContainText('En vivo');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(open).toBeFocused();
  await expect(page.locator('.venous-viewer .venous-readout')).toHaveText('');
  // El flujo vivo ya se comprobó. Probar además reapertura congelada evita redibujar
  // GPU de fondo entre comprobaciones de limpieza y cubre ese estado del usuario.
  await page.locator('#freeze').click({ force: true });
  expect(await page.evaluate(() => window.__vexusTest!.sim().frozen)).toBe(true);
  await open.click({ force: true });
  await expect(dialog.locator('.venous-status')).toContainText('Paciente congelado');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await open.click({ force: true });
  // También se limpia si el estado docente cambia con el modal todavía abierto.
  await page.locator('#debug-toggle').evaluate((el) => (el as HTMLInputElement).click());
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.venous-readout')).toHaveText('');
  await expect(page.locator('.venous-case')).toHaveText('');
  await expect(page.locator('.venous-wave').first()).toHaveAttribute('d', '');
  expect(errors).toEqual([]);
});

test('PW comparado: potencia espectral real, ECG, marcas opcionales y escala independiente', async ({ page }, info) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=1&docente=1');
  await page.locator('#debug-toggle').check({ force: true });
  await page.getByRole('tab', { name: 'Docente' }).click({ force: true });
  await page.evaluate(() => window.__vexusTest!.advance(30));
  await page.locator('#freeze').click({ force: true });
  const before = await page.evaluate(() => ({ t: window.__vexusTest!.sim().physiology.clock.t, frozen: window.__vexusTest!.sim().frozen }));
  await page.getByRole('button', { name: 'Abrir comparación venosa' }).click({ force: true });
  const dialog = page.getByRole('dialog', { name: 'Comparación venosa' });
  await expect(dialog.getByRole('combobox', { name: 'Tipo de visualización venosa' })).toHaveValue('pw');
  const canvases = dialog.locator('.venous-spectrum');
  await expect(canvases).toHaveCount(3);
  await withinFrames(page, 140, 'reconstrucción de tres señales IQ', async () => {
    const times = await canvases.evaluateAll((els) => els.map((el) => Number((el as HTMLCanvasElement).dataset.lastTime)));
    return times.every((t) => before.t - t < 0.15) || `últimas columnas ${times.join(', ')}`;
  });
  expect(
    await canvases.evaluateAll((els) =>
      els.map((el) => {
        const c = el as HTMLCanvasElement;
        const d = c.getContext('2d')!.getImageData(20, 15, c.width - 120, c.height - 50).data;
        const levels = new Set<number>();
        let nonzero = 0;
        for (let i = 0; i < d.length; i += 4) {
          levels.add(d[i]);
          if (d[i] > 12) nonzero++;
        }
        return levels.size > 30 && nonzero > 1000;
      }),
    ),
  ).toEqual([true, true, true]);
  await dialog.getByRole('checkbox', { name: 'Marcas A/S/D y máximos/mínimos' }).check();
  await expect(canvases.first()).toHaveAttribute('data-marks', /S/);
  await expect(canvases.first()).toHaveAttribute('data-marks', /D/);
  await expect(canvases.first()).toHaveAttribute('data-marks', /A/);
  await page.setViewportSize({ width: 1280, height: 1380 });
  await withinFrames(
    page,
    20,
    'resolución nativa del canvas',
    async () =>
      (await canvases
        .first()
        .evaluate((el) => Math.abs((el as HTMLCanvasElement).width - el.clientWidth * Math.min(2, devicePixelRatio)) < 2)) ||
      'resolución antigua',
  );
  const alignedAxes = () =>
    dialog.evaluate((el) => {
      const image = el.querySelector('.venous-spectrum')!.getBoundingClientRect();
      const traces = [...el.querySelectorAll('.venous-marker-row svg')].map((svg) => svg.getBoundingClientRect());
      return traces.every((trace) => Math.abs(trace.x - image.x) < 1 && Math.abs(trace.width - (image.width - 58)) < 1);
    });
  expect(await alignedAxes()).toBe(true);
  // Baseline is a reversible display transform. It must not reconstruct IQ or move the patient's clock.
  const snapshot = () =>
    canvases.evaluateAll((els) =>
      els.map((el) => {
        const c = el as HTMLCanvasElement;
        // Repeated getImageData on the live canvas makes Chromium switch its renderer
        // from GPU to CPU, changing antialiased text pixels during the assertion.
        // Read a disposable software copy so the test does not mutate the renderer it verifies.
        const copy = document.createElement('canvas');
        copy.width = c.width;
        copy.height = c.height;
        const context = copy.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(c, 0, 0);
        const data = context.getImageData(0, 0, copy.width, copy.height).data;
        let hash = 2166136261;
        for (const v of data) hash = Math.imul(hash ^ v, 16777619) >>> 0;
        const yellowRows: number[] = [];
        for (let y = 0; y < c.height; y++) {
          const at = (y * c.width + 10) * 4;
          if (data[at] - data[at + 2] > 50 && data[at + 1] - data[at + 2] > 45 && data[at] - data[at + 1] < 30) yellowRows.push(y);
        }
        return {
          hash,
          columns: c.dataset.columns,
          lastTime: c.dataset.lastTime,
          marks: c.dataset.marks,
          zeroY: yellowRows.length ? yellowRows.reduce((a, b) => a + b, 0) / yellowRows.length : null,
        };
      }),
    );
  const original = await snapshot();
  expect(original.every((r) => r.zeroY !== null)).toBe(true);
  const baseline = dialog.getByRole('slider', { name: /^Línea de base/ }).first();
  await baseline.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(canvases.first()).toHaveAttribute('data-baseline', '0.2');
  const shifted = await snapshot();
  expect(shifted[0].zeroY!).toBeGreaterThan(original[0].zeroY! + 20);
  expect(shifted[0].hash).not.toBe(original[0].hash);
  expect(shifted.slice(1)).toEqual(original.slice(1));
  for (const key of ['columns', 'lastTime', 'marks'] as const) expect(shifted[0][key]).toBe(original[0][key]);
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await expect(canvases.first()).toHaveAttribute('data-baseline', '0');
  expect(await snapshot()).toEqual(original);
  await page.screenshot({ path: info.outputPath('venous-pw-desktop.png') });
  await dialog.getByRole('button', { name: 'Pausar vista', exact: true }).click();
  const cursor = dialog.getByRole('slider', { name: 'Cursor sincronizado' });
  await cursor.focus();
  await page.keyboard.press('ArrowLeft');
  const rowScales = dialog.locator('[aria-label^="Escala PW"]');
  await rowScales.nth(1).selectOption('80');
  await expect(rowScales.nth(0)).toHaveValue('50');
  await expect(rowScales.nth(1)).toHaveValue('80');
  await expect(rowScales.nth(2)).toHaveValue('40');
  await withinFrames(
    page,
    140,
    'nueva escala sin imagen incompleta',
    async () =>
      (await canvases.evaluateAll((els) =>
        els.every(
          (el) =>
            Number((el as HTMLElement).dataset.lastTime) >
            Number(document.querySelector('.venous-readout')!.textContent.match(/^t ([\d.]+)/)![1]) - 0.15,
        ),
      )) || 'reconstrucción pendiente',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await dialog.evaluate((el) => {
    el.scrollTop = 0;
  });
  await withinFrames(
    page,
    20,
    'texto espectral móvil a resolución nativa',
    async () =>
      (await canvases
        .first()
        .evaluate((el) => Math.abs((el as HTMLCanvasElement).width - el.clientWidth * Math.min(2, devicePixelRatio)) < 2)) ||
      'resolución antigua',
  );
  expect(await alignedAxes()).toBe(true);
  await page.screenshot({ path: info.outputPath('venous-pw-mobile.png') });
  await dialog.locator('.venous-marker-row').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('venous-pw-mobile-ecg.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() => ({ t: window.__vexusTest!.sim().physiology.clock.t, frozen: window.__vexusTest!.sim().frozen })),
  ).toEqual(before);
  await expect(page.locator('.venous-spectrum').first()).toHaveAttribute('data-columns', '0');
  expect(errors).toEqual([]);
});
