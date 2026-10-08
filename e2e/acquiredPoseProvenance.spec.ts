import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { acquisitionSnapshot, validateAcquisition } from '../tools/fidelity/acquisitionSnapshot';
import { captureBMode } from '../tools/fidelity/captureBMode';
import { bootWithoutErrors, budget } from './support';

test('conserva pose adquirida al mover controles congelados y recuperar cine antiguo', async ({ page }, info) => {
  budget(90_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    for (let i = 0; i < 20; i++) {
      s.advance(0.05);
      s.render();
    }
  });
  await page.locator('#freeze').click();
  // Compare the SAME historical reconstruction before/after a new acquisition.
  // Live persistence versus R16F cine reconstruction is a separate signal audit.
  const oldIndex = await page.evaluate(() => window.__vexusTest!.sim().renderer.cineCount - 2);
  expect(oldIndex).toBeGreaterThanOrEqual(1);
  await page.locator('#cine').fill(String(oldIndex));
  await page.locator('#cine').dispatchEvent('input');
  const before = await page.evaluate(acquisitionSnapshot, 'subxiphoid' as const);
  expect(before.schemaVersion).toBe(2);
  validateAcquisition(before, { anatomy: 'atlas', caseId: 'normal-adult' });
  const pixels = async (name: string) => {
    const path = info.outputPath(name + '.png');
    // Read the presented B-mode target, never a discarded browser backbuffer.
    await captureBMode(page, path);
    await info.attach(name, { path, contentType: 'image/png' });
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  };
  const oldPixels = await pixels('before');
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
  expect(await pixels('frozen-moved')).toBe(oldPixels);
  // Static registered comparisons still reject a presented/current geometry mismatch.
  expect(() => validateAcquisition(moved, { anatomy: 'atlas', caseId: 'normal-adult' })).toThrow(
    'Presented pose differs from the live probe',
  );
  await page.locator('#freeze').click();
  await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    // Use the ordinary setter for the next real acquisition, beyond the aliasing stimulus.
    s.setPose({ ...s.pose, phi: s.pose.phi + 0.08 });
    for (let i = 0; i < 6; i++) {
      s.advance(s.physiology.clock.dt);
      s.render();
    }
  });
  await page.locator('#freeze').click();
  const current = await page.evaluate(acquisitionSnapshot, 'subxiphoid' as const);
  expect(current.pose).toEqual(current.livePose);
  expect(current.pose).not.toEqual(before.pose);
  expect(current.frame).not.toEqual(before.frame);
  expect(await pixels('current')).not.toBe(oldPixels);
  await page.locator('#cine').fill(String(oldIndex));
  await page.locator('#cine').dispatchEvent('input');
  const replay = await page.evaluate(acquisitionSnapshot, 'subxiphoid' as const);
  expect(replay.pose).toEqual(before.pose);
  expect(replay.transducer).toEqual(before.transducer);
  expect(replay.presentedFrame).toBe(before.presentedFrame);
  expect(replay.acquiredTimeSeconds).toBe(before.acquiredTimeSeconds);
  expect(replay.livePose).toEqual(current.livePose);
  expect(await pixels('replay')).toBe(oldPixels);
  await info.attach('acquired-pose-provenance.json', {
    body: JSON.stringify({ before, moved, current, replay, oldPixels }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
});
