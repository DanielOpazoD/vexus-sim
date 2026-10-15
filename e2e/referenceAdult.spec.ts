import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';
import { Interface } from '../src/anatomy/interfaces';

test('el adulto de referencia carga el mismo campo corporal para imagen y consulta TS/GPU', async ({ page }, info) => {
  budget(180_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=legacy&reference=1');
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
  expect(result.ribs).toHaveLength(12);
  // Registered 5–10 retain their fitted shapes; floating 11–12 use explicit free-end fits.
  expect(result.ribs.filter((r) => r.number! >= 5).every((r) => r.shape?.length === 4)).toBe(true);
  // Upper 1–4 use the declared procedural torso ellipse, with no invented measured registration.
  expect(result.ribs.filter((r) => r.number! <= 4).every((r) => !r.shape && r.scale === 0.85)).toBe(true);
  expect(result.parity.points).toBeGreaterThan(3000);
  expect(result.parity.tissueAgreement).toBe(1);
  expect(result.windows.map((r) => r.id)).toEqual([
    'subxiphoid',
    'epigastric',
    'intercostal',
    'subcostal',
    'flank',
    'portal',
    'portalTrunk',
    'renal',
    'hepatorenal',
  ]);
  for (const row of result.windows) {
    expect(row.interiorAgreement, row.id).toBe(1);
    // Las siete ventanas vasculares mantienen su cobertura de sangre. La nueva vista
    // parenquimatosa se valida con corteza/hígado en hepatorenal.spec.ts, sin inventar vasos.
    if (row.id !== 'hepatorenal') expect(row.bloodCells, row.id).toBeGreaterThan(0);
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
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=legacy&torso=legacy');
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

test('la referencia conserva normales costales bilaterales y sombra tras el primer hueso', async ({ page }, info) => {
  budget(180_000);
  const errors = await bootWithoutErrors(page, '?e2e=1&abdomen=legacy&reference=1');
  const report = await page.evaluate(() => {
    const T = window.__vexusTest!;
    const sim = T.sim();
    T.setCompound(false);
    // Source-registered cortical bands in the wall, ribs 6–10. Rib 5 lies deeper
    // than the wall classifier and currently has no exterior cortex interface.
    const angles = [2.443460952792061, 2.356194490192345, 2.5132741228718345, 2.600540585471551, 2.6354471705114375];
    const points: [number, number, number][] = [];
    for (const [i, phi] of angles.entries()) {
      const rib = sim.scene.ribs[i + 1];
      const [a, b, y, c] = rib.shape!;
      const x = a * Math.cos(phi),
        dy = b * Math.sin(phi);
      const ratio = 1 + (rib.halfThickness + 0.1) / Math.hypot(x, dy);
      const z = rib.zAnterior + rib.tilt * (0.5 - 0.5 * Math.sin(phi)) + c * Math.cos(phi);
      for (const side of [-1, 1]) points.push([side * Math.abs(x * ratio), y + dy * ratio, z]);
    }
    const interfaces = points.map((p) => sim.scene.classify(p, sim.anatomy.caliberFor(sim.sample)).interface);
    const cpu = points.map((p) => sim.scene.faceGradient(p, sim.anatomy.caliberFor(sim.sample))!.normal);
    const world = new Float32Array(points.flatMap((p) => sim.anatomy.deformation.toWorld(p, sim.sample.resp)));
    const gpu = sim.gpuQuery(world, sim.frame, true, { normals: true });
    const normals = points.map((_, i) => Array.from(gpu.normal!.slice(i * 3, i * 3 + 3)));
    const dots = cpu.map((n, i) => n.reduce((s, v, a) => s + v * normals[i][a], 0));
    const mirrorError = normals
      .filter((_, i) => i % 2 === 0)
      .map((n, i) => Math.hypot(n[0] + normals[2 * i + 1][0], n[1] - normals[2 * i + 1][1], n[2] - normals[2 * i + 1][2]));
    const rib = sim.scene.ribs[0];
    sim.setPose({ ...sim.pose, phi: 0, z: rib.zAnterior + rib.tilt * 0.5 - rib.shape![3], lift: 0, yaw: 0, rock: 0, tilt: 0 });
    sim.advance(0.02);
    sim.render();
    const g = sim.renderer.readSegments(sim.bmode.depthMm);
    const t = sim.renderer.readTransmission();
    const ratios: number[] = [];
    const hits: number[] = [];
    for (let l = 0; l < g.lines; l++) {
      const hit = g.hitBoneSeg![l];
      if (hit < 2 || hit + 12 >= g.rows) continue;
      const before = t.single[(hit - 2) * t.lines + l];
      if (before > 0) {
        hits.push(hit * g.stepMm);
        ratios.push(t.single[(hit + 12) * t.lines + l] / before);
      }
    }
    return { points, interfaces, dots, mirrorError, gradNorm: Array.from(gpu.gradNorm!), ratios, hits, pose: sim.pose };
  });
  await info.attach('reference-costal-acquisition.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  expect(report.interfaces.every((f) => f === Interface.RibCortex)).toBe(true);
  expect(report.dots).toHaveLength(10);
  expect(Math.min(...report.dots)).toBeGreaterThan(0.98);
  expect(Math.max(...report.mirrorError)).toBeLessThan(0.01);
  expect(report.gradNorm.every((n) => Number.isFinite(n) && n > 0.5)).toBe(true);
  expect(report.ratios.length).toBeGreaterThan(5);
  expect(Math.max(...report.ratios)).toBeLessThan(0.01);
  await page.screenshot({ path: info.outputPath('reference-costal-shadow.png') });
  expect(errors).toEqual([]);
});
