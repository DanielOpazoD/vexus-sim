import { expect, test } from '@playwright/test';
import type { ProbePositionInput } from '../src/app/probePosition';
import { bootWithoutErrors, budget } from './support';

test('copiar posición conserva mandos exactos y distingue la imagen congelada', async ({ page }) => {
  budget(20_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=legacy');
  let copied = '';
  // Captura solo el texto escrito por este botón; no lee ni altera el portapapeles del usuario.
  await page.exposeFunction('recordPosition', (text: string) => {
    copied = text;
  });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => (window as unknown as { recordPosition: (s: string) => Promise<void> }).recordPosition(text) },
    });
    const s = window.__vexusTest!.sim();
    s.setPose({ ...s.pose, phi: 3.019419873456789, z: -40.0000123456789 });
  });
  await page.getByRole('button', { name: 'Congelar', exact: true }).click();
  await page.getByRole('slider', { name: 'Rotación', exact: true }).press('ArrowRight');
  const before = await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    return structuredClone({ pose: s.pose, equipment: s.equipment, t: s.physiology.clock.t, pixels: [...s.renderer.readDisplay().gray] });
  });
  await page.getByRole('button', { name: 'Copiar posición', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Posición actual copiada' })).toBeVisible();
  const value = JSON.parse(copied) as ProbePositionInput & { scope: string; units: object };
  expect(value.pose).toEqual(before.pose);
  expect(value.equipment).toEqual(before.equipment);
  expect(value.context.frozen).toBe(true);
  expect(value.context.timeS).toBe(before.t);
  expect(value.source.anatomy).toBe('legacy');
  expect(value.source.transducer).toBe('convex-c35');
  expect(value.source.commit).toMatch(/^[a-f0-9]{7,40}$/);
  expect(value.scope).toBe('current-probe-and-equipment');
  expect(value.units).toEqual({ poseAngles: 'rad', poseDistances: 'mm' });
  const after = await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    return structuredClone({ pose: s.pose, equipment: s.equipment, t: s.physiology.clock.t, pixels: [...s.renderer.readDisplay().gray] });
  });
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});

test('portapapeles denegado o ausente ofrece texto seleccionado sin afirmar que lo copió', async ({ page }) => {
  budget(20_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=legacy');
  for (const unavailable of [false, true]) {
    await page.evaluate((missing) => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: missing ? undefined : { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) },
      });
    }, unavailable);
    await page.getByRole('button', { name: 'Copiar posición', exact: true }).click();
    const text = page.getByRole('textbox', { name: 'Posición y ajustes para copiar manualmente', exact: true });
    await expect(text).toBeVisible();
    await expect(text).toBeFocused();
    const value = await text.inputValue();
    expect((JSON.parse(value) as ProbePositionInput).pose).toEqual(await page.evaluate(() => window.__vexusTest!.sim().pose));
    expect(await text.evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart)).toBe(value.length);
    await expect(page.getByRole('status').filter({ hasText: 'Copia el texto seleccionado' })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
