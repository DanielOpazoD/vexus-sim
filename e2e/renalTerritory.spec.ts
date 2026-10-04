import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

for (const [id, pattern] of [
  ['normal-adult', 'continuo'],
  ['severe-congestion', 'monofásico'],
] as const) {
  test(`calibración territorial renal: captura adquirida ${id}`, async ({ page }, testInfo) => {
    budget(240_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const errors = await bootWithoutErrors(page);
    await page.selectOption('#case-select', id);
    await page
      .locator('button', { hasText: /Apnea\s*esp/ })
      .first()
      .click();
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
        el.value = '50';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const particleCount = await page.evaluate(() => {
      const t = window.__vexusTest!;
      t.advance(30);
      t.advance(8);
      t.sim().render();
      return t.sim().sampleVolume.particleCount;
    });
    expect(particleCount).toBe(1280);
    await page.locator('#freeze').click();
    await expect(page.locator('#freeze')).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('tab', { name: 'Medir', exact: true }).click();
    await page.getByRole('button', { name: 'Renal', exact: true }).click();
    await page.getByRole('button', { name: 'Capturar', exact: true }).click();
    await expect(page.locator('.result')).toContainText(new RegExp(`Renal: S [\\d.]+ · D [\\d.]+ · mín [-\\d.]+ cm/s → ${pattern}`));
    console.log(JSON.stringify({ case: id, result: await page.locator('.result').innerText() }));
    await page.screenshot({ path: testInfo.outputPath(`venous-renal-territory-${id}.png`) });
    expect(errors).toEqual([]);
  });
}

test('puerta arterial renal: no certifica continuidad venosa por error', async ({ page }, testInfo) => {
  budget(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = await bootWithoutErrors(page);
  await page.selectOption('#case-select', 'severe-congestion');
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  await page.locator('#mode-pw').click();
  await page.evaluate(() => {
    const t = window.__vexusTest!;
    t.goToStartPoint('renal');
    t.setPose({ ...t.sim().pose, tilt: t.sim().pose.tilt - (2 * Math.PI) / 180 });
    // Gate verified by the paired-acquisition audit, not a synthetic spectral fixture.
    t.placeGateAt(0.4265880543219286, 48);
  });
  await page.getByRole('tab', { name: 'Doppler', exact: true }).click();
  await page
    .getByRole('slider', { name: 'Escala', exact: true })
    .last()
    .evaluate((el: HTMLInputElement) => {
      el.value = '50';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const vessel = await page.evaluate(() => {
    const t = window.__vexusTest!;
    t.advance(30);
    t.advance(8);
    t.sim().render();
    return { vessel: t.sim().gateInfo?.vessel, particles: t.sim().sampleVolume.particleCount };
  });
  expect(vessel.vessel).toMatch(/^interlobarArtery/);
  expect(vessel.particles).toBe(1280);
  await page.locator('#freeze').click();
  await expect(page.locator('#freeze')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('venous-renal-arterial-spectrum.png') });
  await page.getByRole('tab', { name: 'Medir', exact: true }).click();
  await page.getByRole('button', { name: 'Renal', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();
  await expect(page.locator('.result')).toContainText('no medible automáticamente');
  await expect(page.locator('.result')).toContainText('arteria');
  await expect(page.locator('.result')).not.toContainText('→ continuo');
  await page.screenshot({ path: testInfo.outputPath('venous-renal-arterial-rejected.png') });
  expect(errors).toEqual([]);
});
