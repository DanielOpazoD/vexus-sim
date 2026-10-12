import { afterEach, describe, expect, it, vi } from 'vitest';
import { CutMapView } from '../ui/cutMapView';
import type { Simulator } from '../app/simulator';
import { CONVEX_C35 } from '../probe/probe';
import { Tissue } from '../anatomy/tissues';
import { beamToPixel, sectorLayout } from '../ultrasound/sectorGeometry';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const handlers = new Map<string, (event: unknown) => void>();
  const tooltip = { hidden: true, style: {}, setAttribute() {} };
  vi.stubGlobal('document', { createElement: () => tooltip });
  const canvas = {
    width: 400,
    height: 400,
    clientWidth: 400,
    clientHeight: 400,
    dataset: {} as Record<string, string>,
    addEventListener: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn),
    removeEventListener() {},
    setAttribute() {},
    focus() {},
    getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
  };
  const view = new CutMapView(canvas as unknown as HTMLCanvasElement);
  const frame = { curvatureCenter: [0, 0, 0], axial: [0, 1, 0], lateral: [1, 0, 0] };
  const sample = { resp: { diaphragmCaudalMm: 0 }, ivc: { dApMm: 10, dLatMm: 10 }, hvRadiusScale: 1, pvRadiusScale: 1 };
  const compression = { nodes: [], plateMm: 0 };
  const scene = { vessels: [] };
  const anatomy = { frame: structuredClone(frame), sample, compression };
  const sim = { scene, displayed: { bmode: { depthMm: 100 } }, renderer: { displayedFrame: { anatomy } } } as unknown as Simulator;
  Reflect.set(view, 'drawn', {
    scene,
    transducer: CONVEX_C35,
    inputs: { depthMm: 100, frame, sample, compression },
    map: {
      width: 1,
      height: 1,
      tissue: new Uint8Array([Tissue.Liver]),
      vessel: new Int16Array([-1]),
      structure: new Uint16Array([0]),
    },
  });
  const pixel = beamToPixel(sectorLayout(400, 400, CONVEX_C35, 100, 6), CONVEX_C35, 0, 50);
  const event = { clientX: pixel.x, clientY: pixel.y };
  const refresh = () => view.drawHighlight(canvas as unknown as HTMLCanvasElement, sim);
  refresh();
  return { canvas, view, anatomy, refresh, hover: () => handlers.get('pointermove')!(event), click: () => handlers.get('click')!(event) };
}

describe('selección del corte durante la espera del Worker', () => {
  it('no muestra ni fija la identidad de un plano anterior', () => {
    const f = fixture();
    f.hover();
    f.refresh();
    expect(f.canvas.dataset.hoverKey).toBe(`t:${Tissue.Liver}`);
    f.anatomy.frame.curvatureCenter[0] = 30;
    f.refresh();
    expect(f.canvas.dataset.hoverKey).toBeUndefined();
    f.click();
    expect(f.canvas.dataset.selectedKey).toBeUndefined();
  });
  it('conserva una selección válida durante la espera y permite quitarla al recuperar el mapa', () => {
    const f = fixture();
    f.click();
    expect(f.canvas.dataset.selectedKey).toBe(`t:${Tissue.Liver}`);
    f.anatomy.frame.curvatureCenter[0] = 30;
    f.refresh();
    f.click();
    expect(f.canvas.dataset.selectedKey).toBe(`t:${Tissue.Liver}`);
    f.anatomy.frame.curvatureCenter[0] = 0;
    f.refresh();
    f.click();
    expect(f.canvas.dataset.selectedKey).toBeUndefined();
  });
});
