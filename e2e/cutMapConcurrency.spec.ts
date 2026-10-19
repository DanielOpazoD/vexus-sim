import { expect, test, type Page } from '@playwright/test';
import { bootWithoutErrors, budget, withinFrames } from './support';
import type { CutMapInit, CutMapProgress, CutMapRequest, CutMapResponse } from '../src/ui/cutMapWorker';

interface CutPaintWitness {
  acquiredFrame: number;
  sceneId: number;
  auxiliaryPaintsBefore: number;
  auxiliaryPaintsAfter?: number;
}

interface TracePaintWitness {
  sceneId: number;
  acquiredFrame: number | null;
  timeSeconds: number | null;
  width: number;
  height: number;
}

interface UnkeyedTracePaintWitness extends TracePaintWitness {
  scope: 'outside-acquired-trace-comparison';
  reason: 'test-hook-unavailable' | 'before-first-acquisition';
}

declare global {
  interface Window {
    cutWitness: {
      stressNext?: boolean;
      stressId?: number;
      tracePaints: number;
      keyedTracePaints: number;
      duplicateTracePaints: TracePaintWitness[];
      unkeyedTracePaints: UnkeyedTracePaintWitness[];
      progress: Array<{ id: number; rows: number }>;
      initializations: Array<{ patient: string; bytes: number; postMs: number }>;
      replies: Array<{
        id: number;
        patient: string;
        ms: number;
        frame: CutMapRequest['frame'];
        acquiredFrame: number;
        paintedFrame: number;
        activeScene: boolean;
        sceneId: number;
        paint?: CutPaintWitness;
      }>;
    };
  }
}

async function observe(page: Page) {
  await page.addInitScript(() => {
    window.cutWitness = {
      initializations: [],
      replies: [],
      progress: [],
      tracePaints: 0,
      keyedTracePaints: 0,
      duplicateTracePaints: [],
      unkeyedTracePaints: [],
    };
    const original: unknown = Reflect.get(Worker.prototype, 'postMessage');
    if (typeof original !== 'function') throw new Error('Worker.postMessage unavailable');
    const requests = new Map<
      number,
      { at: number; patient: string; frame: CutMapRequest['frame']; acquiredFrame: number; sceneId: number }
    >();
    const patients = new WeakMap<Worker, string>();
    const scenes = new WeakMap<Worker, number>();
    let currentSceneId = -1;
    let auxiliaryPaints = 0;
    let latestPaint: CutPaintWitness | undefined;
    let previousTraceKey: unknown[] | undefined;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      Reflect.apply(clear, this, args);
      if (this.canvas.id === 'overlay') auxiliaryPaints++;
    };
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
      Reflect.apply(fill, this, [x, y, width, height]);
      // drawEcg starts each real strip with this full-canvas background fill.
      if (this.canvas.id === 'ecg' && x === 0 && y === 0 && width === this.canvas.width && height === this.canvas.height) {
        auxiliaryPaints++;
        const sim = window.__vexusTest?.sim();
        const frame = sim?.renderer.displayedFrame;
        const witness = {
          sceneId: currentSceneId,
          acquiredFrame: frame?.n ?? null,
          timeSeconds: sim?.physiology.clock.t ?? null,
          width: this.canvas.width,
          height: this.canvas.height,
        };
        window.cutWitness.tracePaints++;
        if (!sim || !frame)
          window.cutWitness.unkeyedTracePaints.push({
            ...witness,
            scope: 'outside-acquired-trace-comparison',
            reason: !sim ? 'test-hook-unavailable' : 'before-first-acquisition',
          });
        else {
          window.cutWitness.keyedTracePaints++;
          // This scenario changes probe/case only: no capture, mark, M or
          // trace-setting control can legitimately invalidate an identical key.
          const key = [sim, frame, sim.equipment, sim.physiology.clock.t, this.canvas.width, this.canvas.height];
          if (previousTraceKey && key.every((value, index) => value === previousTraceKey![index]))
            window.cutWitness.duplicateTracePaints.push(witness);
          previousTraceKey = key;
        }
      }
    };
    const put = CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.putImageData = function (image: ImageData, x: number, y: number, ...dirty: number[]) {
      Reflect.apply(put, this, [image, x, y, ...dirty]);
      if (this.canvas.id !== 'cutmap') return;
      const paint: CutPaintWitness = {
        acquiredFrame: Number(this.canvas.dataset.acquiredFrame),
        sceneId: currentSceneId,
        auxiliaryPaintsBefore: auxiliaryPaints,
      };
      latestPaint = paint;
      // Observe the rest of this real delivery handler, without allowing a RAF
      // or timer to interleave. Keep this object shared with its reply witness.
      queueMicrotask(() => {
        paint.auxiliaryPaintsAfter = auxiliaryPaints;
      });
    };
    Worker.prototype.postMessage = function (message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
      const packet = message as CutMapInit | CutMapRequest;
      const at = performance.now();
      if ('patient' in packet) {
        if (!patients.has(this)) {
          this.addEventListener('message', (event: MessageEvent<CutMapResponse | CutMapProgress>) => {
            if (event.data.type === 'progress') window.cutWitness.progress.push({ id: event.data.id, rows: event.data.rows });
            const req = requests.get(event.data.id);
            if (event.data.type !== 'map' || !req) return;
            // This listener was registered at init post, after the production
            // onmessage handler. Observe its synchronous publication before
            // another RAF can acquire or paint a different frame.
            window.cutWitness.replies.push({
              id: event.data.id,
              ...req,
              ms: performance.now() - req.at,
              paintedFrame: Number(document.querySelector<HTMLElement>('#cutmap')!.dataset.acquiredFrame),
              activeScene: scenes.get(this) === req.sceneId,
              paint: latestPaint?.sceneId === req.sceneId && latestPaint.acquiredFrame === req.acquiredFrame ? latestPaint : undefined,
            });
            requests.delete(event.data.id);
          });
        }
        patients.set(this, packet.patient.id);
        scenes.set(this, packet.id);
        currentSceneId = packet.id;
      } else if (packet.type === 'map') {
        // A denser REAL classifier job reproduces CPU contention without fake
        // timers/responses or changing the worker's production timeout.
        if (window.cutWitness.stressNext) {
          window.cutWitness.stressNext = false;
          window.cutWitness.stressId = packet.id;
          packet.width *= 16;
          packet.height *= 16;
        }
        requests.set(packet.id, {
          at,
          patient: patients.get(this)!,
          frame: packet.frame,
          acquiredFrame: window.__vexusTest!.sim().renderer.displayedFrame!.n,
          sceneId: scenes.get(this)!,
        });
      }
      Reflect.apply(original, this, [message, transfer]);
      if ('patient' in packet)
        window.cutWitness.initializations.push({
          patient: packet.patient.id,
          bytes: (packet.abdominalField?.byteLength ?? 0) + (packet.thoracicField?.byteLength ?? 0),
          postMs: performance.now() - at,
        });
    };
  });
}

test('manual probe sliders retain the requested pose during an automatic window transition', async ({ page }) => {
  budget(60_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  for (const [i, name] of ['Rotación', 'Inclinación', 'Basculación', 'Presión'].entries()) {
    await page.locator(`[data-window="${i % 2 ? 'intercostal' : 'hepatorenal'}"]`).click();
    await page.getByRole('slider', { name, exact: true }).press('ArrowRight');
    const manual = await page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      return { pose: s.pose, frame: s.frame, n: s.renderer.displayedFrame!.n };
    });
    let previous = manual.n;
    // Observe two NEW acquisitions, rather than paying for twenty idle GPU
    // frames. Each ordinary frame runs the animator; a missing cancellation
    // changes the probe immediately. The model separately checks 80 ticks.
    for (let acquisition = 0; acquisition < 2; acquisition++) {
      await withinFrames(page, 45, 'nueva adquisición tras el ajuste manual', async () =>
        page.evaluate((n) => window.__vexusTest!.sim().renderer.displayedFrame!.n > n || 'pendiente', previous),
      );
      const actual = await page.evaluate(() => {
        const s = window.__vexusTest!.sim(),
          shown = s.renderer.displayedFrame!;
        // Synchronize the real presented target, not a JS frame counter.
        const image = s.renderer.readDisplay();
        return {
          pose: s.pose,
          acquiredPose: shown.anatomy.pose,
          frame: shown.anatomy.frame,
          n: shown.n,
          signal: image.gray.some((v) => v > 0),
        };
      });
      expect(actual.pose).toEqual(manual.pose);
      expect(actual.acquiredPose).toEqual(manual.pose);
      expect(actual.frame).toEqual(manual.frame);
      expect(actual.signal).toBe(true);
      previous = actual.n;
    }
  }
  expect(errors).toEqual([]);
});

test('two live atlas views keep producing the current cut through probe and case changes', async ({ page, context }, info) => {
  budget(180_000, 2);
  const other = await context.newPage();
  const pages = [page, other];
  const consoleErrors: string[][] = [];
  try {
    for (const p of pages) {
      await observe(p);
      consoleErrors.push(await bootWithoutErrors(p, '?e2e=app&abdomen=atlas'));
    }
    for (const id of ['severe-congestion', 'normal-adult', 'severe-congestion']) {
      await Promise.all(
        pages.map(async (p) => {
          await p.selectOption('#case-select', id);
          await p.locator('[data-window="hepatorenal"]').click();
          for (const name of ['Rotación', 'Inclinación', 'Basculación'])
            await p.getByRole('slider', { name, exact: true }).press('ArrowRight');
        }),
      );
      for (const p of pages) {
        const prior = await p.evaluate(() => window.cutWitness.replies.at(-1)?.id ?? -1);
        await withinFrames(p, 90, 'corte de la pose y caso actuales con dos vistas vivas', async () =>
          p.evaluate(
            ({ id, prior }) => {
              const reply = window.cutWitness.replies.at(-1);
              return (
                (!!reply &&
                  reply.id > prior &&
                  reply.patient === id &&
                  JSON.stringify(reply.frame) === JSON.stringify(window.__vexusTest!.sim().frame)) ||
                'corte pendiente'
              );
            },
            { id, prior },
          ),
        );
        const delivered = await p.evaluate(() => window.cutWitness.replies.at(-1)!);
        expect(delivered.activeScene).toBe(true);
        expect(delivered.paintedFrame).toBe(delivered.acquiredFrame);
        expect(delivered.paint).toMatchObject({ acquiredFrame: delivered.acquiredFrame, sceneId: delivered.sceneId });
        expect(delivered.paint!.auxiliaryPaintsAfter).toBe(delivered.paint!.auxiliaryPaintsBefore);
      }
    }
    await page.evaluate(() => {
      window.cutWitness.stressNext = true;
    });
    await page.waitForFunction(() => {
      const w = window.cutWitness;
      return w.replies.some((r) => r.id === w.stressId) || window.__vexusTest!.loggedErrors().length;
    });
    expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
    expect(await page.evaluate(() => window.cutWitness.replies.find((r) => r.id === window.cutWitness.stressId)?.ms)).toBeGreaterThan(3000);
    // Change patient while another expensive acquired cut is still computing.
    await page.evaluate(() => {
      window.cutWitness.stressNext = true;
    });
    await page.waitForFunction(() => {
      const w = window.cutWitness;
      return !w.stressNext && w.progress.some((p) => p.id === w.stressId);
    });
    const abandoned = await page.evaluate(() => window.cutWitness.stressId!);
    await page.selectOption('#case-select', 'normal-adult');
    await withinFrames(page, 90, 'corte del nuevo paciente tras cancelar el cálculo anterior', async () =>
      page.evaluate(
        (abandoned) => window.cutWitness.replies.some((r) => r.id > abandoned && r.patient === 'normal-adult') || 'pendiente',
        abandoned,
      ),
    );
    expect(await page.evaluate((id) => window.cutWitness.replies.some((r) => r.id === id), abandoned)).toBe(false);
    for (const p of pages) {
      const delivered = await p.evaluate(() => window.cutWitness.replies.filter((reply) => reply.activeScene));
      expect(delivered.length).toBeGreaterThan(0);
      for (const reply of delivered) {
        expect(reply.paintedFrame).toBe(reply.acquiredFrame);
        expect(reply.paint).toMatchObject({ acquiredFrame: reply.acquiredFrame, sceneId: reply.sceneId });
        expect(reply.paint!.auxiliaryPaintsAfter).toBe(reply.paint!.auxiliaryPaintsBefore);
      }
      const traces = await p.evaluate(() => ({
        paints: window.cutWitness.tracePaints,
        keyedPaints: window.cutWitness.keyedTracePaints,
        duplicates: window.cutWitness.duplicateTracePaints,
        unkeyed: window.cutWitness.unkeyedTracePaints,
      }));
      expect(traces.paints).toBeGreaterThan(0);
      expect(traces.keyedPaints).toBeGreaterThan(0);
      expect(traces.duplicates).toEqual([]);
      const loads = await p.evaluate(() => window.cutWitness.initializations);
      expect(loads[0].bytes).toBeGreaterThan(100_000_000);
      expect(loads.slice(1).every((i) => i.bytes === 0)).toBe(true);
    }
    for (const p of pages) expect(await p.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
    for (const errors of consoleErrors) expect(errors).toEqual([]);
  } finally {
    for (let i = 0; i < pages.length; i++)
      await info.attach(`view-${i}.json`, {
        body: JSON.stringify(
          await pages[i].evaluate(() => ({
            ...window.cutWitness,
            errors: window.__vexusTest?.loggedErrors(),
          })),
        ),
        contentType: 'application/json',
      });
    await other.close();
  }
});
