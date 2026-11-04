import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';
import fixtures from '../src/validation/fixtures/s0028-wall-chart.json' with { type: 'json' };

test('la GPU s0028 conserva la banda D/E con identidad U y el panículo regional CPU', async ({ page }) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=1&abdomen=s0028');
  const rows = await page.evaluate((fixtures) => {
    const sim = window.__vexusTest!.sim();
    // Banda y panículo, y la regla directa a 20 y 60 mm: con celda D/E la consulta vale a cualquier profundidad.
    const points = fixtures.flatMap((f) => [f.point, ...[10, 20, 60].map((d) => f.skin.map((s, k) => s - d * f.normal[k]))]);
    const gpu = sim.gpuQuery(new Float32Array(points.flat()), sim.frame, false);
    return points.map((p, i) => ({
      p,
      cpu: Number(sim.anatomy.classifyWorld([p[0], p[1], p[2]], sim.sample).tissue),
      gpu: gpu.tissue[i],
    }));
  }, fixtures);
  expect(
    rows.every((row) => row.cpu === row.gpu),
    JSON.stringify(rows),
  ).toBe(true);
  // Normales analíticas de las caras de pared: GPU frente a CPU con el contrato del banco de pared (smoke.spec).
  const normals = [];
  for (const startPoint of ['epigastric', 'subcostal'] as const) {
    const n = await page.evaluate((id) => window.__vexusTest!.wallNormals({ startPoint: id }), startPoint);
    const tag = `${startPoint} normales: ${JSON.stringify(n)}`;
    expect(n.points, tag).toBeGreaterThan(300);
    expect(n.mismatched / (n.points + n.mismatched), tag).toBeLessThan(0.01);
    expect(n.p05, tag).toBeGreaterThan(0.98);
    expect(n.normErrP95, tag).toBeLessThan(0.01);
    normals.push({ startPoint, ...n });
  }
  await test.info().attach('normales-pared-s0028', { body: JSON.stringify(normals, null, 2), contentType: 'application/json' });
  // r2b-U: el peso respiratorio GLSL es el de la CPU en celdas D/E y en la rampa U por fila (una lectura filtrada).
  const resp = await page.evaluate(() => window.__vexusTest!.respirationParity());
  const respTag = `respiración: ${JSON.stringify(resp)}`;
  expect(resp.u, respTag).toBeGreaterThan(1000);
  expect(resp.movingU, respTag).toBeGreaterThan(300);
  expect(resp.p99WeightDiffU, respTag).toBeLessThan(0.005);
  expect(resp.maxWeightDiffU, respTag).toBeLessThan(0.05);
  expect(resp.maxWeightDiffKnown, respTag).toBeLessThan(0.05);
  expect(resp.maxGradientDiff, respTag).toBeLessThan(0.01);
  await test.info().attach('respiracion-s0028', { body: JSON.stringify(resp, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
