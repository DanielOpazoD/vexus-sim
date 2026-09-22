import { expect, test } from '@playwright/test';

/**
 * Gate de equivalencia TS ↔ GLSL (Fase 0). La anatomía existe dos veces: en
 * TypeScript (medición, PW, corte) y en GLSL (imagen, color). Aquí, con WebGL real
 * (SwiftShader en CI), se comparan en los cuatro puntos de partida de cada caso:
 * tejido lejos de bordes, identificador de vaso y velocidad de la sangre. Antes solo
 * se comprobaba a mano en la pestaña Docente y dejó pasar dos divergencias.
 */
const CASES = ['normal-adult', 'severe-congestion', 'af-moderate-congestion'] as const;

test('la anatomía GLSL coincide con la TypeScript en tejido, vaso y velocidad', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?e2e=1');
  await expect(page.locator('#status')).toContainText(/\d+ fps/, { timeout: 60_000 });
  for (const id of CASES) {
    await page.selectOption('#case-select', id);
    await expect.poll(() => page.evaluate(() => typeof window.__vexusTest?.equivalenceSweep), { timeout: 30_000 }).toBe('function');
    const report = await page.evaluate(() => window.__vexusTest!.equivalenceSweep());
    expect(report).toHaveLength(4);
    for (const r of report) {
      const tag = `${id}/${r.id}: ${JSON.stringify(r)}`;
      expect(r.interiorAgreement, tag).toBeGreaterThanOrEqual(0.99);
      expect(r.vesselAgreement, tag).toBeGreaterThanOrEqual(0.98);
      expect(r.velocityP95RelErr, tag).toBeLessThanOrEqual(0.02);
    }
    // el gate tiene dientes: las ventanas vasculares contienen sangre que comparar
    expect(report.find((r) => r.id === 'subxiphoid')!.bloodCells).toBeGreaterThan(50);
    expect(report.find((r) => r.id === 'flank')!.bloodCells).toBeGreaterThan(50);
    // Volumen (Fase 2): 50 000 puntos de todo el tronco. Lejos de interfaces (≥ 1 mm) las dos
    // anatomías deben coincidir EXACTAMENTE: cambiar en GLSL el redondeo de la fisura umbilical
    // de 3 a 6 mm solo lo detecta esto (1 discrepancia en 18 000; las ventanas daban 100 %).
    const vol = await page.evaluate(() => window.__vexusTest!.volumeEquivalence(50_000));
    const vtag = `${id}/volumen: ${JSON.stringify(vol)}`;
    expect(vol.interiorPoints, vtag).toBeGreaterThan(40_000);
    expect(vol.tissueAgreement, vtag).toBe(1);
    expect(vol.bloodPoints, vtag).toBeGreaterThan(300);
    expect(vol.vesselAgreement, vtag).toBe(1);
    expect(vol.velocityP95RelErr, vtag).toBeLessThan(1e-3);
  }
});
