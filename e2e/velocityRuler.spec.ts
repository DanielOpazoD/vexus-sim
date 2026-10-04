import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

test('escala PW lateral: cero, inversión, tamaño y ECG alineados', async ({ page }, testInfo) => {
  budget(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = await bootWithoutErrors(page);
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  // Settle physiology before enabling the expensive IQ observer. Only the following
  // eight seconds are needed for this ruler/viewport test, not thirty discarded seconds.
  const warmup = await page.evaluate(() => {
    const sim = window.__vexusTest!.sim();
    const before = sim.physiology.clock.t;
    const enabled = sim.pw.enabled;
    window.__vexusTest!.advance(30);
    return { enabled, elapsed: sim.physiology.clock.t - before, columns: sim.pwChain.spectral.columns.length };
  });
  expect(warmup.enabled).toBe(false);
  expect(warmup.elapsed).toBeGreaterThanOrEqual(29.99);
  expect(warmup.columns).toBe(0);
  await page.locator('#mode-pw').click();
  expect(
    await page.evaluate(() => {
      const t = window.__vexusTest!;
      t.goToStartPoint('renal');
      return t.placeGate(['interlobarVein1', 'interlobarVein2', 'interlobarVein3']);
    }),
  ).toBe(true);
  await page.getByRole('tab', { name: 'Doppler', exact: true }).click();
  await page
    .getByRole('slider', { name: 'Escala', exact: true })
    .last()
    .evaluate((el: HTMLInputElement) => {
      el.value = '40';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await page.getByRole('button', { name: 'Avanzado', exact: true }).click();
  await page.getByRole('slider', { name: 'Línea de base', exact: true }).evaluate((el: HTMLInputElement) => {
    el.value = '0.25';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#pw-scale')).toHaveAttribute('aria-label', /-20\.0 a 60\.0/);
  const acquired = await page.evaluate(() => {
    window.__vexusTest!.advance(8);
    const sim = window.__vexusTest!.sim();
    sim.render();
    const columns = sim.pwChain.spectral.columns;
    return {
      count: columns.length,
      span: columns.at(-1)!.t - columns[0].t,
      age: sim.physiology.clock.t - columns.at(-1)!.t,
      finite: columns.every((c) => c.powerDb.every(Number.isFinite)),
    };
  });
  expect(acquired.count).toBeGreaterThan(100);
  expect(acquired.span).toBeGreaterThanOrEqual(6);
  expect(acquired.age).toBeGreaterThanOrEqual(0);
  expect(acquired.age).toBeLessThan(0.15);
  expect(acquired.finite).toBe(true);
  await page.locator('#freeze').click();
  await expect(page.locator('#freeze')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('venous-pw-lateral-scale-shift.png') });
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
  // A separate wide-band acquisition after resetting the displayed scale.
  // The asymmetric example above verifies ruler geometry, not a clinical velocity threshold.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Invertir espectro', exact: true }).click();
  await page
    .getByRole('slider', { name: 'Escala', exact: true })
    .last()
    .evaluate((el: HTMLInputElement) => {
      el.value = '80';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await page.getByRole('slider', { name: 'Línea de base', exact: true }).evaluate((el: HTMLInputElement) => {
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#freeze').click();
  await page.evaluate(() => {
    window.__vexusTest!.advance(8);
    window.__vexusTest!.sim().render();
  });
  await page.locator('#freeze').click();
  await expect(page.locator('#pw-scale')).toHaveAttribute('aria-label', /-80\.0 a 80\.0/);
  await page.screenshot({ path: testInfo.outputPath('venous-pw-lateral-scale-renal.png') });
  await page.locator('#mode-pw').click();
  await expect(page.locator('#pw-scale')).not.toBeVisible();
  expect(errors).toEqual([]);
});
