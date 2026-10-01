import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

test('la cortical izquierda conserva normales espejo y obstruye el haz real', async ({ page }, info) => {
  budget(150_000);
  const errors = await bootWithoutErrors(page);
  const report = await page.evaluate(() => {
    const T = window.__vexusTest!;
    const sim = T.sim();
    T.setCompound(false);
    const material: [number, number, number][] = [];
    const cpu: number[][] = [];
    for (const rib of sim.scene.ribs)
      for (const side of [-1, 1]) {
        const p: [number, number, number] = [
          side * (sim.scene.torso.a * rib.scale + rib.halfThickness + 0.1),
          0,
          rib.zAnterior + rib.tilt * 0.5,
        ];
        material.push(p);
        cpu.push(sim.scene.faceGradient(p, sim.anatomy.caliberFor(sim.sample))!.normal);
      }
    const world = new Float32Array(material.flatMap((p) => sim.anatomy.deformation.toWorld(p, sim.sample.resp)));
    const gpu = sim.gpuQuery(world, sim.frame, true, { normals: true });
    const normals = Array.from({ length: material.length }, (_, i) => Array.from(gpu.normal!.slice(i * 3, i * 3 + 3)));
    const dots = cpu.map((n, i) => n.reduce((sum, v, a) => sum + v * normals[i][a], 0));
    const mirrorError = normals
      .filter((_, i) => i % 2 === 0)
      .map((n, i) => Math.hypot(n[0] + normals[i * 2 + 1][0], n[1] - normals[i * 2 + 1][1], n[2] - normals[i * 2 + 1][2]));
    sim.setPose({ ...sim.pose, phi: 0, z: 14, lift: 0 });
    sim.advance(0.02);
    sim.render();
    const g = sim.renderer.readSegments(sim.bmode.depthMm);
    const t = sim.renderer.readTransmission();
    const ratios: number[] = [];
    let clearLines = 0;
    const superficialHits = (grid: typeof g) =>
      Array.from(grid.hitBoneSeg!).filter((hit, l) => Math.abs(l - (grid.lines - 1) / 2) < 2 && hit >= 0 && hit * grid.stepMm < 50).length;
    const onRibSuperficialHits = superficialHits(g);
    for (let l = 0; l < g.lines; l++) {
      const hit = g.hitBoneSeg![l];
      if (hit < 0) {
        clearLines++;
        continue;
      }
      if (hit < 2 || hit + 12 >= g.rows) continue;
      const before = t.single[(hit - 2) * t.lines + l];
      const after = t.single[(hit + 12) * t.lines + l];
      if (before > 0) ratios.push(after / before);
    }
    const onRibPose = { ...sim.pose };
    sim.setPose({ ...sim.pose, z: 25, yaw: 0 });
    sim.advance(0.02);
    sim.render();
    const gap = sim.renderer.readSegments(sim.bmode.depthMm);
    const gapClearLines = Array.from(gap.hitBoneSeg!).filter((hit) => hit < 0).length;
    return {
      dots,
      mirrorError,
      gradNorm: Array.from(gpu.gradNorm!),
      ratios,
      clearLines,
      gapClearLines,
      onRibSuperficialHits,
      gapSuperficialHits: superficialHits(gap),
      lines: g.lines,
      onRibPose,
      gapPose: sim.pose,
    };
  });
  await info.attach('left-costal-acquisition.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  expect(report.dots).toHaveLength(12);
  expect(Math.min(...report.dots)).toBeGreaterThan(0.98);
  expect(Math.max(...report.mirrorError)).toBeLessThan(0.01);
  expect(report.gradNorm.every((n) => Number.isFinite(n) && n > 0.5)).toBe(true);
  expect(report.ratios.length).toBeGreaterThan(5);
  expect(report.onRibSuperficialHits).toBe(4);
  // La apertura finita aún intersecta el borde: espacio parcialmente abierto, no ventana libre de sombra.
  expect(report.gapSuperficialHits).toBeLessThan(report.onRibSuperficialHits);
  expect(Math.max(...report.ratios)).toBeLessThan(0.01);
  await page.screenshot({ path: info.outputPath('costal-left-validated.png') });
  expect(errors).toEqual([]);
});
