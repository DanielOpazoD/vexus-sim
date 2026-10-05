import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultEquipment, type Simulator } from '../app/simulator';
import type { SpectralColumn } from '../doppler/spectral';
import type { CaptureOverlay } from '../ui/captureOverlay';
import { SpectrogramView } from '../ui/displays';

function canvas() {
  const context = {
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    putImageData: vi.fn(),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
  };
  return { element: { width: 400, height: 100, getContext: () => context } as unknown as HTMLCanvasElement, context };
}

function setup() {
  const visible = canvas(),
    offscreen = canvas();
  vi.stubGlobal('document', { createElement: () => offscreen.element });
  const pw = { ...defaultEquipment().pw, enabled: true, prfHz: 2000 };
  const sim = { pw, spectral: { fftSize: 128, hop: 16 }, pwNyquistCms: () => pw.prfHz * 0.0154 } as unknown as Simulator;
  const view = new SpectrogramView(visible.element);
  const columns: SpectralColumn[] = [0.8, 0.9].map((t) => ({ t, prfHz: 2000, powerDb: new Float32Array(128).fill(-30) }));
  const capture: CaptureOverlay = {
    accepted: true,
    prfHz: 2000,
    trace: [
      { t: 0.8, fHz: 200 },
      { t: 0.9, fHz: 250 },
    ],
    marks: [],
    beats: [],
  };
  return { visible, offscreen, pw, sim, view, columns, capture };
}

afterEach(() => vi.unstubAllGlobals());

describe('una escala PW solo rotula su propia adquisición', () => {
  it('borra bitmap y trazado de otra PRF incluso con tiempo congelado, y los recupera al volver', () => {
    const s = setup();
    const before = structuredClone(s.columns);
    s.view.draw(s.sim, s.columns, 1, 3, null, s.capture);
    expect(s.offscreen.context.putImageData).toHaveBeenCalledTimes(2);
    expect(s.visible.context.save).toHaveBeenCalledTimes(1);
    s.offscreen.context.fillRect.mockClear();
    s.offscreen.context.putImageData.mockClear();
    s.visible.context.save.mockClear();
    s.pw.prfHz = 4000;
    s.view.draw(s.sim, s.columns, 1, 3, null, s.capture);
    expect(s.offscreen.context.fillRect).toHaveBeenCalledWith(0, 0, 400, 100);
    expect(s.offscreen.context.putImageData).not.toHaveBeenCalled();
    expect(s.visible.context.save).not.toHaveBeenCalled();
    s.pw.prfHz = 2000;
    s.view.draw(s.sim, s.columns, 1, 3, null, s.capture);
    expect(s.offscreen.context.putImageData).toHaveBeenCalledTimes(2);
    expect(s.visible.context.save).toHaveBeenCalledTimes(1);
    expect(s.columns).toEqual(before);
  });

  it('dibuja solo columnas compatibles al recibir un historial mixto', () => {
    const s = setup();
    s.pw.prfHz = 4000;
    s.view.draw(s.sim, [...s.columns, { ...s.columns[0], t: 0.95, prfHz: 4000 }], 1, 3);
    expect(s.offscreen.context.putImageData).toHaveBeenCalledTimes(1);
  });

  it('un ajuste de presentación no borra ni reacquiere la señal compatible', () => {
    const s = setup();
    s.view.draw(s.sim, s.columns, 1, 3);
    s.offscreen.context.putImageData.mockClear();
    s.pw.invert = true;
    s.pw.baselineShift = 0.2;
    s.view.draw(s.sim, s.columns, 1, 3);
    expect(s.offscreen.context.putImageData).toHaveBeenCalledTimes(2);
  });
});
