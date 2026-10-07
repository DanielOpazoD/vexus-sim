import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`hepatorenal preset shows liver and acoustically accessible kidney (${caseId})`, async ({ page }, info) => {
    budget(120000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    await page.locator('.win-card').nth(8).click();
    const f = await page.evaluate(() => window.__vexusTest!.framesRendered());
    await page.waitForFunction((f) => window.__vexusTest!.framesRendered() > f + 70, f);
    await page.waitForFunction(() => {
      const p = window.__vexusTest!.sim().pose;
      return Math.abs(p.phi - 2.99) < 0.00001 && Math.abs(p.z + 113) < 0.00001;
    });
    await page.locator('#freeze').click();
    const result = await page.evaluate(() => {
      const s = window.__vexusTest!.sim(),
        a = s.renderer.displayedAnatomy!,
        fr = a.frame,
        t = s.renderer.readTransmission();
      let kidney = 0,
        visibleKidney = 0,
        liver = 0;
      const radii: number[] = [];
      for (let v = 0; v < 64; v++)
        for (let u = 0; u < 32; u++) {
          const theta = (((u + 0.5) / 32) * 2 - 1) * s.transducer.halfSector,
            r = ((v + 0.5) / 64) * s.displayed.bmode.depthMm;
          const p = fr.curvatureCenter.map(
            (x, i) => x + (s.transducer.curvatureRadius + r) * (fr.axial[i] * Math.cos(theta) + fr.lateral[i] * Math.sin(theta)),
          ) as [number, number, number];
          const c = s.anatomy.classifyWorld(p, a.sample);
          if (Number(c.tissue) === 4) liver++;
          if ([17, 18].includes(c.tissue)) {
            kidney++;
            const row = Math.min(t.samples - 1, Math.floor((r / s.displayed.bmode.depthMm) * t.samples)),
              line = Math.min(t.lines - 1, Math.floor(((u + 0.5) / 32) * t.lines));
            // Use the acquired transmission: anatomy behind opaque bone alone is insufficient.
            if (t.single[row * t.lines + line] > 0.01) {
              visibleKidney++;
              radii.push(r);
            }
          }
        }
      return {
        pose: s.pose,
        kidney,
        visibleKidney,
        liver,
        span: radii.length ? Math.max(...radii) - Math.min(...radii) : 0,
        errors: window.__vexusTest!.loggedErrors(),
      };
    });
    await info.attach('observed-hepatorenal-access.json', { body: JSON.stringify(result), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('hepatorenal-acquisition.png') });
    expect(result.visibleKidney).toBeGreaterThan(50);
    expect(result.visibleKidney / result.kidney).toBeGreaterThan(0.65);
    expect(result.liver).toBeGreaterThan(100);
    expect(result.span).toBeGreaterThan(35);
    expect(result.errors).toEqual([]);
    expect(errors).toEqual([]);
  });
