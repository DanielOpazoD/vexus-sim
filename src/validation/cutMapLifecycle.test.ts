import { afterEach, expect, it, vi, type Mock } from 'vitest';
import type { CutMapInit, CutMapRequest } from '../ui/cutMapWorker';
import { CutMapView } from '../ui/cutMapView';
import type { Simulator } from '../app/simulator';
import { errorLog } from '../app/errorLog';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture() {
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
  const canvas = { dataset: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, getContext: () => null };
  const view = new CutMapView(canvas as unknown as HTMLCanvasElement);
  const sim = {
    patient: { id: 'normal-adult' },
    scene: { torso: {} },
    renderer: { displayedFrame: { anatomy: { sample: {} }, bmode: { depthMm: 160 } } },
  } as unknown as Simulator;
  const report = vi.spyOn(errorLog, 'report');
  return { view, sim, workers, report };
}

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
