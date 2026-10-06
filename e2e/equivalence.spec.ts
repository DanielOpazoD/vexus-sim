import { expect, test } from '@playwright/test';
import { BOOT_MS, budget } from './support';

/**
 * Gate de equivalencia TS ↔ GLSL (Fase 0). La anatomía existe dos veces: en
 * TypeScript (medición, PW, corte) y en GLSL (imagen, color). Aquí, con WebGL real
 * (SwiftShader en CI), se comparan en los ocho puntos de partida de cada caso:
 * tejido lejos de bordes, identificador de vaso y velocidad de la sangre, y la cara de
 * interfaz que dibuja cada punto con su distancia (decisión 57). Antes solo se comprobaba
 * a mano en la pestaña Docente y dejó pasar dos divergencias.
 */
const CASES = ['normal-adult', 'severe-congestion', 'af-moderate-congestion'] as const;

for (const reference of [false, true])
  test(`la anatomía GLSL coincide con la TypeScript en tejido, vaso y velocidad (${reference ? 'referencia' : 'legacy'})`, async ({
    page,
  }) => {
    // En el corredor de GitHub (dos núcleos) la prueba ya tardaba 4,0 min con 240 s de plazo; la compresión
    // bajo la sonda (decisión 63) encarece cada clasificación en TS (el mapa mundo→material) y la pasa de 4 min
    // (600 s: la ventana de la porta, decisión 69, suma un quinto barrido por caso; la epigástrica y la subcostal,
    // decisión 83, un sexto y un séptimo), más el arranque (la compilación con SwiftShader, `BOOT_MS`)
    budget(600_000);
    await page.goto(reference ? '/?e2e=1&reference=1' : '/?e2e=1');
    await expect(page.locator('#status')).toContainText(/\d+ fps/, { timeout: BOOT_MS });
    for (const id of CASES) {
      await page.selectOption('#case-select', id);
      await expect.poll(() => page.evaluate(() => typeof window.__vexusTest?.equivalenceSweep), { timeout: 30_000 }).toBe('function');
      const report = await page.evaluate(() => window.__vexusTest!.equivalenceSweep());
      expect(report.map((r) => r.id)).toEqual([
        'subxiphoid',
        'epigastric',
        'intercostal',
        'subcostal',
        'flank',
        'portal',
        'renal',
        'hepatorenal',
      ]);
      for (const r of report) {
        const tag = `${id}/${r.id}: ${JSON.stringify(r)}`;
        expect(r.interiorAgreement, tag).toBeGreaterThanOrEqual(0.99);
        expect(r.vesselAgreement, tag).toBeGreaterThanOrEqual(0.98);
        expect(r.velocityP95RelErr, tag).toBeLessThanOrEqual(0.02);
      }
      // el gate tiene dientes: las ventanas vasculares contienen sangre que comparar
      expect(report.find((r) => r.id === 'subxiphoid')!.bloodCells).toBeGreaterThan(50);
      expect(report.find((r) => r.id === 'flank')!.bloodCells).toBeGreaterThan(50);
      expect(report.find((r) => r.id === 'portal')!.bloodCells).toBeGreaterThan(50);
      expect(report.find((r) => r.id === 'subcostal')!.bloodCells).toBeGreaterThan(50);
      // la transversa epigástrica corta de través la VCI y la aorta: 25 celdas interiores en el sano (66 y 55 en los
      // congestivos) con el TS como «GPU»
      expect(report.find((r) => r.id === 'epigastric')!.bloodCells).toBeGreaterThan(15);
      // Volumen (Fase 2): 60 000 puntos de todo el tronco. Lejos de interfaces (≥ 1 mm) las dos
      // anatomías deben coincidir EXACTAMENTE: cambiar en GLSL el redondeo de la fisura umbilical
      // de 3 a 6 mm solo lo detecta esto (1 discrepancia en 18 000; las ventanas daban 100 %).
      // Doce pares añaden superficies: mantener >40 000 muestras interiores aumentando el banco,
      // sin bajar la igualdad exacta ni alejar la exclusión de 1 mm de las interfaces (decisión 166).
      const vol = await page.evaluate(() => window.__vexusTest!.volumeEquivalence(60_000));
      const vtag = `${id}/volumen: ${JSON.stringify(vol)}`;
      expect(vol.interiorPoints, vtag).toBeGreaterThan(40_000);
      expect(vol.tissueAgreement, vtag).toBe(1);
      // el retroperitoneo (decisión 81) entra en el volumen: psoas, cuadrado lumbar y grasa retroperitoneal
      expect(vol.byTissue.Psoas ?? 0, vtag).toBeGreaterThan(50);
      expect(vol.byTissue.QuadratusLumborum ?? 0, vtag).toBeGreaterThan(50);
      expect(vol.byTissue.RetroperitonealFat ?? 0, vtag).toBeGreaterThan(500);
      // y el corazón y el mediastino (decisión 85): ~300 y ~700 puntos interiores por caso con la CPU
      expect(vol.byTissue.Myocardium ?? 0, vtag).toBeGreaterThan(100);
      expect(vol.byTissue.Mediastinum ?? 0, vtag).toBeGreaterThan(300);
      // PR119: los discos deben participar en el volumen de paridad, además del cartílago costal.
      expect(vol.byTissue.Vertebra ?? 0, vtag).toBeGreaterThan(1000);
      expect(vol.byTissue.Cartilage ?? 0, vtag).toBeGreaterThan(100);
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
        // el pericardio (decisión 85): la subxifoidea, la subcostal y el flanco lo cruzan
        'Pericardium',
        'VertebralCortex',
      ])
        expect(shell.byInterface[face] ?? 0, stag).toBeGreaterThan(50);
      expect(shell.agreement, stag).toBeGreaterThanOrEqual(0.999);
      expect(shell.distanceMaxErr, stag).toBeLessThan(0.02); // SwiftShader: 0,0033 mm; GPU real (M4): 2e-5
    }
  });

test('las tríadas portales de la GPU son las del gemelo TS, punto a punto (decisión 78)', async ({ page }) => {
  // arranca la aplicación (SwiftShader compila todos los programas, `BOOT_MS`) y luego compila el programa de consulta
  // (42–66 s en total en el corredor de GitHub con dos trabajadores)
  budget(120_000);
  await page.goto('/?e2e=1');
  await expect(page.locator('#status')).toContainText(/\d+ fps/, { timeout: BOOT_MS });
  await expect.poll(() => page.evaluate(() => typeof window.__vexusTest?.triadParity), { timeout: 30_000 }).toBe('function');
  const r = await page.evaluate(() => window.__vexusTest!.triadParity());
  const tag = JSON.stringify(r);
  // el hash entero da las mismas tríadas; solo difiere la geometría en float32 (bordes suaves de 0,12 mm)
  expect(r.points, tag).toBeGreaterThan(10_000);
  expect(r.inSheath, tag).toBeGreaterThan(2_000);
  expect(r.inLumen, tag).toBeGreaterThan(200);
  expect(r.maxAbs, tag).toBeLessThan(0.005);
});
