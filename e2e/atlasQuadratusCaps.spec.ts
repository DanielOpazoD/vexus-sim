import { expect, test } from '@playwright/test';
import { Tissue } from '../src/anatomy/tissues';
import { bootWithoutErrors, budget, windowAcquired, withinFrames } from './support';

const points: Array<[number, number, number]> = [];
for (const x of [-70.36, 70.36]) for (let y = -77; y <= -65; y++) for (let z = -218; z <= -204; z++) points.push([x, y, z]);
const witnesses = [-70.36, 70.36].flatMap((x) => [
  { p: [x, -67.76, -213] as [number, number, number], expected: Tissue.RetroperitonealFat },
  { p: [x, -68.76, -213] as [number, number, number], expected: Tissue.QuadratusLumborum },
]);

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`Atlas renal muscle ends agree in production through probe movement (${caseId})`, async ({ page }, info) => {
    budget(180000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    await page.locator('.win-card').nth(7).click();
    await windowAcquired(page, 'renal');
    const reports = [];
    for (const control of [null, 'Rotación', 'Inclinación', 'Basculación']) {
      if (control) {
        await page.getByRole('slider', { name: control, exact: true }).press('ArrowRight');
        const requested = await page.evaluate(() => ({
          pose: window.__vexusTest!.sim().pose,
          n: window.__vexusTest!.sim().renderer.displayedFrame!.n,
        }));
        await withinFrames(page, 45, 'la imagen adquiere la pose manual', async () =>
          page.evaluate(({ pose, n }) => {
            const a = window.__vexusTest!.sim().renderer.displayedFrame!;
            return (a.n > n && JSON.stringify(a.anatomy.pose) === JSON.stringify(pose)) || 'adquisición pendiente';
          }, requested),
        );
      }
      await page.locator('#freeze').click();
      const result = await page.evaluate(
        ({ points, witnesses, muscle, fat }) => {
          const s = window.__vexusTest!.sim();
          const shown = s.renderer.displayedFrame!;
          const a = shown.anatomy;
          const world = [...points, ...witnesses.map((w) => w.p)].map((p) => s.anatomy.deformation.toWorld(p, a.sample.resp));
          const cpu = world.map((p) => s.anatomy.classifyWorld(p, a.sample));
          const gpu = s.renderer.queryPoints(
            new Float32Array(world.flat()),
            {
              ...a,
              caliber: s.anatomy.caliberFor(a.sample),
              probeVelocity: [0, 0, 0],
              bmode: shown.bmode,
              color: s.color,
              updateColor: false,
            },
            true,
          );
          let tested = 0;
          let matched = 0;
          let muscleCount = 0;
          let fatCount = 0;
          for (let i = 0; i < points.length; i++) {
            if (cpu[i].boundaryDistance < 0.05) continue;
            tested++;
            matched += Number(Number(cpu[i].tissue) === gpu.tissue[i]);
            muscleCount += Number(Number(cpu[i].tissue) === muscle);
            fatCount += Number(Number(cpu[i].tissue) === fat);
          }
          return {
            tested,
            matched,
            muscleCount,
            fatCount,
            witnesses: witnesses.map((w, i) => ({
              expected: w.expected,
              cpu: cpu[points.length + i].tissue,
              gpu: gpu.tissue[points.length + i],
            })),
            pose: a.pose,
            errors: window.__vexusTest!.loggedErrors(),
          };
        },
        { points, witnesses, muscle: Tissue.QuadratusLumborum, fat: Tissue.RetroperitonealFat },
      );
      reports.push({ control, ...result });
      expect(result.tested).toBeGreaterThan(250);
      expect(result.matched).toBe(result.tested);
      expect(result.muscleCount).toBeGreaterThan(50);
      expect(result.fatCount).toBeGreaterThan(50);
      for (const w of result.witnesses) {
        expect(w.cpu).toBe(w.expected);
        expect(w.gpu).toBe(w.expected);
      }
      expect(result.errors).toEqual([]);
      if (control !== 'Basculación') await page.locator('#freeze').click();
    }
    await info.attach('atlas-muscle-end-parity.json', { body: JSON.stringify(reports), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('renal-muscle-ends.png') });
    expect(errors).toEqual([]);
  });
