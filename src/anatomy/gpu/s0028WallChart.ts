import { HALF } from '../halfFloat';
import { s0028WallChart } from '../s0028Wall';

/** 16 tiles de tres páginas: XY alta/baja + normal octaédrica; misma rejilla 512×181. */
export const S0028_CHART_SIZE = [65, 91, 3] as const;
export const S0028_CHART_OFFSETS = Array.from({ length: 16 }, (_, tile) => [65, 0, 619 + 3 * tile]);
export const S0028_CHART_BYTES = 16 * 65 * 91 * 3 * 4;

function half(value: number): number {
  const a = Math.abs(value),
    sign = value < 0 ? 0x8000 : 0;
  if (a < 2 ** -14) return sign | Math.round(a * 2 ** 24);
  let exponent = Math.floor(Math.log2(a)),
    mantissa = Math.round(a * 2 ** (10 - exponent));
  if (mantissa === 2048) {
    exponent++;
    mantissa = 1024;
  }
  return sign | ((exponent + 15) << 10) | (mantissa - 1024);
}

/** Derivado transitorio ≤1,14 MB. No cambia payload, atlas, mallas ni capacidad RAW. */
export function s0028ChartUploads() {
  const nodes = s0028WallChart(),
    words = 65 * 91 * 3 * 2;
  const packed = new Uint16Array(S0028_CHART_BYTES / 2);
  for (let tile = 0; tile < 16; tile++)
    for (let row = 0; row < 91; row++)
      for (let col = 0; col < 65; col++) {
        const k = ((Math.floor(tile / 8) * 90 + row) * 512 + (((tile % 8) * 64 + col) % 512)) * 6;
        const at = tile * words + (row * 65 + col) * 2,
          page = 65 * 91 * 2;
        for (let axis = 0; axis < 2; axis++) {
          const hi = half(nodes[k + axis]);
          packed[at + axis] = hi;
          packed[at + page + axis] = half(nodes[k + axis] - HALF[hi]);
        }
        const length = Math.abs(nodes[k + 3]) + Math.abs(nodes[k + 4]) + Math.abs(nodes[k + 5]) || 1;
        let x = nodes[k + 3] / length,
          y = nodes[k + 4] / length;
        if (nodes[k + 5] < 0) [x, y] = [(1 - Math.abs(y)) * (x >= 0 ? 1 : -1), (1 - Math.abs(x)) * (y >= 0 ? 1 : -1)];
        packed[at + 2 * page] = half(x);
        packed[at + 2 * page + 1] = half(y);
      }
  return S0028_CHART_OFFSETS.map((offset, tile) => ({
    offset,
    size: S0028_CHART_SIZE,
    data: packed.subarray(tile * words, (tile + 1) * words),
  }));
}
