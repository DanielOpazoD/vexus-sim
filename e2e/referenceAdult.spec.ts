import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

test('el adulto de referencia carga el mismo campo corporal para imagen y consulta TS/GPU', async ({ page }, info) => {
  budget(180_000);
  const errors = await bootWithoutErrors(page, '?e2e=app');
  const result = await page.evaluate(() => {
    const T = window.__vexusTest!;
    const sim = T.sim();
    T.setCompound(false);
    sim.advance(0.02);
    sim.render();
    return {
      rows: sim.scene.torso.profile!.length,
      frameMs: T.frameCostMs(12),
      torso: { y0: sim.scene.torso.y0 },
      spine: sim.scene.spine,
      ribs: sim.scene.ribs,
      parity: T.volumeEquivalence(4000),
      windows: T.equivalenceSweep(),
    };
  });
  await info.attach('registered-reference.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.rows).toBe(520);
  expect(result.spine.y0).toBeCloseTo(-60.02345, 6);
  expect(result.ribs.every((r) => r.shape?.length === 4)).toBe(true);
  expect(result.parity.points).toBeGreaterThan(3000);
  expect(result.parity.tissueAgreement).toBe(1);
  for (const row of result.windows) {
    expect(row.interiorAgreement, row.id).toBe(1);
    expect(row.bloodCells, row.id).toBeGreaterThan(0);
    expect(row.vesselAgreement, row.id).toBe(1);
  }
  expect(result.windows.find((r) => r.id === 'subxiphoid')!.bloodCells).toBeGreaterThan(50);
  expect(result.windows.find((r) => r.id === 'flank')!.bloodCells).toBeGreaterThan(50);
  const f = await page.evaluate(() => window.__vexusTest!.framesRendered());
  await page.waitForFunction((n) => window.__vexusTest!.framesRendered() > n + 8, f);
  await page.keyboard.press('Space');
  await page.screenshot({ path: info.outputPath('reference-subxiphoid.png') });
  expect(errors).toEqual([]);
});

test('captura del modelo previo con el mismo equipo y punto de partida', async ({ page }, info) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&torso=legacy');
  const frameMs = await page.evaluate(() => {
    const T = window.__vexusTest!;
    T.setCompound(false);
    T.sim().advance(0.02);
    T.sim().render();
    return T.frameCostMs(12);
  });
  await info.attach('legacy-frame.json', {
    body: JSON.stringify({ frameMs, method: '12 renders + finishForTiming, no controlled host workload; matched equipment/pose' }),
    contentType: 'application/json',
  });
  const f = await page.evaluate(() => window.__vexusTest!.framesRendered());
  await page.waitForFunction((n) => window.__vexusTest!.framesRendered() > n + 8, f);
  await page.keyboard.press('Space');
  await page.screenshot({ path: info.outputPath('legacy-subxiphoid.png') });
  expect(errors).toEqual([]);
});
