import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

test('GPU acoustic prefixes retain bone-entry and gas loss for color without altering B', async ({ page }, info) => {
  budget(240_000);
  const errors = await bootWithoutErrors(page, '?e2e=1');
  const report = await page.evaluate(() => {
    const t = window.__vexusTest!,
      sim = t.sim();
    t.setCompound(false);
    let checked = 0,
      boneChecks = 0,
      gasChecks = 0,
      maxErrorDb = 0,
      maxBError = 0;
    for (const window of ['intercostal', 'renal', 'portal', 'subxiphoid'] as const) {
      t.goToStartPoint(window);
      sim.render();
      const tr = sim.renderer.readTransmission();
      const step = sim.bmode.depthMm / tr.samples;
      for (let line = 0; line < tr.lines; line += 5) {
        const theta = -sim.transducer.halfSector + (2 * sim.transducer.halfSector * (line + 0.5)) / tr.lines;
        const dir = sim.frame.axial.map((a, i) => a * Math.cos(theta) + sim.frame.lateral[i] * Math.sin(theta));
        let entered = false,
          bone = false,
          gas = false,
          fixed = 0,
          ambiguous = false;
        for (let row = 0; row < tr.samples; row++) {
          const k = row * tr.lines + line;
          if (tr.mirrorHit[k] >= 0) break; // PW oracle is a direct path, not a reflected diaphragm path.
          const r = (row + 0.5) * step;
          const p = sim.frame.curvatureCenter.map((c, i) => c + (sim.transducer.curvatureRadius + r) * dir[i]);
          const q = sim.anatomy.classifyWorld(p as [number, number, number], sim.sample);
          if (q.boundaryDistance < 0.03) ambiguous = true;
          if (Number(q.tissue) === 0 && !entered) continue;
          entered = true;
          if ([0, 10, 13].includes(q.tissue)) {
            fixed += (60 * step) / 10;
            gas = true;
          }
          if ([11, 22].includes(q.tissue) && !bone) {
            fixed += 100;
            bone = true;
          }
          if (ambiguous || row % 4) continue;
          checked++;
          boneChecks += Number(bone);
          gasChecks += Number(gas);
          maxErrorDb = Math.max(maxErrorDb, Math.abs(tr.fixedDb![k] - fixed));
          // Original B amplitude must still be the exponential of its unchanged total loss.
          maxBError = Math.max(maxBError, Math.abs(tr.single[k] - Math.pow(10, -tr.prefixDb![k] / 20)));
        }
      }
    }
    return { checked, boneChecks, gasChecks, maxErrorDb, maxBError };
  });
  await info.attach('fixed-barrier-prefixes.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  const tag = JSON.stringify(report);
  expect(report.checked, tag).toBeGreaterThan(1000);
  expect(report.boneChecks, tag).toBeGreaterThan(30);
  expect(report.gasChecks, tag).toBeGreaterThan(30);
  expect(report.maxErrorDb, tag).toBeLessThan(0.01);
  expect(report.maxBError, tag).toBeLessThan(1e-6);
  expect(errors).toEqual([]);
});
