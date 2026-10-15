import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { ABDOMINAL_SURFACE } from '../src/anatomy/abdominalSurfaceData';
import { bootWithoutErrors, budget } from './support';
const bytes = gunzipSync(readFileSync('src/anatomy/abdominal-surface.gzip.bin'));
const v = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
const points: Array<[number, number, number]> = [];
for (const f of ABDOMINAL_SURFACE.envelopes.filter((f) => f.fascia)) {
  for (let i = 0; i < f.count; i += 149) {
    const p = Array.from(v.subarray(f.offset + 3 * i, f.offset + 3 * i + 3)) as [number, number, number];
    // Probe both sides of the actual shared surface, with no assumed radial normal.
    for (const axis of [0, 1, 2])
      for (const sign of [-1, 1]) {
        const q = [...p] as [number, number, number];
        q[axis] += sign * 0.15;
        points.push(q);
      }
  }
}
for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`renal adipose/fascial volume agrees on CPU/GPU during probe movement (${caseId})`, async ({ page }, info) => {
    budget(180000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    await page.locator('.win-card').nth(8).click();
    await page.locator('#freeze').click();
    const result = await page.evaluate((points) => {
      const s = window.__vexusTest!.sim(),
        caliber = s.anatomy.caliberFor(s.sample);
      const selected = points
        .map((p) => ({ p, c: s.scene.classify(p, caliber) }))
        .filter(({ c }) => Number(c.tissue) === 37 && c.boundaryDistance > 0.04);
      const world = selected.map(({ p }) => s.anatomy.deformation.toWorld(p, s.sample.resp));
      const gpu = s.gpuQuery(new Float32Array(world.flat()), s.frame, true, { normals: true });
      let matches = 0,
        interfaces = 0,
        worstDistance = 0,
        minDot = 1,
        fasciaFaces = 0;
      for (let i = 0; i < selected.length; i++) {
        const c = s.anatomy.classifyWorld(world[i], s.sample);
        if (Number(c.tissue) === gpu.tissue[i]) matches++;
        if (Number(c.interface) === gpu.iface[i]) interfaces++;
        worstDistance = Math.max(worstDistance, Math.abs(c.interfaceDistance - gpu.ifd[i]));
        if (Number(c.interface) === 29 || Number(c.interface) === 10) {
          if (Number(c.interface) === 29) fasciaFaces++;
          const n = s.scene.faceGradient(selected[i].p, caliber)!.normal;
          minDot = Math.min(
            minDot,
            n.reduce((sum, x, k) => sum + x * gpu.normal![3 * i + k], 0),
          );
        }
      }
      return {
        points: selected.length,
        matches,
        interfaces,
        worstDistance,
        minDot,
        fasciaFaces,
        errors: window.__vexusTest!.loggedErrors(),
      };
    }, points);
    await info.attach('renal-envelope-parity.json', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.points).toBeGreaterThan(100);
    expect(result.matches).toBe(result.points);
    expect(result.interfaces).toBe(result.points);
    expect(result.worstDistance).toBeLessThan(0.02);
    expect(result.fasciaFaces).toBeGreaterThan(30);
    expect(result.minDot).toBeGreaterThan(0.98);
    expect(result.errors).toEqual([]);
    await page.locator('#freeze').click();
    const frames = [];
    for (const [id, key] of [
      ['Rotación', 'ArrowRight'],
      ['Inclinación', 'ArrowLeft'],
      ['Basculación', 'ArrowRight'],
    ] as const) {
      const slider = page.getByRole('slider', { name: id, exact: true });
      await slider.focus();
      await slider.press(key);
      const f = await page.evaluate(() => window.__vexusTest!.framesRendered());
      await page.waitForFunction((f) => window.__vexusTest!.framesRendered() > f + 3, f);
      frames.push(await page.evaluate(() => ({ pose: window.__vexusTest!.sim().pose, errors: window.__vexusTest!.loggedErrors() })));
    }
    await page.locator('#freeze').click();
    await info.attach('probe-movement.json', { body: JSON.stringify(frames), contentType: 'application/json' });
    for (const f of frames) expect(f.errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('renal-envelope.png') });
    expect(errors).toEqual([]);
  });
