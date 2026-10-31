import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';
import { Tissue } from '../src/anatomy/tissues';

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`hepatorenal colon acquires echoes without vascular flow, including probe movement (${caseId})`, async ({ page }, info) => {
    budget(120000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    await page.selectOption('#case-select', caseId);
    await page.getByRole('button', { name: 'Apnea espiratoria', exact: true }).click();
    await page.locator('[data-window="hepatorenal"]').click();
    await page.waitForFunction(() => Math.abs(window.__vexusTest!.sim().pose.z + 115.333) < 1e-8);
    const inspect = () =>
      page.evaluate(() => {
        const s = window.__vexusTest!.sim();
        s.advance(0);
        s.advance(0);
        s.render();
        const a = s.renderer.displayedAnatomy!,
          r = s.renderer,
          img = r.readDisplay();
        const points: number[] = [],
          levels: number[] = [],
          tissues: number[] = [];
        let flow = 0;
        for (let y = 0; y < img.height; y += 6)
          for (let x = 0; x < img.width; x += 6) {
            const b = r.pixelToBeam(x, y, s.transducer, s.bmode.depthMm);
            if (!b) continue;
            const p = a.frame.curvatureCenter.map(
              (v, i) =>
                v + (s.transducer.curvatureRadius + b.r) * (a.frame.axial[i] * Math.cos(b.theta) + a.frame.lateral[i] * Math.sin(b.theta)),
            ) as [number, number, number];
            const q = s.anatomy.classifyWorld(p, a.sample);
            // Interior witnesses exclude source-grid boundary rounding. No screenshot coordinate mask.
            if (q.tissue !== (40 as Tissue) || q.interfaceDistance < 2) continue;
            points.push(...p);
            tissues.push(q.tissue);
            levels.push(img.gray[y * img.width + x]);
            if (q.vessel || q.bloodVelocity || q.flowBasis) flow++;
          }
        const gpu = s.gpuQuery(new Float32Array(points), a.frame, true);
        levels.sort((a, b) => a - b);
        return {
          pose: { ...s.pose },
          samples: levels.length,
          median: levels[Math.floor(levels.length / 2)],
          flow,
          gpuTissues: [...new Set(gpu.tissue)],
          glError: r.gl.getError(),
        };
      });
    const reports = [await inspect()];
    for (const name of ['Rotación', 'Basculación', 'Inclinación']) {
      const slider = page.getByRole('slider', { name, exact: true });
      const original = Number(await slider.inputValue());
      await slider.focus();
      for (let i = 0; i < 3; i++) await slider.press('ArrowRight');
      await page.waitForFunction(
        ({ name, value }) => {
          const el = [...document.querySelectorAll<HTMLInputElement>('input[type=range]')].find((e) =>
            e.labels?.[0]?.textContent?.includes(name),
          );
          return !!el && Number(el.value) !== value;
        },
        { name, value: original },
      );
      reports.push(await inspect());
      for (let i = 0; i < 3; i++) await slider.press('ArrowLeft');
      expect(Number(await slider.inputValue())).toBeCloseTo(original, 8);
    }
    reports.push(await inspect());
    await info.attach('colonic-contents-movement.json', { body: JSON.stringify(reports, null, 2), contentType: 'application/json' });
    for (const r of reports) {
      expect(r.samples).toBeGreaterThan(30);
      expect(r.median).toBeGreaterThan(30); // Reject the previous clear-fluid cavity, not a clinical grey-level target.
      expect(r.flow).toBe(0);
      expect(r.gpuTissues).toEqual([Tissue.ColonicContents]);
      expect(r.glError).toBe(0);
    }
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('hepatorenal-colonic-contents.png') });
  });
