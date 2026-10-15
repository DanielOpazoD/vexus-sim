import { expect, test, type Page } from '@playwright/test';
import type { CutMapInit, CutMapRequest, CutMapResponse } from '../src/ui/cutMapWorker';
import type { ProbePose } from '../src/probe/probe';
import { bootWithoutErrors, budget, withinFrames } from './support';

interface NavigatorWitness {
  n: number;
  faceErrorMm: number;
  axisError: number;
  fanErrorMm: number;
}
declare global {
  interface Window {
    freeNavigation: {
      cuts: Array<{ request: CutMapRequest; pose: ProbePose; n: number; response?: CutMapResponse }>;
      navigator?: NavigatorWitness;
    };
  }
}

async function observe(page: Page) {
  await page.addInitScript(() => {
    window.freeNavigation = { cuts: [] };
    const original: unknown = Reflect.get(Worker.prototype, 'postMessage');
    if (typeof original !== 'function') throw new Error('Worker.postMessage unavailable');
    Worker.prototype.postMessage = function (message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
      const request = message as CutMapInit | CutMapRequest;
      if (request.type === 'init')
        this.addEventListener('message', (event: MessageEvent<CutMapResponse>) => {
          if (event.data.type !== 'map') return;
          const entry = window.freeNavigation.cuts
            .slice()
            .reverse()
            .find((c) => c.request.id === event.data.id);
          if (entry) entry.response = event.data;
        });
      if (request.type === 'map') {
        const acquired = window.__vexusTest!.sim().renderer.displayedFrame!;
        window.freeNavigation.cuts.push({ request, pose: structuredClone(acquired.anatomy.pose), n: acquired.n });
        if (window.freeNavigation.cuts.length > 20) window.freeNavigation.cuts.shift();
      }
      Reflect.apply(original, this, [message, transfer]);
    };
  });
}

async function observeNavigator(page: Page) {
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .map((r) => r.name)
      .find((s) => /\/navigator3d-[^/]+\.js/.test(s));
    if (!url) throw new Error('Navigator module was not loaded');
    const { Navigator3D } = (await import(url)) as { Navigator3D: { prototype: { draw(): void } } };
    const draw: unknown = Reflect.get(Navigator3D.prototype, 'draw');
    if (typeof draw !== 'function') throw new Error('Navigator.draw unavailable');
    Navigator3D.prototype.draw = function () {
      Reflect.apply(draw, this, []);
      const nav = this as unknown as {
        probe: { matrix: { elements: number[] }; position: { toArray(): number[] } };
        fan: { geometry: { getAttribute(name: string): { getX(i: number): number; getY(i: number): number; getZ(i: number): number } } };
      };
      const shown = window.__vexusTest!.sim().renderer.displayedFrame!;
      const { frame: f, transducer: tr } = shown.anatomy;
      const face = nav.probe.position.toArray().map((v) => v * 10);
      const axes = [f.lateral, f.elevation, f.axial];
      const axisError = Math.max(...axes.flatMap((a, col) => a.map((v, row) => Math.abs(v - nav.probe.matrix.elements[4 * col + row]))));
      const vertices = nav.fan.geometry.getAttribute('position');
      let fanErrorMm = 0;
      for (const [vertex, theta, depth] of [
        [0, -tr.halfSector, 0],
        [1, -tr.halfSector, shown.bmode.depthMm],
        [116, tr.halfSector, 0],
        [119, tr.halfSector, shown.bmode.depthMm],
        [61, 0, shown.bmode.depthMm],
      ]) {
        const expected = f.curvatureCenter.map(
          (v, i) => v + (tr.curvatureRadius + depth) * (f.axial[i] * Math.cos(theta) + f.lateral[i] * Math.sin(theta)),
        );
        const actual = [vertices.getX(vertex), vertices.getY(vertex), vertices.getZ(vertex)].map((v) => v * 10);
        fanErrorMm = Math.max(fanErrorMm, Math.hypot(...actual.map((v, i) => v - expected[i])));
      }
      window.freeNavigation.navigator = {
        n: shown.n,
        faceErrorMm: Math.hypot(...face.map((v, i) => v - f.face[i])),
        axisError,
        fanErrorMm,
      };
    };
  });
}

async function acquired(page: Page) {
  await withinFrames(page, 90, 'sonda, abanico 3D y corte en la adquisición actual', async () =>
    page.evaluate(() => {
      const s = window.__vexusTest!.sim(),
        a = s.renderer.displayedFrame;
      if (!a) return 'sin adquisición';
      const samePose = (Object.keys(s.pose) as Array<keyof ProbePose>).every((key) => s.pose[key] === a.anatomy.pose[key]);
      return (
        (samePose &&
          window.freeNavigation.navigator?.n === a.n &&
          Number(document.querySelector<HTMLElement>('#cutmap')!.dataset.acquiredFrame) === a.n) ||
        'pendiente'
      );
    }),
  );
}

async function parity(page: Page) {
  await acquired(page);
  // DOM activation leaves the tested captured pointer drag intact.
  await page.locator('#freeze').evaluate((el: HTMLButtonElement) => el.click());
  await acquired(page);
  const result = await page.evaluate(() => {
    const s = window.__vexusTest!.sim(),
      shown = s.renderer.displayedFrame!;
    const cut = window.freeNavigation.cuts
      .slice()
      .reverse()
      .find((c) => c.n === shown.n && c.response);
    if (!cut?.response) throw new Error('No observed cut for the displayed acquisition');
    const { request: req, response: map } = cut;
    const points: number[] = [],
      expected: number[] = [];
    for (let v = 0; v < map.height; v += 16)
      for (let u = 0; u < map.width; u += 12) {
        const theta = -req.transducer.halfSector + (2 * req.transducer.halfSector * (u + 0.5)) / map.width;
        const r = req.transducer.curvatureRadius + (req.depthMm * (v + 0.5)) / map.height;
        points.push(
          ...req.frame.curvatureCenter.map(
            (x, i) => x + r * (req.frame.axial[i] * Math.cos(theta) + req.frame.lateral[i] * Math.sin(theta)),
          ),
        );
        expected.push(map.tissue[v * map.width + u]);
      }
    const actual = s.renderer.queryPoints(
      new Float32Array(points),
      {
        ...shown.anatomy,
        caliber: s.anatomy.caliberFor(shown.anatomy.sample),
        probeVelocity: [0, 0, 0],
        bmode: shown.bmode,
        color: shown.color,
        updateColor: false,
      },
      true,
    ).tissue;
    return {
      points: expected.length,
      mismatches: expected.filter((x, i) => x !== actual[i]).length,
      sameCutFrame: JSON.stringify(req.frame) === JSON.stringify(shown.anatomy.frame),
      sameCutPose: JSON.stringify(cut.pose) === JSON.stringify(shown.anatomy.pose),
      navigator: window.freeNavigation.navigator!,
      pose: s.pose,
      frame: shown.anatomy.frame,
    };
  });
  expect(result.points).toBeGreaterThanOrEqual(64);
  expect(result.mismatches).toBe(0);
  expect(result.sameCutFrame).toBe(true);
  expect(result.sameCutPose).toBe(true);
  expect(result.navigator.faceErrorMm).toBeLessThan(1e-5);
  expect(result.navigator.axisError).toBeLessThan(1e-6);
  expect(result.navigator.fanErrorMm).toBeLessThan(0.0001);
  return result;
}

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`free thoracoabdominal translation and all angles from six starting regions, ${caseId}`, async ({ page }, info) => {
    budget(180_000);
    await observe(page);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    await observeNavigator(page);
    const starts = [
      { name: 'anterior superior', phi: Math.PI / 2, z: 230 },
      { name: 'tórax derecho', phi: Math.PI, z: 50 },
      { name: 'renal derecho posterior', phi: 3.8, z: -100 },
      { name: 'flanco izquierdo', phi: 0.1, z: -100 },
      { name: 'abdomen anterior inferior', phi: Math.PI / 2, z: -390 },
      { name: 'espalda y costura angular', phi: -Math.PI / 2 + 0.02, z: -180 },
    ];
    const records = [];
    for (const [index, start] of starts.entries()) {
      await page.evaluate((start) => {
        const s = window.__vexusTest!.sim();
        s.setPose({ phi: start.phi, z: start.z, yaw: 0.2, rock: 0, tilt: 0, lift: 0 });
      }, start);
      const before = await page.evaluate(() => {
        const s = window.__vexusTest!.sim();
        return { pose: s.pose, frame: s.frame };
      });
      const nav = (await page.locator('#nav3d canvas').boundingBox())!;
      let grab: { x: number; y: number } | undefined;
      for (const y of [0.55, 0.65, 0.45, 0.75]) {
        for (const x of [0.5, 0.4, 0.6]) {
          await page.mouse.move(nav.x + nav.width * x, nav.y + nav.height * y);
          if ((await page.locator('#nav3d canvas').evaluate((el) => el.style.cursor)) === 'crosshair') {
            grab = { x: nav.x + nav.width * x, y: nav.y + nav.height * y };
            break;
          }
        }
        if (grab) break;
      }
      expect(grab, 'visible skin for the initial grab').toBeDefined();
      await page.mouse.move(grab!.x, grab!.y);
      await page.mouse.down();
      // Leave the canvas and skin silhouette while capture remains active.
      const dx = nav.x + nav.width + 100 - grab!.x;
      let previous = before.pose.phi,
        travel = 0;
      for (let step = 1; step <= 8; step++) {
        await page.mouse.move(grab!.x + (dx * step) / 8, grab!.y - (20 * step) / 8);
        const moved = await page.evaluate(() => {
          const s = window.__vexusTest!.sim();
          return { pose: s.pose, frame: s.frame };
        });
        const arc = Math.atan2(Math.sin(moved.pose.phi - previous), Math.cos(moved.pose.phi - previous));
        expect(arc, `${start.name}: step ${step} remains movable`).toBeGreaterThan(0.01);
        travel += arc;
        previous = moved.pose.phi;
        for (const axis of ['axial', 'lateral', 'elevation'] as const)
          for (let i = 0; i < 3; i++) expect(moved.frame[axis][i]).toBeCloseTo(before.frame[axis][i], 8);
      }
      expect(travel).toBeGreaterThan(0.9);
      const outward = await parity(page);
      await page.locator('#freeze').evaluate((el: HTMLButtonElement) => el.click());
      // A reverse captured gesture traverses the same route without pinning at
      // the outline or at the old angle stop, from every initial region.
      await page.mouse.move(grab!.x, grab!.y, { steps: 8 });
      await page.mouse.up();
      const returned = await page.evaluate(() => window.__vexusTest!.sim().pose);
      expect(Math.atan2(Math.sin(returned.phi - before.pose.phi), Math.cos(returned.phi - before.pose.phi))).toBeCloseTo(0, 10);
      expect(returned.z).toBeCloseTo(before.pose.z, 8);
      for (const sign of [-1, 1])
        for (const [name, key, degrees] of [
          ['Rotación', 'yaw', 120],
          ['Basculación', 'rock', 65],
          ['Inclinación', 'tilt', 70],
        ] as const) {
          const slider = page.getByRole('slider', { name, exact: true });
          expect(Number(await slider.getAttribute('min'))).toBe(-180);
          expect(Number(await slider.getAttribute('max'))).toBe(180);
          await slider.fill(String(sign * degrees));
          const value = await page.evaluate((key) => window.__vexusTest!.sim().pose[key], key);
          expect(value).toBeCloseTo((sign * degrees * Math.PI) / 180, 12);
        }
      const angled = await parity(page);
      if (index === 2 || index === 3) await page.screenshot({ path: info.outputPath(`${index}-${caseId}.png`) });
      records.push({ start, travel, returned, outward, angled });
      await page.locator('#freeze').click();
    }
    await info.attach('six-region-navigation', { body: JSON.stringify({ caseId, records }), contentType: 'application/json' });
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
  });
