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
  await expect(dialog.locator('.venous-row figcaption span').first()).toContainText(/S -[\d.]+.*D -[\d.]+.*cm\/s · mediana 4 lat\./);
  await expect(dialog.locator('.venous-row figcaption span').nth(1)).toContainText(/Vmáx \+[\d.]+.*Vmín \+[\d.]+/);
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
  const gateCenters = await canvases.evaluateAll((els) => els.map((e) => (e as HTMLCanvasElement).dataset.gateCenter));
  expect(gateCenters.every((g) => g?.startsWith('['))).toBe(true);
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
  // Image gain must change only pixels, retaining IQ history and source-derived marks.
  const portalRow = dialog.locator('.venous-row').nth(1);
  await portalRow.locator('summary').click();
  const imageGain = portalRow.getByRole('combobox', { name: 'Ganancia de imagen (dB) Porta' });
  const priorGain = await snapshot();
  const measuredValues = await dialog.locator('.venous-row figcaption span').allTextContents();
  await imageGain.selectOption('0');
  const lowGain = await snapshot();
  expect(await dialog.locator('.venous-row figcaption span').allTextContents()).toEqual(measuredValues);
  expect(lowGain[1].hash).not.toBe(priorGain[1].hash);
  expect(lowGain.map(({ hash: _h, ...rest }) => rest)).toEqual(priorGain.map(({ hash: _h, ...rest }) => rest));
  await imageGain.selectOption('15');
  expect(await snapshot()).toEqual(priorGain);
  await portalRow.locator('summary').click();
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
  await expect(rowScales.nth(2)).toHaveValue('50');
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
  expect(await canvases.evaluateAll((els) => els.map((e) => (e as HTMLCanvasElement).dataset.gateCenter))).toEqual(gateCenters);
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

test('PW comparado: calidad visible sin marcas y recuperación al ampliar escala renal', async ({ page }, info) => {
  budget(240_000);
  const errors = await bootWithoutErrors(page, '?e2e=1&docente=1');
  await page.selectOption('#case-select', 'severe-congestion');
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  await page.locator('#debug-toggle').check({ force: true });
  await page.getByRole('tab', { name: 'Docente' }).click({ force: true });
  await page.evaluate(() => {
    window.__vexusTest!.advance(30);
    window.__vexusTest!.sim().render();
  });
  await page.locator('#freeze').click();
  const before = await page.evaluate(() => window.__vexusTest!.sim().physiology.clock.t);
  await page.getByRole('button', { name: 'Abrir comparación venosa' }).click({ force: true });
  const dialog = page.getByRole('dialog', { name: 'Comparación venosa' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Marcas A/S/D y máximos/mínimos' })).not.toBeChecked();
  const renal = dialog.locator('.venous-row').nth(2);
  const scale = renal.getByRole('combobox', { name: 'Escala PW Vena interlobar derecha', exact: true });
  await scale.selectOption('20');
  await withinFrames(
    page,
    150,
    'aliasing renal comunicado sin anotaciones',
    async () => (await renal.locator('.venous-limits').innerText()).includes('aliasing') || 'adquiriendo PW',
  );
  await expect(renal.locator('canvas')).toHaveAttribute('data-marks', '');
  await dialog.getByRole('checkbox', { name: 'Marcas A/S/D y máximos/mínimos' }).check();
  await expect(renal.locator('figcaption span')).toHaveText('PW simulado');
  await scale.selectOption('80');
  await withinFrames(page, 150, 'captura renal recuperada sin modificar fisiología', async () => {
    const text = await renal.locator('.venous-limits').innerText();
    return (!text.includes('no medible') && !text.includes('Esperando')) || 'reconstruyendo adquisición';
  });
  await expect(renal.locator('figcaption span')).toContainText(/máx\. sist\..*diást\..*cm\/s · mediana 4 lat\./);
  expect(await page.evaluate(() => window.__vexusTest!.sim().physiology.clock.t)).toBe(before);
  await page.setViewportSize({ width: 1280, height: 1380 });
  await withinFrames(
    page,
    100,
    'historial completo antes de guardar evidencia visual',
    async () => !(await dialog.locator('.venous-status').innerText()).includes('Reconstruyendo') || 'reconstruyendo señal IQ',
  );
  await page.screenshot({ path: info.outputPath('venous-pw-quality-recovered.png') });
  expect(errors).toEqual([]);
});

test('laboratorio venoso: parámetros físicos, progresión calculada y aislamiento del paciente', async ({ page }, info) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=1&docente=1');
  await page.locator('#debug-toggle').check({ force: true });
  await page.getByRole('tab', { name: 'Docente' }).click({ force: true });
  await page.locator('#freeze').click({ force: true });
  const original = await page.evaluate(() => ({
    patient: JSON.stringify(window.__vexusTest!.sim().patient),
    t: window.__vexusTest!.sim().physiology.clock.t,
    frozen: window.__vexusTest!.sim().frozen,
  }));
  await page.getByRole('button', { name: 'Abrir comparación venosa' }).click({ force: true });
  const dialog = page.getByRole('dialog', { name: 'Comparación venosa' }),
    lab = dialog.locator('.venous-experiment');
  await lab.locator('summary').click();
  await lab.getByRole('checkbox', { name: 'Explorar estados estables independientes' }).check();
  await withinFrames(page, 140, 'estado experimental y señales iniciales', async () => {
    const status = await lab.locator('small').textContent();
    const times = await dialog
      .locator('.venous-spectrum')
      .evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.lastTime)));
    return Boolean(status?.includes('calculado: 0') && times.every((t) => t >= 29)) || 'calculando escenario inicial';
  });
  await expect(dialog.locator('.venous-case')).toContainText('Experimento hemodinámico');
  await lab.getByRole('button', { name: 'Guía 3', exact: true }).click();
  await withinFrames(page, 140, 'progresión a congestión avanzada con grado calculado', async () => {
    const status = await lab.locator('small').textContent();
    const times = await dialog
      .locator('.venous-spectrum')
      .evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.lastTime)));
    return Boolean(status?.includes('calculado: 3') && times.every((t) => t >= 29)) || 'reconstruyendo congestión';
  });
  await expect(lab.getByRole('slider', { name: 'PAD basal', exact: true })).toHaveValue('18');
  expect(Number(await lab.getByRole('slider', { name: 'Función sistólica VD (modelo)', exact: true }).inputValue())).toBeCloseTo(0.3, 12);
  await expect(lab).toContainText('transición clínica continua aún no está modelada');
  const renalRow = dialog.locator('.venous-row').nth(2);
  await renalRow.getByRole('combobox', { name: 'Escala PW Vena interlobar derecha', exact: true }).selectOption('20');
  await withinFrames(
    page,
    150,
    'aliasing al reducir la escala renal',
    async () => (await renalRow.locator('.venous-limits').innerText()).includes('aliasing') || 'reconstruyendo escala renal',
  );
  await renalRow.getByRole('combobox', { name: 'Escala PW Vena interlobar derecha', exact: true }).selectOption('80');
  const renalBase = renalRow.getByRole('slider', { name: 'Línea de base Vena interlobar derecha', exact: true });
  await renalBase.focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
  await expect(renalRow.locator('canvas')).toHaveAttribute('data-baseline', '0');
  await withinFrames(page, 100, 'escala renal sin plegamiento en el caso avanzado', async () => {
    const text = await renalRow.locator('.venous-limits').textContent();
    return Boolean(text && !text.includes('no medible') && !text.includes('Esperando')) || 'reconstruyendo escala renal';
  });
  await dialog.getByRole('combobox', { name: 'Filtro PW Porta', exact: true }).selectOption('5');
  await expect(dialog.locator('.venous-row').nth(1)).toContainText('filtro 5 Hz');
  await withinFrames(
    page,
    100,
    'reconstrucción tras cambiar filtro',
    async () => !(await dialog.locator('.venous-status').textContent())?.includes('Reconstruyendo') || 'reconstruyendo filtro',
  );
  await page.setViewportSize({ width: 1280, height: 1380 });
  await lab.locator('summary').click();
  await dialog.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: info.outputPath('venous-laboratory-grade3.png') });
  await lab.locator('summary').click();
  const compliance = lab.getByRole('slider', { name: 'Compliance reservorios venosos', exact: true });
  await expect(compliance).toHaveValue('1');
  await compliance.focus();
  await page.keyboard.press('Home');
  await expect(compliance).toHaveValue('0.5');
  await expect(lab).toContainText('solo reservorios esplácnico/periférico');
  const abdominal = lab.getByRole('slider', { name: 'Presión intraabdominal', exact: true });
  await abdominal.focus();
  await page.keyboard.press('End');
  await expect(abdominal).toHaveValue('25');
  await withinFrames(
    page,
    80,
    'ajuste individual con interpretación limitada por PIA',
    async () => (await lab.locator('small').textContent())?.includes('PIA alta: interpretación limitada') || 'calculando presión abdominal',
  );
  await expect(lab).toContainText('Personalizado');

  expect(
    await page.evaluate(() => ({
      patient: JSON.stringify(window.__vexusTest!.sim().patient),
      t: window.__vexusTest!.sim().physiology.clock.t,
      frozen: window.__vexusTest!.sim().frozen,
    })),
  ).toEqual(original);
  await page.setViewportSize({ width: 1280, height: 1380 });
  await dialog.evaluate((el) => {
    el.scrollTop = 0;
  });
  await withinFrames(
    page,
    150,
    'escenario completo antes de fotografiar los controles',
    async () => !(await dialog.locator('.venous-status').innerText()).includes('Reconstruyendo') || 'adquiriendo señal del experimento',
  );
  const controlRows = await lab.locator('fieldset > label').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().y));
  expect(controlRows[1]).toBeCloseTo(controlRows[2], 0);
  await page.screenshot({ path: info.outputPath('venous-laboratory-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const mobileRows = await lab.locator('fieldset > label').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().y));
  expect(mobileRows[2]).toBeGreaterThan(mobileRows[1]);
  await page.screenshot({ path: info.outputPath('venous-laboratory-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Abrir comparación venosa' }).click({ force: true });
  await expect(lab.getByRole('checkbox', { name: 'Explorar estados estables independientes' })).not.toBeChecked();
  await expect(dialog.locator('.venous-case')).toContainText('Adulto sano');
  expect(errors).toEqual([]);
});

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(
    'ventana renal pareada: cambia puerta, conserva paciente y no oculta calidad' +
      (caseId === 'severe-congestion' ? ' (congestión grave)' : ''),
    async ({ page }, info) => {
      budget(120_000);
      const errors = await bootWithoutErrors(page, '?e2e=1&docente=1');
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
