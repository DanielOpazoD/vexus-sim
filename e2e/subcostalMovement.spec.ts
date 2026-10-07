import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';
import type { CutMapInit, CutMapRequest, CutMapResponse } from '../src/ui/cutMapWorker';

interface WorkerWitness {
  init?: CutMapInit;
  requests: Record<number, CutMapRequest>;
  map?: CutMapResponse;
}

test('the anatomical worker receives the exact acquisition wall and costal atlas', async ({ page }, info) => {
  budget(180000);
  await page.addInitScript(() => {
    const w = window as typeof window & { mapWitness: WorkerWitness };
    w.mapWitness = { requests: {} };
    const original: unknown = Reflect.get(Worker.prototype, 'postMessage');
    if (typeof original !== 'function') throw Error('Missing native Worker.postMessage');
    Worker.prototype.postMessage = function (message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
      const request = message as CutMapInit | CutMapRequest;
      if (request.type === 'init' && 'patient' in request) {
        w.mapWitness.init = request;
        this.addEventListener('message', (ev: MessageEvent<CutMapResponse>) => {
          if (ev.data.type === 'map') w.mapWitness.map = ev.data;
        });
      } else if (request.type === 'map') w.mapWitness.requests[request.id] = request;
      Reflect.apply(original, this, [message, transfer]);
    };
  });
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('.win-card').nth(2).click();
  await page.waitForFunction(() => {
    const witness = (window as typeof window & { mapWitness: WorkerWitness }).mapWitness;
    return !!witness.map && window.__vexusTest!.framesRendered() > 50;
  });
  await page.locator('#freeze').click();
  const report = await page.evaluate(() => {
    const s = window.__vexusTest!.sim(),
      witness = (window as typeof window & { mapWitness: WorkerWitness }).mapWitness,
      map = witness.map!,
      req = witness.requests[map.id],
      mismatches: unknown[] = [];
    const sameProfile = witness.init!.referenceProfile!.every((v, i) => v === s.scene.torso.profile![i]);
    s.anatomy.setProbeCompression(req.compression);
    let bones = 0;
    for (let v = 0; v < map.height; v += 2)
      for (let u = 0; u < map.width; u += 2) {
        const theta = -req.transducer.halfSector + (2 * req.transducer.halfSector * (u + 0.5)) / map.width,
          r = (req.depthMm * (v + 0.5)) / map.height;
        const dir = req.frame.axial.map((x, i) => x * Math.cos(theta) + req.frame.lateral[i] * Math.sin(theta));
        const point = req.frame.curvatureCenter.map((x, i) => x + (req.transducer.curvatureRadius + r) * dir[i]) as [
          number,
          number,
          number,
        ];
        const tissue = s.anatomy.classifyWorld(point, req.sample as typeof s.sample).tissue;
        if (Number(tissue) === 11) bones++;
        if (Number(tissue) !== map.tissue[v * map.width + u]) mismatches.push({ u, v, tissue, worker: map.tissue[v * map.width + u] });
      }
    s.anatomy.setProbeCompression(s.contact);
    return {
      sameProfile,
      profileLength: witness.init!.referenceProfile!.length,
      thoracicBytes: witness.init!.thoracicField?.byteLength,
      bones,
      mismatches,
    };
  });
  await info.attach('actual-worker-parity.json', { body: JSON.stringify(report), contentType: 'application/json' });
  expect(report.sameProfile).toBe(true);
  expect(report.thoracicBytes).toBeGreaterThan(0);
  expect(report.bones).toBeGreaterThan(0);
  expect(report.mismatches).toEqual([]);
  expect(errors).toEqual([]);
});

for (const [index, target] of [
  [0, 'ivcInfra'],
  [3, 'hvMiddle'],
] as const)
  test(`subcostal ${target} has a transhepatic near field and continuously acquired frames`, async ({ page }, info) => {
    budget(180000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    await page.locator('.win-card').nth(index).click();
    await page.waitForFunction(
      ({ z, yaw }) => {
        const p = window.__vexusTest!.sim().pose;
        return Math.abs(p.z - z) < 0.00001 && Math.abs(p.yaw - yaw) < 0.00001;
      },
      index === 0 ? { z: -40, yaw: -0.02516291680704072 } : { z: -80, yaw: 0.6280025227578521 },
    );
    const f = await page.evaluate(() => window.__vexusTest!.framesRendered());
    await page.waitForFunction((n) => window.__vexusTest!.framesRendered() > n + 45, f);
    const report = await page.evaluate((target) => {
      const s = window.__vexusTest!.sim(),
        a = s.renderer.displayedAnatomy!,
        points: number[] = [];
      let mesenteryBeforeLiver = 0,
        lungNearField = 0,
        targetPoints = 0,
        liverPoints = 0;
      for (let u = 8; u < 24; u++) {
        let enteredLiver = false;
        for (let v = 0; v < 64; v++) {
          const theta = (((u + 0.5) / 32) * 2 - 1) * s.transducer.halfSector,
            r = ((v + 0.5) / 64) * s.displayed.bmode.depthMm;
          const dir = a.frame.axial.map((x, k) => x * Math.cos(theta) + a.frame.lateral[k] * Math.sin(theta));
          const p = a.frame.curvatureCenter.map((x, k) => x + (s.transducer.curvatureRadius + r) * dir[k]) as [number, number, number];
          const c = s.anatomy.classifyWorld(p, a.sample);
          if (Number(c.tissue) === 4) {
            enteredLiver = true;
            liverPoints++;
          }
          if (!enteredLiver && Number(c.tissue) === 32) mesenteryBeforeLiver++;
          if (r < 50 && Number(c.tissue) === 10) lungNearField++;
          if (c.vessel === target) targetPoints++;
          points.push(...p);
        }
      }
      const gpu = s.gpuQuery(new Float32Array(points), a.frame, true);
      return {
        pose: s.pose,
        mesenteryBeforeLiver,
        lungNearField,
        targetPoints,
        liverPoints,
        gpuLiverPoints: Array.from(gpu.tissue).filter((t) => t === 4).length,
      };
    }, target);
    await info.attach('near-field.json', { body: JSON.stringify(report), contentType: 'application/json' });
    expect(report.mesenteryBeforeLiver).toBe(0);
    expect(report.lungNearField).toBe(0);
    expect(report.targetPoints).toBeGreaterThan(5);
    expect(report.liverPoints).toBeGreaterThan(100);
    expect(report.gpuLiverPoints).toBeGreaterThan(100);
    // Drive the real controls, including fine rotation, rocking and fanning.
    for (const name of ['Rotación', 'Basculación', 'Inclinación']) {
      const input = page.getByLabel(name, { exact: true });
      await input.focus();
      for (let k = 0; k < 4; k++) await input.press('ArrowRight');
      const before = await page.evaluate(() => window.__vexusTest!.framesRendered());
      await page.waitForFunction((n) => window.__vexusTest!.framesRendered() > n + 3, before);
      for (let k = 0; k < 4; k++) await input.press('ArrowLeft');
    }
    await page.screenshot({ path: info.outputPath('subcostal-after-manual-movements.png') });
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
  });
