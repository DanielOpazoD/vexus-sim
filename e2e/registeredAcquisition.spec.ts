import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  acquiredState,
  acquiredPixelPoint,
  acquiredPixelVoxel,
  exportAcquiredFrame,
  exportAcquiredCine,
} from '../tools/fidelity/registeredAcquisition';
import { CtCaseFrame, NATIVE_RAS_TO_LAS } from '../tools/anatomy/ctFrame';
import { beamToPixel } from '../src/ultrasound/sectorGeometry';
import { bootWithoutErrors, budget } from './support';

test('el cine y el plano conservan la adquisición y rechazan un TAC de otra procedencia', async ({ page }, info) => {
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  budget(90_000);
  const errors = await bootWithoutErrors(page, '?e2e=app');
  await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    for (let i = 0; i < 6; i++) {
      s.advance(0.05);
      s.render();
    }
  });
  await page.locator('#freeze').click();
  const oldIndex = await page.evaluate(() => window.__vexusTest!.sim().renderer.cineCount - 2);
  expect(oldIndex).toBeGreaterThanOrEqual(1);
  const oldNumber = await page.evaluate((i) => window.__vexusTest!.sim().renderer.cineFrame(i).n, oldIndex);
  await page.locator('#cine').fill(String(oldIndex));
  await page.locator('#cine').dispatchEvent('input');
  await expect.poll(() => page.evaluate(() => window.__vexusTest!.sim().renderer.displayedFrame?.n)).toBe(oldNumber);
  const before = await page.evaluate(acquiredState);
  await expect(page.locator('#cutmap')).toHaveAttribute('data-acquired-frame', String(oldNumber));
  const p = beamToPixel(before.layout, before.frame.anatomy.transducer, 0, 80);
  const world = acquiredPixelPoint(before, p.x, p.y);
  expect(world).not.toBeNull();
  expect(acquiredPixelPoint(before, -1, p.y)).toBeNull();
  const ct = new CtCaseFrame(
    {
      source: { dataset: 'phantom', version: '1', case: 'different-person' },
      ctSha256: 'a'.repeat(64),
      shape: [10, 10, 10],
      affineRASmm: [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
      unitsDeclared: 'mm',
      millimeterEvidence: null,
      allMasksShareOriginalGrid: true,
    },
    NATIVE_RAS_TO_LAS,
  );
  expect(() => acquiredPixelVoxel(before, p.x, p.y, ct)).toThrow('marcos distintos');
  const first = await exportAcquiredFrame(page, info.outputPath('before'), sourceSha);
  await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    s.pose.phi += 0.12;
    s.pose.z += 3;
    s.pose.yaw += 0.1;
  });
  const moved = await page.evaluate(acquiredState);
  expect(moved.livePose).not.toEqual(before.livePose);
  expect(moved.frame.anatomy).toEqual(before.frame.anatomy);
  expect(acquiredPixelPoint(moved, p.x, p.y)).toEqual(world);
  expect((await exportAcquiredFrame(page, info.outputPath('frozen-moved'), sourceSha)).pngSha256).toBe(first.pngSha256);
  await page.locator('#freeze').click();
  await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    s.setPose({ ...s.pose, phi: s.pose.phi + 0.08 });
    for (let i = 0; i < 4; i++) {
      s.advance(0.05);
      s.render();
    }
  });
  await page.locator('#freeze').click();
  const current = await page.evaluate(acquiredState);
  expect(current.frame.anatomy.frame).not.toEqual(before.frame.anatomy.frame);
  expect((await exportAcquiredFrame(page, info.outputPath('current'), sourceSha)).pngSha256).not.toBe(first.pngSha256);
  const replayIndex = await page.evaluate((n) => {
    const r = window.__vexusTest!.sim().renderer;
    return Array.from({ length: r.cineCount }, (_, i) => i).find((i) => r.cineFrame(i).n === n);
  }, oldNumber);
  expect(replayIndex).not.toBeUndefined();
  await page.locator('#cine').fill(String(replayIndex));
  await page.locator('#cine').dispatchEvent('input');
  await expect.poll(() => page.evaluate(() => window.__vexusTest!.sim().renderer.displayedFrame?.n)).toBe(oldNumber);
  const replay = await page.evaluate(acquiredState);
  await expect(page.locator('#cutmap')).toHaveAttribute('data-acquired-frame', String(oldNumber));
  expect(replay.frame).toEqual(before.frame);
  expect(acquiredPixelPoint(replay, p.x, p.y)).toEqual(world);
  expect((await exportAcquiredFrame(page, info.outputPath('replay'), sourceSha)).pngSha256).toBe(first.pngSha256);
  const expectedCine = await page.evaluate(() => {
    const r = window.__vexusTest!.sim().renderer;
    return Array.from({ length: r.cineCount }, (_, i) => ({ n: r.cineFrame(i).n, t: r.cineFrame(i).t }));
  });
  const cine = await exportAcquiredCine(page, info.outputPath('sequence'), sourceSha);
  expect(cine.frames.map((f) => ({ n: f.frameNumber, t: f.acquiredTimeSeconds }))).toEqual(expectedCine);
  await expect.poll(() => page.evaluate(() => window.__vexusTest!.sim().renderer.displayedFrame?.n)).toBe(oldNumber);
  expect((await exportAcquiredFrame(page, info.outputPath('after-cine-export'), sourceSha)).pngSha256).toBe(first.pngSha256);
  await info.attach('cine-manifest', { path: info.outputPath('sequence-cine.json'), contentType: 'application/json' });
  for (const name of ['before', 'frozen-moved', 'current', 'replay']) {
    await info.attach(name, { path: info.outputPath(name + '.png'), contentType: 'image/png' });
    await info.attach(name + '-metadata', { path: info.outputPath(name + '.json'), contentType: 'application/json' });
  }
  expect(errors).toEqual([]);
});
