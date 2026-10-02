import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { encodeBMode } from '../../tools/fidelity/captureBMode';
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
});
