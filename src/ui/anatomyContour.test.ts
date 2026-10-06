import { describe, expect, it } from 'vitest';
import { maskBoundary } from './anatomyContour';

describe('anatomical contour topology', () => {
  it('preserves inner lumens and disconnected pieces, without internal edges', () => {
    // A 3×3 ring and a disconnected cell: outer perimeter 12, lumen 4, island 4.
    const mask = new Uint8Array([1, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 0]);
    const edges = maskBoundary(mask, 5, 3);
    expect(edges).toHaveLength(20);
    const toGrid = edges.map((e) => e.map((v, i) => Math.round(v * (i % 2 ? 3 : 5))));
    expect(toGrid).toEqual(
      expect.arrayContaining([
        [1, 1, 2, 1],
        [1, 2, 2, 2],
        [1, 1, 1, 2],
        [2, 1, 2, 2],
        [4, 1, 5, 1],
        [4, 2, 5, 2],
        [4, 1, 4, 2],
        [5, 1, 5, 2],
      ]),
    );
    // Every boundary separates a selected cell from an unselected cell/outside.
    const on = (x: number, y: number) => x >= 0 && x < 5 && y >= 0 && y < 3 && !!mask[y * 5 + x];
    for (const [x0, y0, x1, _y1] of toGrid) {
      if (x0 === x1) expect(on(x0 - 1, y0)).not.toBe(on(x0, y0));
      else expect(on(x0, y0 - 1)).not.toBe(on(x0, y0));
    }
    expect(maskBoundary(new Uint8Array(15), 5, 3)).toEqual([]);
  });
});
