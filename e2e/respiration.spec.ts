import { expect, test } from '@playwright/test';
import { bootWithoutErrors } from './support';

// Dos contratos independientes: fisiología/PW y el ciclo de configuración/medición M.
// Conserva todas las aserciones y el plazo original; evita acumular ambos flujos en180s.
for (const reference of [false, true]) {
  test(`respiración apagada: corazón y PW activos (${reference ? 'referencia' : 'legacy'})`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = await bootWithoutErrors(page, reference ? '?e2e=1&reference=1' : '?e2e=1');
    await expect(page.getByRole('button', { name: 'Activar respiración', exact: true })).toBeVisible();
    const held = await page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      const start = s.physiology.clock.t;
      const beat = s.sample.beatIndex;
      const values = [];
      for (let i = 0; i < 20; i++) {
        window.__vexusTest!.advance(0.1);
        values.push({
          phase: s.sample.resp.phase,
          volume: s.sample.resp.volume,
          motion: s.sample.resp.diaphragmCaudalMm,
          ecg: s.sample.ecgMv,
          flow: s.sample.qHepaticVein,
        });
      }
      return { start, end: s.physiology.clock.t, beat, lastBeat: s.sample.beatIndex, frozen: s.frozen, values };
    });
    expect(held.end - held.start).toBeGreaterThan(1.9);
    expect(held.lastBeat).toBeGreaterThan(held.beat);
    expect(held.frozen).toBe(false);
    expect(held.values.every((v) => v.phase === 0 && v.volume === 0 && v.motion === 0)).toBe(true);
    expect(Math.max(...held.values.map((v) => v.ecg)) - Math.min(...held.values.map((v) => v.ecg))).toBeGreaterThan(0.1);
    expect(Math.max(...held.values.map((v) => v.flow)) - Math.min(...held.values.map((v) => v.flow))).toBeGreaterThan(0.1);
    await page.locator('#mode-pw').click();
    expect(
      await page.evaluate(() => {
        window.__vexusTest!.goToStartPoint('portal');
        return window.__vexusTest!.placeGate(['pvTrunk']);
      }),
    ).toBe(true);
    const pw = await page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      const before = s.spectral.columns.length;
      window.__vexusTest!.advance(2);
      return { before, after: s.spectral.columns.length, cycling: s.sample.resp.cycling, phase: s.sample.resp.phase };
    });
    expect(pw.after).toBeGreaterThan(pw.before + 30);
    expect(pw).toMatchObject({ cycling: false, phase: 0 });
    expect(errors).toEqual([]);
  });
  test(`respiración y M: activar, medir y volver a apagar (${reference ? 'referencia' : 'legacy'})`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = await bootWithoutErrors(page, reference ? '?e2e=1&reference=1' : '?e2e=1');
    await expect(page.getByRole('button', { name: 'Activar respiración', exact: true })).toBeVisible();
    await page.evaluate(() => window.__vexusTest!.goToStartPoint('subxiphoid'));
    await page.locator('#mode-m').click();
    await page.getByRole('tab', { name: 'Medir' }).click();
    await page.getByRole('button', { name: 'VCI modo M', exact: true }).click();
    const box = (await page.locator('#mmode').boundingBox())!;
    for (const dx of [40, 80]) for (const dy of [40, 60]) await page.mouse.click(box.x + dx, box.y + dy);
    await expect(page.locator('.result')).toContainText('sin ciclo respiratorio completo');
    await expect(page.locator('.result')).not.toContainText('colapso');
    await page.getByRole('tab', { name: 'Adquirir' }).click();
    await page.getByRole('button', { name: 'Activar respiración', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Desactivar respiración', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => {
        const s = window.__vexusTest!.sim();
        const values = [];
        for (let i = 0; i < 50; i++) {
          window.__vexusTest!.advance(0.1);
          values.push(s.sample.resp.volume);
        }
        return Math.max(...values) - Math.min(...values);
      }),
    ).toBeGreaterThan(0.9);
    // Avanzar fisiología sin renderizar deja un hueco real en la franja M: no acredita un ciclo adquirido.
    await page.getByRole('tab', { name: 'Medir' }).click();
    await page.getByRole('button', { name: 'VCI modo M', exact: true }).click();
    const freshBox = (await page.locator('#mmode').boundingBox())!;
    for (const dx of [50, 100]) for (const dy of [40, 70]) await page.mouse.click(freshBox.x + dx, freshBox.y + dy);
    await expect(page.locator('.result')).toContainText('sin ciclo respiratorio completo');
    await expect(page.locator('.result')).not.toContainText('colapso');
    await page.getByRole('tab', { name: 'Adquirir' }).click();
    await page.getByRole('button', { name: 'Desactivar respiración', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Activar respiración', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => {
        window.__vexusTest!.advance(0.1);
        return window.__vexusTest!.sim().sample.resp;
      }),
    ).toMatchObject({ cycling: false, phase: 0, volume: 0 });
    expect(errors).toEqual([]);
  });
}
