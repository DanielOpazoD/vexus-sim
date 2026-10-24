import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import baseline from './fixtures/cutMapRasterBaseline.json';
import type { Simulator } from '../app/simulator';
import { Tissue } from '../anatomy/tissues';
import { CONVEX_C35 } from '../probe/probe';
import { CutMapView } from '../ui/cutMapView';
import type { CutMapResponse } from '../ui/cutMapWorker';
import * as sector from '../ultrasound/sectorGeometry';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Projection = { width: number; height: number; depth: number; radius: number; halfSector: number; mapW: number; mapH: number };
const initial: Projection = {
  width: 79,
  height: 83,
  depth: 180,
  radius: CONVEX_C35.curvatureRadius,
  halfSector: CONVEX_C35.halfSector,
  mapW: 96,
  mapH: 128,
};

function mapFor(p: Projection, offset = 0): CutMapResponse {
  const size = p.mapW * p.mapH;
  const tissues = [Tissue.Liver, Tissue.Fat, Tissue.Muscle, Tissue.Blood];
  return {
    type: 'map',
    id: 1,
    width: p.mapW,
    height: p.mapH,
    tissue: Uint8Array.from({ length: size }, (_, i) => tissues[(Math.floor(i / 7) + offset) % tissues.length]),
    vessel: Int8Array.from({ length: size }, (_, i) => (i % 3 === 0 ? 0 : -1)),
    structure: new Uint8Array(size),
  };
}

/** Known acquired maps isolate presentation; lifecycle tests cover the real Worker publication. */
function fixture() {
  const handlers = new Map<string, (event: unknown) => void>();
  vi.stubGlobal('document', { createElement: () => ({ hidden: true, style: {}, setAttribute() {}, remove() {} }) });
  let rgba = new Uint8ClampedArray();
  const text: unknown[][] = [];
  const paths: unknown[][] = [];
  const ctx = {
    createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: (image: ImageData) => {
      rgba = image.data.slice();
    },
    fillText: (...args: unknown[]) => text.push(['fill', ...args]),
    strokeText: (...args: unknown[]) => text.push(['stroke', ...args]),
    save() {},
    restore() {},
    setLineDash() {},
    beginPath() {},
    closePath() {},
    stroke() {},
    moveTo: (...args: unknown[]) => paths.push(['move', ...args]),
    quadraticCurveTo: (...args: unknown[]) => paths.push(['curve', ...args]),
  };
  const canvas = {
    width: 0,
    height: 0,
    clientWidth: 0,
    clientHeight: 0,
    dataset: {} as Record<string, string>,
    addEventListener: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn),
    removeEventListener() {},
    setAttribute() {},
    focus() {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height }),
  };
  const scene = { vessels: [{ id: 'pvTrunk' }] };
  const view = new CutMapView(canvas as unknown as HTMLCanvasElement);
  const sim = { scene, renderer: {}, displayed: {} } as unknown as Simulator;
  Reflect.set(view, 'worker', { postMessage() {}, terminate() {} });
  Reflect.set(view, 'workerScene', scene);
  let n = 0;
  return {
    canvas,
    view,
    paint(p: Projection, map: CutMapResponse, labels: boolean, selected = false) {
      Object.assign(canvas, { width: p.width, height: p.height, clientWidth: p.width, clientHeight: p.height });
      const inputs = {
        frameNumber: ++n,
        frame: { curvatureCenter: [0, 0, 0], axial: [0, 1, 0], lateral: [1, 0, 0] },
        sample: { resp: { diaphragmCaudalMm: 0 }, ivc: { dApMm: 10, dLatMm: 10 }, hvRadiusScale: 1, pvRadiusScale: 1 },
        compression: { nodes: [], plateMm: 0 },
        pose: { phi: 0, z: 0, lift: 0, yaw: 0, tilt: 0, rock: 0 },
        transducer: { ...CONVEX_C35, curvatureRadius: p.radius, halfSector: p.halfSector },
        depthMm: p.depth,
      };
      Object.assign(sim.renderer, { displayedFrame: { n, anatomy: inputs, bmode: { depthMm: p.depth } } });
      Object.assign(sim, { displayed: { bmode: { depthMm: p.depth } } });
      Reflect.set(view, 'mapInputs', inputs);
      Reflect.set(view, 'map', map);
      Reflect.set(view, 'mapDirty', true);
      view.setLabels(labels);
      if (selected) Reflect.set(view, 'pinned', { key: `t:${Tissue.Liver}`, label: 'hígado' });
      text.length = 0;
      paths.length = 0;
      view.draw(sim, n * 1000);
      return { rgba: Array.from(rgba), text: structuredClone(text), paths: structuredClone(paths), frame: canvas.dataset.acquiredFrame };
    },
  };
}

it.each([false, true])('preserves raster, contours and labels=%s across every projection invalidation and a return trip', (labels) => {
  const cached = fixture();
  const variants: Projection[] = [
    initial,
    { ...initial, width: 91 },
    initial,
    { ...initial, height: 95 },
    initial,
    { ...initial, depth: 110 },
    initial,
    { ...initial, radius: initial.radius + 8 },
    initial,
    { ...initial, halfSector: initial.halfSector * 0.8 },
    initial,
    { ...initial, mapW: 48 },
    initial,
    { ...initial, mapH: 64 },
    initial,
  ];
  for (const [i, projection] of variants.entries()) {
    const map = mapFor(projection, i % 4);
    const actual = cached.paint(projection, map, labels, true);
    // These hashes are captured from unmodified 311a0cf, not fitted to this candidate.
    const original = baseline.rows.find((row) => row.labels === labels && row.step === i);
    expect(original).toBeDefined();
    const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    expect(digest(actual.rgba)).toBe(original?.rgbaSha256);
    expect(digest(actual.text)).toBe(original?.textSha256);
    expect(digest(actual.paths)).toBe(original?.pathsSha256);
    expect(actual.paths.length).toBeGreaterThan(0);
    expect(actual.frame).toBe(String(i + 1));
  }
  cached.view.dispose();
});

it('reuses projection work for a new acquired map, while changing its pixels and retaining exact colors', () => {
  const convert = vi.spyOn(sector, 'pixelToBeam');
  const cached = fixture();
  const first = cached.paint(initial, mapFor(initial), false);
  const coldConversions = convert.mock.calls.length;
  expect(coldConversions).toBe(initial.width * initial.height);
  convert.mockClear();
  const second = cached.paint(initial, mapFor(initial, 1), false);
  expect(convert).not.toHaveBeenCalled();
  expect(second.rgba).not.toEqual(first.rgba);
  const colors = new Set<string>();
  for (let i = 0; i < second.rgba.length; i += 4) colors.add(second.rgba.slice(i, i + 4).join(','));
  expect(colors).toEqual(
    new Set(['13,15,19,255', '140,90,60,255', '214,190,110,255', '150,70,70,255', '80,110,200,255', '225,120,225,255']),
  );
  // Teacher labels use the same cached cells and the newly acquired tissue map.
  convert.mockClear();
  const teacher = cached.paint(initial, mapFor(initial, 1), true);
  expect(convert).not.toHaveBeenCalled();
  expect(teacher.rgba).toEqual(second.rgba);
  expect(teacher.text.length).toBeGreaterThan(second.text.length);
  cached.view.dispose();
});
