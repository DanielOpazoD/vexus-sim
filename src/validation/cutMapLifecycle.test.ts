import { afterEach, expect, it, vi, type Mock } from 'vitest';
import type { CutMapInit, CutMapRequest } from '../ui/cutMapWorker';
import { CutMapView } from '../ui/cutMapView';
import type { Simulator } from '../app/simulator';
import { errorLog } from '../app/errorLog';
import { CONVEX_C35 } from '../probe/probe';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture(onMapReady?: () => void) {
  const workers: Array<{
    postMessage: Mock<(message: CutMapInit | CutMapRequest) => void>;
    terminate: ReturnType<typeof vi.fn>;
    onmessage: (e: unknown) => void;
  }> = [];
  vi.stubGlobal(
    'Worker',
    class {
      postMessage = vi.fn<(message: CutMapInit | CutMapRequest) => void>();
      terminate = vi.fn();
      onmessage = () => {};
      constructor() {
        workers.push(this);
      }
    },
  );
  vi.stubGlobal('document', { createElement: () => ({ style: {}, setAttribute() {}, remove() {} }) });
  const canvas = {
    dataset: {} as Record<string, string>,
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getContext: () => null,
  };
  const view = new CutMapView(canvas as unknown as HTMLCanvasElement, onMapReady);
  const sim = {
    patient: { id: 'normal-adult' },
    scene: { torso: {} },
    renderer: {
      displayedFrame: {
        n: 1,
        anatomy: { sample: {}, frame: {}, pose: { phi: 0, z: 0, lift: 0, yaw: 0, tilt: 0, rock: 0 } },
        bmode: { depthMm: 160 },
      },
    },
  } as unknown as Simulator;
  const report = vi.spyOn(errorLog, 'report');
  return { view, sim, workers, report, canvas };
}

it('notifies presentation only for an accepted map, after publishing its acquired inputs', () => {
  const ready = vi.fn(() => {
    expect(view.lastMap?.map).toBe(response);
    expect(view.lastMap?.frameNumber).toBe(1);
    expect(view.lastMap?.frame).toBe(sim.renderer.displayedFrame!.anatomy.frame);
  });
  const { view, sim, workers, report } = fixture(ready);
  view.draw(sim, 1000);
  const request = workers[0].postMessage.mock.calls.at(-1)![0];
  const response = { type: 'map', id: request.id };
  workers[0].onmessage({ data: { type: 'progress', id: request.id, rows: 16 } });
  workers[0].onmessage({ data: { type: 'map', id: request.id - 2 } });
  workers[0].onmessage({ data: { type: 'error', id: request.id - 2, message: 'obsolete request' } });
  expect(ready).not.toHaveBeenCalled();
  expect(view.lastMap).toBeNull();
  workers[0].onmessage({ data: response });
  expect(ready).toHaveBeenCalledOnce();
  expect(report).not.toHaveBeenCalled();
  view.dispose();
  workers[0].onmessage({ data: response });
  expect(ready).toHaveBeenCalledOnce();
});

it('does not notify presentation for a failed or replaced worker', () => {
  const ready = vi.fn();
  const { view, sim, workers, report } = fixture(ready);
  view.draw(sim, 1000);
  const request = workers[0].postMessage.mock.calls.at(-1)![0];
  vi.spyOn(performance, 'now').mockReturnValue(1001);
  workers[0].onmessage({ data: { type: 'error', id: request.id, message: 'classification failed' } });
  expect(report).toHaveBeenCalledOnce();
  expect(ready).not.toHaveBeenCalled();
  view.draw(sim, 2001);
  expect(workers).toHaveLength(2);
  workers[0].onmessage({ data: { type: 'map', id: request.id } });
  expect(ready).not.toHaveBeenCalled();
  expect(view.lastMap).toBeNull();
  view.dispose();
});

it('presents between animation frames and immediately coalesces to the latest acquired snapshot', () => {
  let now = 1000;
  let service = () => {};
  const ready = vi.fn(() => service());
  const { view, sim, workers, canvas } = fixture(ready);
  const ctx = {
    createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: vi.fn(),
    fillText: vi.fn(),
  };
  Object.assign(canvas, { width: 12, height: 12, clientWidth: 12, clientHeight: 12, getContext: () => ctx });
  Object.assign(sim.scene, { vessels: [] });
  const shown = sim.renderer.displayedFrame!;
  Object.assign(shown.anatomy, {
    frame: { curvatureCenter: [0, 0, 0], axial: [0, 1, 0], lateral: [1, 0, 0] },
    sample: { resp: { diaphragmCaudalMm: 0 }, ivc: { dApMm: 10, dLatMm: 10 }, hvRadiusScale: 1, pvRadiusScale: 1 },
    compression: { nodes: [], plateMm: 0 },
    transducer: CONVEX_C35,
  });
  Object.assign(sim, { displayed: { bmode: shown.bmode } });
  view.setLabels(false);
  service = () => view.draw(sim, now);
  view.draw(sim, now);
  const first = workers[0].postMessage.mock.calls.at(-1)![0];
  for (const z of [1, 2]) {
    shown.n++;
    shown.anatomy = { ...shown.anatomy, frame: { ...shown.anatomy.frame }, pose: { ...shown.anatomy.pose, z } };
    view.draw(sim, ++now);
  }
  sim.pose = { ...shown.anatomy.pose, z: 999 };
  const requests = () => workers[0].postMessage.mock.calls.flatMap(([message]) => (message.type === 'map' ? [message] : []));
  expect(requests()).toHaveLength(1);
  const deliver = (id: number) =>
    workers[0].onmessage({
      data: {
        type: 'map',
        id,
        width: 96,
        height: 128,
        tissue: new Uint8Array(96 * 128),
        vessel: new Int8Array(96 * 128).fill(-1),
        structure: new Uint8Array(96 * 128),
      },
    });

  // The worker event is the only service opportunity: no RAF or manual draw
  // intervenes between delivery, dispatch of N+2 and publication of N.
  deliver(first.id);
  expect(ready).toHaveBeenCalledOnce();
  expect(requests()).toHaveLength(2);
  const latest = requests()[1];
  expect(latest.frame).toBe(shown.anatomy.frame);
  expect(latest.sample).toBe(shown.anatomy.sample);
  expect(latest.compression).toBe(shown.anatomy.compression);
  expect(latest.transducer).toBe(CONVEX_C35);
  expect(latest).toMatchObject({ pose: { z: 2 }, depthMm: 160, width: 96, height: 128 });
  expect(canvas.dataset.acquiredFrame).toBe('1');
  expect(ctx.putImageData).toHaveBeenCalledOnce();

  deliver(latest.id);
  expect(canvas.dataset.acquiredFrame).toBe('3');
  expect(ctx.putImageData).toHaveBeenCalledTimes(2);
  expect(requests()).toHaveLength(2);
  view.draw(sim, now + 1);
  expect(requests()).toHaveLength(2); // identical frozen acquisition

  // A fresh physiological sample with unchanged pose still waits exactly the
  // existing 8 Hz cadence; immediate service does not create an idle busy loop.
  shown.n++;
  shown.anatomy = { ...shown.anatomy, frame: { ...shown.anatomy.frame }, sample: { ...shown.anatomy.sample } };
  view.draw(sim, now + 124);
  expect(requests()).toHaveLength(2);
  view.draw(sim, now + 125);
  expect(requests()).toHaveLength(3);
  view.dispose();
});

it('abandons an overdue old case before checking its watchdog and reuses the loaded worker', () => {
  const { view, sim, workers, report } = fixture();
  view.draw(sim, 1000);
  for (let i = 1; i <= 12; i++) view.draw(sim, 1000 + i * 250);
  const next = { ...sim, scene: { ...sim.scene }, patient: { ...sim.patient, id: 'severe-congestion' } };
  view.draw(next as unknown as Simulator, 4250);
  expect(report).not.toHaveBeenCalled();
  expect(workers).toHaveLength(1);
  expect(workers[0].terminate).not.toHaveBeenCalled();
  expect(workers[0].postMessage.mock.calls.at(-2)?.[0]).toMatchObject({ patient: { id: 'severe-congestion' } });
  view.dispose();
});

it('does not reclassify the same frozen acquisition', () => {
  const { view, sim, workers } = fixture();
  view.draw(sim, 1000);
  const request = workers[0].postMessage.mock.calls.at(-1)![0];
  workers[0].onmessage({ data: { type: 'map', id: request.id } });
  view.draw(sim, 5000);
  expect(workers[0].postMessage.mock.calls.filter(([m]) => m.type === 'map')).toHaveLength(1);
  view.dispose();
});

it('cancels the previous scene immediately without waiting for another acquired frame', () => {
  const { view, sim, workers, report } = fixture();
  view.draw(sim, 1000);
  const old = workers[0].postMessage.mock.calls.at(-1)![0];
  const next = { ...sim, scene: { ...sim.scene }, patient: { ...sim.patient, id: 'severe-congestion' } } as Simulator;
  view.onSimulatorChanged(next);
  expect(workers).toHaveLength(1);
  expect(workers[0].postMessage.mock.calls.at(-1)![0]).toMatchObject({ type: 'patient', patient: { id: 'severe-congestion' } });
  expect(workers[0].postMessage.mock.calls.filter(([m]) => m.type === 'map')).toHaveLength(1);
  workers[0].onmessage({ data: { type: 'error', id: old.id, message: 'obsolete scene' } });
  workers[0].onmessage({ data: { type: 'map', id: old.id } });
  expect(report).not.toHaveBeenCalled();
  expect(view.lastMap).toBeNull();
  view.draw(next, 1250);
  expect(workers[0].postMessage.mock.calls.filter(([m]) => 'patient' in m)).toHaveLength(2);
  expect(workers[0].postMessage.mock.calls.at(-1)![0].id).toBeGreaterThan(old.id);
  view.dispose();
});

it('reports initialization failure between a scene change and its next acquired frame', () => {
  const { view, sim, workers, report } = fixture();
  view.draw(sim, 1000);
  view.onSimulatorChanged({ ...sim, scene: { ...sim.scene } } as Simulator);
  const obsolete = workers[0].postMessage.mock.calls.at(-1)![0];
  view.onSimulatorChanged({ ...sim, scene: { ...sim.scene } } as Simulator);
  const init = workers[0].postMessage.mock.calls.at(-1)![0];
  workers[0].onmessage({ data: { type: 'error', id: obsolete.id, message: 'obsolete initialization' } });
  expect(report).not.toHaveBeenCalled();
  workers[0].onmessage({ data: { type: 'error', id: init.id, message: 'invalid next scene' } });
  expect(report).toHaveBeenCalledOnce();
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  view.dispose();
});

it('keeps the idle physiological cadence and accepts fresh snapshots even with repeated frame counters', () => {
  const { view, sim, workers } = fixture();
  view.draw(sim, 1000);
  const request = workers[0].postMessage.mock.calls.at(-1)![0];
  workers[0].onmessage({ data: { type: 'map', id: request.id } });
  const shown = sim.renderer.displayedFrame!;
  shown.anatomy = { ...shown.anatomy, frame: { ...shown.anatomy.frame } };
  view.draw(sim, 1020);
  expect(workers[0].postMessage.mock.calls.filter(([m]) => m.type === 'map')).toHaveLength(1);
  view.draw(sim, 1125);
  expect(workers[0].postMessage.mock.calls.filter(([m]) => m.type === 'map')).toHaveLength(2);
  view.dispose();
});

it('coalesces movement during a pending cut and sends only the latest acquisition afterwards', () => {
  const { view, sim, workers } = fixture();
  view.draw(sim, 1000);
  const request = workers[0].postMessage.mock.calls.at(-1)![0];
  const shown = sim.renderer.displayedFrame!;
  for (const t of [1020, 1040]) {
    shown.n++;
    shown.anatomy = { ...shown.anatomy, frame: { ...shown.anatomy.frame }, pose: { ...shown.anatomy.pose, tilt: t / 10000 } };
    view.draw(sim, t);
  }
  expect(workers[0].postMessage.mock.calls.filter(([m]) => m.type === 'map')).toHaveLength(1);
  workers[0].onmessage({ data: { type: 'map', id: request.id } });
  view.draw(sim, 1125);
  expect(workers[0].postMessage.mock.calls.at(-1)![0]).toMatchObject({ pose: shown.anatomy.pose });
  expect(workers[0].postMessage.mock.calls.filter(([m]) => m.type === 'map')).toHaveLength(2);
  view.dispose();
});

it.each(['phi', 'z', 'lift', 'yaw', 'tilt', 'rock'] as const)(
  'requests acquired %s movement without waiting for the idle cadence',
  (key) => {
    const { view, sim, workers } = fixture();
    view.draw(sim, 1000);
    const request = workers[0].postMessage.mock.calls.at(-1)![0];
    const shown = sim.renderer.displayedFrame!;
    // Multiple newer acquisitions arrive during one calculation. Keep the
    // worker bounded, then request the latest acquired pose on its next turn.
    for (const step of [1, 2]) {
      shown.n++;
      shown.anatomy = { ...shown.anatomy, frame: { ...shown.anatomy.frame }, pose: { ...shown.anatomy.pose, [key]: step * 0.01 } };
      view.draw(sim, 1000 + step * 5);
    }
    expect(workers[0].postMessage.mock.calls.filter(([m]) => m.type === 'map')).toHaveLength(1);
    workers[0].onmessage({ data: { type: 'map', id: request.id } });
    view.draw(sim, 1020);
    expect(workers[0].postMessage.mock.calls.filter(([m]) => m.type === 'map')).toHaveLength(2);
    expect(workers[0].postMessage.mock.calls.at(-1)![0]).toMatchObject({ pose: shown.anatomy.pose });
    view.dispose();
  },
);

it('updates acquired depth immediately while preserving the snapshot and grid', () => {
  const { view, sim, workers } = fixture();
  view.draw(sim, 1000);
  const request = workers[0].postMessage.mock.calls.at(-1)![0];
  workers[0].onmessage({ data: { type: 'map', id: request.id } });
  const shown = sim.renderer.displayedFrame!;
  shown.anatomy = { ...shown.anatomy, frame: { ...shown.anatomy.frame } };
  shown.bmode = { ...shown.bmode, depthMm: 200 };
  view.draw(sim, 1020);
  expect(workers[0].postMessage.mock.calls.filter(([m]) => m.type === 'map')).toHaveLength(2);
  expect(workers[0].postMessage.mock.calls.at(-1)![0]).toMatchObject({
    frame: shown.anatomy.frame,
    sample: shown.anatomy.sample,
    depthMm: 200,
    width: 96,
    height: 128,
  });
  view.dispose();
});

it('waits for the acquired pose instead of sending a newer live gesture to the worker', () => {
  const { view, sim, workers } = fixture();
  view.draw(sim, 1000);
  const request = workers[0].postMessage.mock.calls.at(-1)![0];
  workers[0].onmessage({ data: { type: 'map', id: request.id } });
  const shown = sim.renderer.displayedFrame!;
  sim.pose = { ...shown.anatomy.pose, z: 20 };
  shown.anatomy = { ...shown.anatomy, frame: { ...shown.anatomy.frame } };
  view.draw(sim, 1020);
  expect(workers[0].postMessage.mock.calls.filter(([m]) => m.type === 'map')).toHaveLength(1);
  view.draw(sim, 1125);
  expect(workers[0].postMessage.mock.calls.at(-1)![0]).toMatchObject({ pose: shown.anatomy.pose });
  view.dispose();
});

it('reinitializes a new scene even when the patient id is unchanged and ignores obsolete errors', () => {
  const { view, sim, workers, report } = fixture();
  view.draw(sim, 1000);
  const old = workers[0].postMessage.mock.calls.at(-1)![0];
  view.draw({ ...sim, scene: { ...sim.scene } } as unknown as Simulator, 1250);
  const sent = workers[0].postMessage.mock.calls;
  expect(sent.filter(([m]) => 'patient' in m)).toHaveLength(2);
  workers[0].onmessage({ data: { type: 'error', id: old.id, message: 'obsolete scene' } });
  workers[0].onmessage({ data: { type: 'map', id: old.id } });
  expect(report).not.toHaveBeenCalled();
  expect(view.lastMap).toBeNull();
  view.dispose();
});

it('accepts actual progress but still times out when completed rows stop arriving', () => {
  const { view, sim, workers, report } = fixture();
  view.draw(sim, 1000);
  const request = workers[0].postMessage.mock.calls.at(-1)![0];
  for (let i = 1; i <= 12; i++) view.draw(sim, 1000 + i * 250);
  vi.spyOn(performance, 'now').mockReturnValue(4000);
  workers[0].onmessage({ data: { type: 'progress', id: request.id, rows: 16 } });
  view.draw(sim, 4250);
  expect(report).not.toHaveBeenCalled();
  for (let i = 2; i <= 13; i++) view.draw(sim, 4000 + i * 250);
  expect(report).toHaveBeenCalledOnce();
  view.dispose();
});

it('reports failure to initialize the current scene even with its map already queued', () => {
  const { view, sim, workers, report } = fixture();
  view.draw(sim, 1000);
  const init = workers[0].postMessage.mock.calls[0][0];
  workers[0].onmessage({ data: { type: 'error', id: init.id, message: 'invalid atlas' } });
  expect(report).toHaveBeenCalledOnce();
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  view.dispose();
});

it('still terminates a worker with no progress and retries with a fresh worker', () => {
  const { view, sim, workers, report } = fixture();
  view.draw(sim, 1000);
  for (let i = 1; i <= 13; i++) view.draw(sim, 1000 + i * 250);
  expect(report).toHaveBeenCalledOnce();
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  view.draw(sim, 5250);
  expect(workers).toHaveLength(2);
  const init = workers[1].postMessage.mock.calls[0][0];
  expect(init.type).toBe('init');
  view.dispose();
});
