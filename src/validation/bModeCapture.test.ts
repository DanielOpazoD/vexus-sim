import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { captureBMode, encodeBMode } from '../../tools/fidelity/captureBMode';
const { PNG } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle') as {
  PNG: { sync: { read: (data: Buffer) => { width: number; height: number; data: Buffer } } };
};
describe('captura B-mode sin transformaciones de imagen', () => {
  it('conserva los bytes y orden de filas; alfa opaco sin interpolación ni normalización', () => {
    const gray = [0, 1, 64, 127, 254, 255];
    const image = PNG.sync.read(encodeBMode(3, 2, gray));
    expect([image.width, image.height]).toEqual([3, 2]);
    expect(Array.from(image.data)).toEqual(gray.flatMap((x) => [x, x, x, 255]));
  });
  it('rechaza matrices incompletas o valores alterados', () => {
    expect(() => encodeBMode(3, 2, [0])).toThrow();
    expect(() => encodeBMode(0, 2, [])).toThrow();
    for (const v of [NaN, -1, 256, 1.5]) expect(() => encodeBMode(1, 1, [v])).toThrow();
  });
  it('transporta todos los grises entre bloques sin alterar ni una muestra', async () => {
    const width = 257,
      height = 257,
      gray = Uint8Array.from({ length: width * height }, (_, i) => (i * 71) % 256);
    const dir = mkdtempSync(join(tmpdir(), 'vexus-bmode-'));
    vi.stubGlobal('window', {
      __vexusTest: { sim: () => ({ frozen: true, color: { enabled: false }, renderer: { readDisplay: () => ({ width, height, gray }) } }) },
    });
    const page = { evaluate: (fn: () => unknown) => Promise.resolve(fn()) } as unknown as Page;
    try {
      const path = join(dir, 'capture.png');
      await captureBMode(page, path);
      expect(readFileSync(path)).toEqual(encodeBMode(width, height, gray));
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true });
    }
  });
});
