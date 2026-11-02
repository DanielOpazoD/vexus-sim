import { expect, test } from '@playwright/test';
import { Tissue } from '../src/anatomy/tissues';
import { bootWithoutErrors, budget, checkAfterEach, windowAcquired } from './support';

checkAfterEach();
// Las poses vecinas y las otras ventanas, con sus capturas, son evidencia en Metal, fuera de CI: en SwiftShader superan el plazo (decisión 315).
// Los rayos de esas poses se comprueban en `ivcAtriumWindow.test.ts`.
test('VCI–AD: la ventana adquiere el B de su pose central', async ({ page }) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('[data-window="subxiphoid"]').click();
  await windowAcquired(page, 'subxiphoid');
  const state = await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    return { pose: s.pose, acquired: s.renderer.displayedAnatomy!.pose };
  });
  expect(state.acquired).toEqual(state.pose);
  expect(errors).toEqual([]);
});

test('bloque cardíaco registrado conserva paridad CPU/GPU con suelo y vecinos', async ({ page }, info) => {
  budget(180_000);
  await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  const report = await page.evaluate(() => {
    const s = window.__vexusTest!.sim(),
      cal = s.anatomy.caliberFor(s.sample),
      points: number[] = [],
      cpu: number[] = [];
    for (let x = -55.37; x < 90; x += 7)
      for (let y = -25.23; y < 80; y += 7)
        for (let z = -25.41; z < 110; z += 7) {
          const p: [number, number, number] = [x, y, z],
            c = s.scene.classify(p, cal);
          if (c.boundaryDistance <= 1) continue;
          points.push(...s.anatomy.deformation.toWorld(p, s.sample.resp));
          cpu.push(c.tissue);
        }
    const gpu = s.gpuQuery(new Float32Array(points), s.frame, true);
    return {
      count: cpu.length,
      tissues: cpu.reduce<Record<string, number>>((r, t) => {
        r[t] = (r[t] ?? 0) + 1;
        return r;
      }, {}),
      mismatches: cpu.flatMap((t, i) => (t === gpu.tissue[i] ? [] : [{ p: points.slice(3 * i, 3 * i + 3), cpu: t, gpu: gpu.tissue[i] }])),
    };
  });
  await info.attach('cardiac-parity.json', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report.count).toBeGreaterThan(2000);
  expect(report.tissues['6']).toBeGreaterThan(100);
  expect(report.tissues[Number(Tissue.Myocardium)]).toBeGreaterThan(100);
  expect(report.mismatches).toEqual([]);
});
