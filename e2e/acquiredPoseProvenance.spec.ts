import { expect, test } from '@playwright/test';
import { acquisitionSnapshot, validateAcquisition } from '../tools/fidelity/acquisitionSnapshot';
import { bootWithoutErrors, budget } from './support';

test('conserva pose adquirida al mover controles congelados y recuperar cine antiguo', async ({ page }, info) => {
  budget(90_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('#freeze').click();
  const before = await page.evaluate(acquisitionSnapshot, 'subxiphoid' as const);
  const oldIndex = await page.evaluate(() => window.__vexusTest!.sim().renderer.cineCount - 1);
  expect(before.schemaVersion).toBe(2);
  validateAcquisition(before, { anatomy: 'atlas', caseId: 'normal-adult' });
  const pixels = () =>
    page.evaluate(() => {
      const r = window.__vexusTest!.sim().renderer,
        gl = r.gl,
        data = new Uint8Array(r.canvas.width * r.canvas.height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, r.canvas.width, r.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      let hash = 2166136261;
      for (const v of data) hash = Math.imul(hash ^ v, 16777619);
      return hash;
    });
  const oldPixels = await pixels();
  await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    // Mutating the live pose catches aliasing as well as reading the wrong pose.
    s.pose.phi += 0.12;
    s.pose.z += 3;
    s.pose.yaw += 0.1;
  });
  const moved = await page.evaluate(acquisitionSnapshot, 'subxiphoid' as const);
  expect(moved.pose).toEqual(before.pose);
  expect(moved.livePose).not.toEqual(before.pose);
  expect(moved.frame).toEqual(before.frame);
  expect(moved.acquiredTimeSeconds).toBe(before.acquiredTimeSeconds);
  expect(await pixels()).toBe(oldPixels);
  // Static registered comparisons still reject a presented/current geometry mismatch.
  expect(() => validateAcquisition(moved, { anatomy: 'atlas', caseId: 'normal-adult' })).toThrow(
    'Presented pose differs from the live probe',
  );
  await page.locator('#freeze').click();
  await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    for (let i = 0; i < 6; i++) {
      s.advance(s.physiology.clock.dt);
      s.render();
    }
  });
  await page.locator('#freeze').click();
  const current = await page.evaluate(acquisitionSnapshot, 'subxiphoid' as const);
  expect(current.pose).toEqual(current.livePose);
  expect(current.pose).not.toEqual(before.pose);
  await page.locator('#cine').fill(String(oldIndex));
  await page.locator('#cine').dispatchEvent('input');
  const replay = await page.evaluate(acquisitionSnapshot, 'subxiphoid' as const);
  expect(replay.pose).toEqual(before.pose);
  expect(replay.transducer).toEqual(before.transducer);
  expect(replay.presentedFrame).toBe(before.presentedFrame);
  expect(replay.acquiredTimeSeconds).toBe(before.acquiredTimeSeconds);
  expect(replay.livePose).toEqual(current.livePose);
  expect(await pixels()).toBe(oldPixels);
  await info.attach('acquired-pose-provenance.json', {
    body: JSON.stringify({ before, moved, current, replay, oldPixels }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
});
