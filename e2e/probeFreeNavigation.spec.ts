import { expect, test, type Page } from '@playwright/test';
import type { Camera, Matrix4, Vector3 } from 'three';
import type { CutMapInit, CutMapRequest, CutMapResponse } from '../src/ui/cutMapWorker';
import type { ProbePose } from '../src/probe/probe';
import type { AnatomyQuery } from '../src/anatomy/query';
import type { AnatomyScene } from '../src/anatomy/scene';
import type { PhysiologySample } from '../src/physiology/engine';
import { bootWithoutErrors, budget, windowAcquired, withinFrames, withinSimSeconds } from './support';

interface CutModelSnapshot extends Pick<CutMapInit, 'patient' | 'referenceProfile'> {
  hasAbdominalAtlas: boolean;
}

interface NavigatorWitness {
  n: number;
  faceErrorMm: number;
  axisError: number;
  fanErrorMm: number;
  screenX: number;
}
declare global {
  interface Window {
    freeNavigation: {
      cuts: Array<{ request: CutMapRequest; model: CutModelSnapshot; pose: ProbePose; n: number; response?: CutMapResponse }>;
      model?: CutModelSnapshot;
      navigator?: NavigatorWitness;
      inputs?: Array<{ type: string; pointerType: string; primary: boolean; trusted: boolean; x: number; y: number; frozen: boolean }>;
      parityDiagnostics?: unknown[];
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
      if (request.type !== 'map')
        window.freeNavigation.model = {
          patient: structuredClone(request.patient),
          referenceProfile: request.referenceProfile?.slice(),
          hasAbdominalAtlas: request.type === 'init' ? !!request.abdominalField : !!window.freeNavigation.model?.hasAbdominalAtlas,
        };
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
        const model = window.freeNavigation.model;
        if (!model) throw new Error('Cut request without observed model initialization');
        window.freeNavigation.cuts.push({
          request: structuredClone(request),
          model,
          pose: structuredClone(acquired.anatomy.pose),
          n: acquired.n,
        });
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
        probe: { matrix: { elements: number[] }; matrixWorld: Matrix4; position: { toArray(): number[]; clone(): Vector3 } };
        camera: Camera;
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
        screenX: nav.probe.position.clone().setFromMatrixPosition(nav.probe.matrixWorld).project(nav.camera).x,
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
      const cutFrame = Number(document.querySelector<HTMLElement>('#cutmap')!.dataset.acquiredFrame);
      // A live asynchronous map may trail by a frame. Freeze the acquired pose
      // first, then require that exact acquisition in every presentation.
      return (
        (samePose && window.freeNavigation.navigator?.n === a.n && (!s.frozen || cutFrame === a.n)) ||
        `pose=${samePose}, US=${a.n}, 3D=${window.freeNavigation.navigator?.n}, corte=${cutFrame}, frozen=${s.frozen}`
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
    const { request: req, response: map, model } = cut;
    // Own scene/query: setting compression also changes scene.bowelRadii. Never
    // use or mutate the current simulator query to judge an acquired snapshot.
    const Scene = s.scene.constructor as typeof AnatomyScene;
    const Query = s.anatomy.constructor as typeof AnatomyQuery;
    const cpuScene = new Scene(structuredClone(model.patient), model.referenceProfile);
    const cpu = new Query(cpuScene);
    cpu.setProbeCompression(structuredClone(req.compression));
    const sample = structuredClone(req.sample) as PhysiologySample;
    const caliber = cpu.caliberFor(sample);
    const points: number[] = [],
      expected: number[] = [];
    for (let v = 0; v < map.height; v += 16)
      for (let u = 0; u < map.width; u += 12) {
        const theta = -req.transducer.halfSector + (2 * req.transducer.halfSector * (u + 0.5)) / map.width;
        const range = req.transducer.curvatureRadius + (req.depthMm * (v + 0.5)) / map.height;
        // Independent geometric reconstruction; the beam direction is a unit
        // vector. Do not import the production cut-map projection as its oracle.
        const direction = req.frame.axial.map((a, i) => a * Math.cos(theta) + req.frame.lateral[i] * Math.sin(theta));
        const inverseLength = 1 / Math.hypot(...direction);
        points.push(...req.frame.curvatureCenter.map((x, i) => x + direction[i] * inverseLength * range));
        expected.push(map.tissue[v * map.width + u]);
      }
    // This exact array is sent to the renderer and used for the CPU comparison;
    // GPU input is Float32. No point is moved to avoid an anatomical boundary.
    const uploaded = new Float32Array(points);
    const gpu = s.renderer.queryPoints(
      uploaded,
      {
        ...structuredClone(shown.anatomy),
        caliber: cpu.caliberFor(structuredClone(shown.anatomy.sample)),
        probeVelocity: [0, 0, 0],
        bmode: structuredClone(shown.bmode),
        color: structuredClone(shown.color),
        updateColor: false,
      },
      true,
    );
    const classify = (world: [number, number, number]) => {
      const material = cpu.deformation.toMaterial(world, sample.resp);
      const c = cpu.scene.classify(material, caliber);
      return {
        material,
        tissue: Number(c.tissue), // Worker/GPU readbacks carry numeric tissue IDs.
        boundaryDistance: c.boundaryDistance,
        interface: c.interface,
        interfaceDistance: c.interfaceDistance,
        vessel: c.vessel,
      };
    };
    const samples = expected.map((tissue, i) => {
      const world = points.slice(3 * i, 3 * i + 3) as [number, number, number];
      const worldFloat32 = Array.from(uploaded.subarray(3 * i, 3 * i + 3)) as [number, number, number];
      return {
        index: i,
        world,
        worldFloat32,
        worker: tissue,
        gpu: { tissue: gpu.tissue[i], vessel: gpu.vessel[i], interface: gpu.iface[i], interfaceDistance: gpu.ifd[i] },
        cpuExact: classify(world),
        cpuFloat32: classify(worldFloat32),
      };
    });
    const workerMismatches = samples.filter((p) => p.worker !== p.cpuExact.tissue);
    const gpuMismatches = samples.filter((p) => p.gpu.tissue !== p.cpuFloat32.tissue);
    const precisionTransitions = samples.filter((p) => p.cpuExact.tissue !== p.cpuFloat32.tissue);
    // Round-to-nearest Float32 relative error <= 2^-24, or half a subnormal
    // spacing (2^-150). This bound permits only quantization, never a free shift.
    const rounding = points.map((world, i) => ({
      component: i,
      world,
      uploaded: uploaded[i],
      deltaMm: Math.abs(uploaded[i] - world),
      boundMm: Math.max(Math.abs(world) * 2 ** -24, 2 ** -150),
    }));
    const roundingErrors = rounding.filter(
      (p) =>
        !Number.isFinite(p.world) || !Number.isFinite(p.uploaded) || !Object.is(p.uploaded, Math.fround(p.world)) || p.deltaMm > p.boundMm,
    );
    const sampleFields = ['resp', 'ivc', 'ivcSupra', 'hvRadiusScale', 'pvRadiusScale', 'velocities'] as const;
    const sameSample = sampleFields.every((key) => JSON.stringify(req.sample[key]) === JSON.stringify(shown.anatomy.sample[key]));
    const sameCompression = JSON.stringify(req.compression) === JSON.stringify(shown.anatomy.compression);
    const samePatient = JSON.stringify(model.patient) === JSON.stringify(s.patient);
    const sameProfile = JSON.stringify(model.referenceProfile) === JSON.stringify(s.scene.torso.profile);
    const sameAtlas = cpuScene.hasAbdominalAtlas === model.hasAbdominalAtlas && model.hasAbdominalAtlas === s.scene.hasAbdominalAtlas;
    window.freeNavigation.parityDiagnostics?.push({
      acquired: shown.n,
      pose: shown.anatomy.pose,
      sample: shown.anatomy.sample,
      request: req,
      model,
      sameSample,
      sameCompression,
      samePatient,
      sameProfile,
      sameAtlas,
      samples,
      rounding,
      precisionTransitions,
      workerMismatches,
      gpuMismatches,
    });
    return {
      points: expected.length,
      workerMismatches,
      gpuMismatches,
      roundingErrors,
      precisionTransitions,
      sameSample,
      sameCompression,
      samePatient,
      sameProfile,
      sameAtlas,
      sameCutFrame: JSON.stringify(req.frame) === JSON.stringify(shown.anatomy.frame),
      sameCutPose: JSON.stringify(cut.pose) === JSON.stringify(shown.anatomy.pose),
      navigator: window.freeNavigation.navigator!,
      pose: s.pose,
      frame: shown.anatomy.frame,
    };
  });
  expect(result.points).toBeGreaterThanOrEqual(64);
  expect(result.roundingErrors, 'GPU coordinates are exactly Float32 quantization of the sampled world points').toEqual([]);
  expect(result.sameSample, 'Worker and GPU use the acquired physiology').toBe(true);
  expect(result.sameCompression, 'Worker and GPU use the acquired probe compression').toBe(true);
  expect(result.samePatient).toBe(true);
  expect(result.sameProfile).toBe(true);
  expect(result.sameAtlas).toBe(true);
  expect(result.workerMismatches, 'Worker versus independent CPU query at the exact sampled world coordinates').toEqual([]);
  expect(result.gpuMismatches, 'GPU versus independent CPU query at the actual uploaded Float32 coordinates').toEqual([]);
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
      await acquired(page);
      const before = await page.evaluate(() => {
        const s = window.__vexusTest!.sim();
        return { pose: s.pose, frame: s.frame, screenX: window.freeNavigation.navigator!.screenX };
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
        if (index === 0 && step === 1) {
          await acquired(page);
          const screenX = await page.evaluate(() => window.freeNavigation.navigator!.screenX);
          expect(screenX, 'the actual mirrored 3D probe follows the rightward pointer').toBeGreaterThan(before.screenX);
        }
        const moved = await page.evaluate(() => {
          const s = window.__vexusTest!.sim();
          return { pose: s.pose, frame: s.frame };
        });
        const arc = -Math.atan2(Math.sin(moved.pose.phi - previous), Math.cos(moved.pose.phi - previous));
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

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`subcostal right portal acquisition retains 3D and cut geometry while moving, ${caseId}`, async ({ page }, info) => {
    budget(180_000);
    await observe(page);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    await observeNavigator(page);
    await page.locator('[data-window="portalSubcostal"]').click();
    await windowAcquired(page, 'portalSubcostal');
    await page.locator('#mode-color').click();
    await page.locator('#mode-pw').click();
    expect(await page.evaluate(() => window.__vexusTest!.placeGate(['pvRight']))).toBe(true);
    await withinSimSeconds(page, 5, 'PW adquiere cuatro segundos de espectro portal', async () =>
      page.evaluate(() => {
        const columns = window.__vexusTest!.sim().spectral.columns;
        return (columns.length > 1 && columns.at(-1)!.t - columns[0].t >= 4) || 'espectro pendiente';
      }),
    );
    const records = [await parity(page)];
    await page.screenshot({ path: info.outputPath(`porta-subcostal-${caseId}.png`) });
    await page.locator('#freeze').click();
    await page.getByRole('tab', { name: 'Adquirir', exact: true }).click();
    // Real controls rotate the same acquired plane; no anatomy or image substitute.
    for (const name of ['Rotación', 'Basculación', 'Inclinación']) {
      const slider = page.getByRole('slider', { name, exact: true });
      await slider.fill(String(Number(await slider.inputValue()) + 5));
    }
    records.push(await parity(page));
    await page.locator('#freeze').click();
    await page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      s.setPose({ ...s.pose, phi: s.pose.phi - 0.04, z: s.pose.z + 4 });
    });
    records.push(await parity(page));
    expect(await page.evaluate(() => window.__vexusTest!.sim().pw.enabled)).toBe(true);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
    await info.attach('subcostal-portal-motion.json', { body: JSON.stringify({ caseId, records }), contentType: 'application/json' });
  });

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`captured probe drag resumes without accumulating frozen movement, ${caseId}`, async ({ page }, info) => {
    budget(180_000);
    await observe(page);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    await observeNavigator(page);
    await page.evaluate(() => {
      window.freeNavigation.inputs = [];
      window.freeNavigation.parityDiagnostics = [];
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
        window.addEventListener(type, (event) => {
          const e = event as PointerEvent;
          window.freeNavigation.inputs!.push({
            type: e.type,
            pointerType: e.pointerType,
            primary: e.isPrimary,
            trusted: e.isTrusted,
            x: e.clientX,
            y: e.clientY,
            frozen: window.__vexusTest!.sim().frozen,
          });
        });
    });
    const cdp = await page.context().newCDPSession(page);
    const records = [];
    let touchEnabled = false;
    const freeze = () => page.locator('#freeze').evaluate((el: HTMLButtonElement) => el.click());
    const state = () =>
      page.evaluate(() => {
        const s = window.__vexusTest!.sim(),
          shown = s.renderer.displayedFrame!;
        return { pose: s.pose, frozen: s.frozen, n: shown.n, t: shown.t, frame: shown.anatomy.frame };
      });
    try {
      for (const device of ['mouse', 'touch'] as const)
        for (const mode of ['slide', 'angle'] as const) {
          if (device === 'touch' && !touchEnabled) {
            await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
            touchEnabled = true;
          }
          // Interior pose: no clamps or angular seam can explain the resumed increment.
          await page.evaluate(() => window.__vexusTest!.sim().setPose({ phi: 0.73, z: -173, lift: 0, yaw: 0.37, rock: -0.42, tilt: 0.61 }));
          await acquired(page);
          const box = (await page.locator('#sector-wrap').boundingBox())!;
          const origin = { x: Math.round(box.x + box.width * 0.4), y: Math.round(box.y + box.height * 0.3) };
          let x = origin.x,
            y = origin.y;
          const button = mode === 'angle' ? 'right' : 'left';
          const points = () => [
            { id: 1, x, y, force: 1 },
            ...(mode === 'angle' ? [{ id: 2, x: origin.x + 40, y: origin.y + 20, force: 1 }] : []),
          ];
          const begin = async () => {
            x = origin.x;
            y = origin.y;
            if (device === 'mouse') {
              await page.mouse.move(x, y);
              await page.mouse.down({ button });
            } else await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points() });
          };
          const move = async (dx: number, dy: number) => {
            const firstEvent = await page.evaluate(() => window.freeNavigation.inputs!.length);
            x += dx;
            y += dy;
            if (device === 'mouse') await page.mouse.move(x, y);
            else await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points() });
            // CDP acknowledges dispatch before a coalesced touch move must reach JS.
            // Observe the real primary pointer event before changing freeze state.
            await withinFrames(page, 90, `${device}/${mode}: delivered pointermove`, async () =>
              page.evaluate(
                ({ firstEvent, device, x, y }) =>
                  window.freeNavigation
                    .inputs!.slice(firstEvent)
                    .some(
                      (e) => e.type === 'pointermove' && e.pointerType === device && e.primary && e.trusted && e.x === x && e.y === y,
                    ) || `pointermove pending: ${JSON.stringify(window.freeNavigation.inputs!.slice(-5))}`,
                { firstEvent, device, x, y },
              ),
            );
          };
          const end = async () => {
            if (device === 'mouse') await page.mouse.up({ button });
            else await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          };
          const before = await state();
          expect(before.frozen).toBe(false);
          await begin();
          await move(2, 2);
          const liveMove = await state();
          const keys = mode === 'slide' ? (['phi', 'z'] as const) : (['rock', 'tilt'] as const);
          for (const key of keys)
            expect(Math.abs(liveMove.pose[key] - before.pose[key]), `${device}/${mode}: real live input changes ${key}`).toBeGreaterThan(0);
          await acquired(page);
          // DOM activation preserves the captured pointer and does not move its coordinates.
          await freeze();
          await acquired(page);
          const paused = await state();
          expect(paused.frozen).toBe(true);
          await move(60, 100);
          const afterIgnoredMove = await state();
          expect(afterIgnoredMove, `${device}/${mode}: pause preserves pose and acquisition`).toEqual(paused);
          await freeze();
          await move(2, 2);
          const resumed = await state();
          await end();
          records.push({ device, mode, before, liveMove, paused, afterIgnoredMove, resumed });
          for (const key of keys)
            // Compare equal physical cursor increments with an observed live control;
            // no copy of the implementation's pixel-to-pose gains.
            expect
              .soft(resumed.pose[key] - paused.pose[key], `${device}/${mode}: resumed ${key} only follows the last 2px`)
              .toBeCloseTo(liveMove.pose[key] - before.pose[key], 10);
          const coherent = await parity(page);
          records.push({ device, mode, coherent });
          // A new gesture begun while frozen remains ignored even after resume.
          const ignoredStart = await state();
          expect(ignoredStart.frozen).toBe(true);
          await begin();
          await move(60, 100);
          expect(await state()).toEqual(ignoredStart);
          await freeze();
          await move(2, 2);
          const ignoredResume = await state();
          await end();
          expect(ignoredResume.pose, `${device}/${mode}: a gesture begun frozen never becomes active`).toEqual(ignoredStart.pose);
          await acquired(page);
          records.push({ device, mode, ignoredStart, ignoredResume });
        }
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
    } finally {
      await info.attach('freeze-resume-input.json', {
        body: JSON.stringify({
          caseId,
          records,
          observed: await page.evaluate(() => ({ inputs: window.freeNavigation.inputs, parity: window.freeNavigation.parityDiagnostics })),
        }),
        contentType: 'application/json',
      });
      if (touchEnabled) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await cdp.detach();
    }
  });
