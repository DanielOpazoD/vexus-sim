import { describe, expect, it, vi } from 'vitest';
import { drawVenousSpectrum } from '../ui/venousSpectralPlot';
import type { SpectralColumn } from '../doppler/spectral';

function paint(columns: readonly SpectralColumn[], invert: boolean) {
  let bitmap: { data: Uint8ClampedArray; width: number; height: number };
  const ctx = {
    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
    putImageData: (image: typeof bitmap) => {
      bitmap = image;
    },
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 10 }),
    setLineDash: vi.fn(),
  };
  const canvas = { width: 90, height: 280, getContext: () => ctx } as unknown as HTMLCanvasElement;
  drawVenousSpectrum(canvas, columns, 0, 1, 50, [{ t: 0.5, vScreen: 25, label: 'S' }], null, 1, 0, undefined, invert);
  return { bitmap: bitmap!, labels: ctx.fillText.mock.calls };
}

describe('INV del espectro PW: transformación de presentación', () => {
  it('refleja potencia y marcas respecto del cero, sin alterar columnas ni intensidades', () => {
    const columns: SpectralColumn[] = [{ t: 0.5, prfHz: 3200, powerDb: Float32Array.from({ length: 128 }, (_, k) => -65 + k / 2) }];
    const before = structuredClone(columns);
    const normal = paint(columns, false),
      inverted = paint(columns, true);
    const { width, height } = normal.bitmap;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4,
          mirror = ((height - 1 - y) * width + x) * 4;
        expect(inverted.bitmap.data[at]).toBe(normal.bitmap.data[mirror]);
      }
    const normalMark = normal.labels.find(([label]) => label === 'S')!;
    const invertedMark = inverted.labels.find(([label]) => label === 'S')!;
    expect(normalMark[1]).toBe(invertedMark[1]);
    expect(normalMark[2] + invertedMark[2]).toBe(height - 10);
    expect(columns).toEqual(before);
    expect(paint(columns, false).bitmap.data).toEqual(normal.bitmap.data);
  });
});
