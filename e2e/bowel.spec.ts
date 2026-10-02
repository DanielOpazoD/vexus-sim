import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, withinFrames, framesRendered, checkAfterEach } from './support';
checkAfterEach();
for (const reference of [false, true])
  test(`asas: luz, gas, pared y serosa coinciden en CPU/GPU (${reference ? 'referencia' : 'legacy'})`, async ({ page }, info) => {
    budget(150_000);
    const errors = await bootWithoutErrors(page, reference ? '?e2e=1&reference=1' : '?e2e=1');
    await page.evaluate(() => {
      window.__vexusTest!.setCompound(false);
      window.__vexusTest!.setPose({ phi: Math.PI / 2, z: -112, lift: 0, yaw: Math.PI / 2, rock: 0, tilt: 0 });
    });
    const r = await page.evaluate(() => window.__vexusTest!.bowelEquivalence());
    expect(r.interior).toBeGreaterThan(1800);
    expect(r.agreement).toBe(1);
    expect(r.gas).toBeGreaterThan(50);
    expect(r.fluid).toBeGreaterThan(200);
    expect(r.wall).toBeGreaterThan(100);
    expect(r.faces).toBeGreaterThan(300);
    expect(r.faceAgreement).toBe(1);
    expect(r.maxDistanceError).toBeLessThan(0.02);
    expect(r.normalMinDot).toBeGreaterThan(0.99);
    const before = await framesRendered(page);
    await withinFrames(
      page,
      12,
      'asentar la vista intestinal',
      async () => (await framesRendered(page)) >= before + 4 || 'faltan cuadros de imagen',
    );
    await page.locator('#gl').screenshot({ path: info.outputPath(`bowel-${reference ? 'reference' : 'legacy'}.png`) });
    info.annotations.push({ type: 'bowel-parity', description: JSON.stringify(r) });
    expect(errors).toEqual([]);
  });
