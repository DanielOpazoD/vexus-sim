import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, withinFrames } from './support';

for (const model of ['legacy', 'reference', 'atlas'] as const)
  test(`deslizar conserva tres ejes y girar es explícito, modelo=${model}`, async ({ page }, info) => {
    budget(90_000);
    // Atlas is the default: reference=1 alone no longer selects the historical torso.
    const errors = await bootWithoutErrors(
      page,
      `?e2e=app&abdomen=${model === 'atlas' ? 'atlas' : 'legacy'}${model === 'reference' ? '&reference=1' : ''}`,
    );
    const observedModel = await page.evaluate(() => {
      const scene = window.__vexusTest!.sim().scene;
      return scene.hasAbdominalAtlas ? 'atlas' : scene.torso.profile ? 'reference' : 'legacy';
    });
    expect(observedModel).toBe(model);
    await page.locator('.win-card').filter({ hasText: 'Hepatorrenal' }).click();
    const target =
      model === 'atlas'
        ? { phi: 2.99, z: -113, yaw: -0.24452521426888207, rock: -0.13406390040993016, tilt: -0.3591483268294911 }
        : { phi: 3.2, z: -80, yaw: model === 'reference' ? 0 : -0.1, rock: model === 'reference' ? -0.2 : 0.1, tilt: -0.4 };
    await withinFrames(
      page,
      100,
      'pose completa',
      async () =>
        (await page.evaluate(
          (t) => Object.entries(t).every(([key, value]) => Math.abs(Reflect.get(window.__vexusTest!.sim().pose, key) - value) < 1e-8),
          target,
        )) || 'posición/ángulos en tránsito',
    );
    const nav = await page.locator('#nav3d canvas').boundingBox();
    expect(nav).not.toBeNull();
    const sample = () =>
      page.evaluate(() => {
        const s = window.__vexusTest!.sim();
        return { pose: s.pose, axial: s.frame.axial, lateral: s.frame.lateral, elevation: s.frame.elevation };
      });
    const before = await sample(),
      records = [];
    await page.mouse.move(nav!.x + nav!.width * 0.56, nav!.y + nav!.height * 0.62);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(nav!.x + nav!.width * 0.56 + (18 * i) / 8, nav!.y + nav!.height * 0.62 - (12 * i) / 8);
      const now = await sample();
      records.push(now);
      for (const axis of ['axial', 'lateral', 'elevation'] as const)
        for (let j = 0; j < 3; j++) expect(now[axis][j]).toBeCloseTo(before[axis][j], 8);
    }
    await page.mouse.up();
    const after = await sample();
    expect(Math.abs(after.pose.phi - before.pose.phi) + Math.abs(after.pose.z - before.pose.z)).toBeGreaterThan(1);
    await page.screenshot({ path: info.outputPath('translation.png') });
    await info.attach('translation-frames', {
      body: JSON.stringify({ model, before, records, after }),
      contentType: 'application/json',
    });
    await page.mouse.wheel(0, 100);
    await expect.poll(async () => Math.abs((await sample()).pose.yaw - after.pose.yaw)).toBeGreaterThan(0.01);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
  });
