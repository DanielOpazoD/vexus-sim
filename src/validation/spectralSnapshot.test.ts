import { afterEach, expect, it, vi } from 'vitest';
import { spectralSnapshot } from '../../e2e/spectralSnapshot';

afterEach(() => vi.unstubAllGlobals());
function sample(baseline: number | null, glyphRow: number) {
  const width = 200,
    height = 184;
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (x: number, y: number) => data.set([239, 220, 114, 255], (y * width + x) * 4);
  if (baseline !== null) for (let x = 0; x < width - 58; x++) paint(x, baseline);
  for (let x = 8; x < 16; x++) paint(x, glyphRow);
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data }) }) }) });
  return spectralSnapshot([{ width, height, dataset: { columns: '100', lastTime: '6', marks: 'S,D' } } as unknown as Element])[0];
}
it('ignores moving annotation pixels while measuring the actual horizontal baseline', () => {
  const a = sample(80, 140),
    b = sample(80, 130);
  expect(a.zeroY).toBe(80);
  expect(b.zeroY).toBe(80);
  expect(a.hash).not.toBe(b.hash);
  expect(a.columns).toBe('100');
});
it('detects baseline displacement and absence instead of assuming the center', () => {
  expect(sample(112, 140).zeroY).toBe(112);
  expect(sample(null, 140).zeroY).toBeNull();
});
