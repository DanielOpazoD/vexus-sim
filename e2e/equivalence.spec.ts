import { expect, test } from '@playwright/test';

/**
 * Gate de equivalencia TS ↔ GLSL (Fase 0). La anatomía existe dos veces: en
 * TypeScript (medición, PW, corte) y en GLSL (imagen, color). Aquí, con WebGL real
 * (SwiftShader en CI), se comparan en los cuatro puntos de partida de cada caso:
 * tejido lejos de bordes, identificador de vaso y velocidad de la sangre, y la cara de
 * interfaz que dibuja cada punto con su distancia (decisión 57). Antes solo se comprobaba
 * a mano en la pestaña Docente y dejó pasar dos divergencias.
 */
const CASES = ['normal-adult', 'severe-congestion', 'af-moderate-congestion'] as const;

test('la anatomía GLSL coincide con la TypeScript en tejido, vaso y velocidad', async ({ page }) => {
  // En el corredor de GitHub (dos núcleos) la prueba ya tardaba 4,0 min con 240 s de plazo; la compresión
  // bajo la sonda (decisión 63) encarece cada clasificación en TS (el mapa mundo→material) y la pasa de 4 min
  test.setTimeout(480_000);
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
    // Caras de interfaz (decisión 57): lejos de los bordes, la misma cara (luz de cada sistema, mitad
    // abdominal del diafragma, mitades de la grasa perirrenal) y la misma distancia a ella
    expect(vol.interfacePoints, vtag).toBeGreaterThan(300);
    expect(vol.interfaceAgreement, vtag).toBe(1);
    // 7e-6 mm con GPU real (M4); SwiftShader llega a 0,014 mm en la cara del diafragma, cuya distancia
    // es empinada junto al borde de la cúpula: una décima de la anchura del eco (σh 0,14 mm), invisible
    expect(vol.interfaceDistanceMaxErr, vtag).toBeLessThan(0.02);
    // …y en la cáscara donde se dibuja el eco (0,01–0,6 mm de la cara, según la CPU o la GPU): el
    // reparto de dueños es una comparación real (umbral de Morison, mitades), así que se admite un
    // desacuerdo por mil y se listan
    const shell = await page.evaluate(() => window.__vexusTest!.interfaceShell());
    const stag = `${id}/cáscara: ${JSON.stringify(shell)}`;
    expect(shell.points, stag).toBeGreaterThan(5000);
    // con las capas de la pared y las costillas de la decisión 62 (la pared ondula en (u, z): la misma
    // fórmula en TS y en GLSL, `organs/wall.ts`)
    for (const face of [
      'IvcLumen',
      'VeinLumen',
      'PortalLumen',
      'LiverCapsule',
      'DiaphragmLiver',
      'RenalCapsule',
      'PerirenalFat',
      'SkinFat',
      'Scarpa',
      'DeepFascia',
      'ObliquePlane',
      'TransversusPlane',
      'Transversalis',
      'Peritoneum',
      'RibCortex',
      'Perichondrium',
    ])
      expect(shell.byInterface[face] ?? 0, stag).toBeGreaterThan(50);
    expect(shell.agreement, stag).toBeGreaterThanOrEqual(0.999);
    expect(shell.distanceMaxErr, stag).toBeLessThan(0.02); // SwiftShader: 0,0033 mm; GPU real (M4): 2e-5
  }
});
