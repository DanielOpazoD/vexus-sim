/** Conservative index of the SAME bounding spheres used by the GPU tube loop. */
export const TUBE_GRID_PITCH_MM = 32;
export const TUBE_GRID_WIDTH = 256;
const MAX_TEXELS = TUBE_GRID_WIDTH * 2048;
// A conservative margin also covers shader float rounding at cell and sphere boundaries.
const PAD_MM = 1;
export type TubeSphere = readonly [number, number, number, number];
export interface TubeGrid {
  origin: [number, number, number];
  size: [number, number, number];
  data: Float32Array;
  height: number;
}

/** Cell headers are (first index, count); entries retain ascending compact tube order. */
export function buildTubeGrid(spheres: readonly TubeSphere[]): TubeGrid | null {
  if (!spheres.length) return null;
  if (spheres.some((s) => !s.every((v) => Number.isFinite(v) && Math.abs(v) <= 32768) || s[3] < 0)) return null;
  const origin = [0, 1, 2].map(
    (k) => Math.floor(Math.min(...spheres.map((s) => s[k] - s[3] - PAD_MM)) / TUBE_GRID_PITCH_MM) * TUBE_GRID_PITCH_MM,
  ) as TubeGrid['origin'];
  const size = [0, 1, 2].map(
    (k) => Math.floor((Math.max(...spheres.map((s) => s[k] + s[3] + PAD_MM)) - origin[k]) / TUBE_GRID_PITCH_MM) + 1,
  ) as TubeGrid['size'];
  const cells = size[0] * size[1] * size[2];
  if (!Number.isSafeInteger(cells) || cells <= 0 || cells > MAX_TEXELS) return null;
  const bins = new Map<number, number[]>();
  let entries = 0;
  for (let t = 0; t < spheres.length; t++) {
    const s = spheres[t];
    const lo = origin.map((v, k) => Math.floor((s[k] - s[3] - PAD_MM - v) / TUBE_GRID_PITCH_MM));
    const hi = origin.map((v, k) => Math.floor((s[k] + s[3] + PAD_MM - v) / TUBE_GRID_PITCH_MM));
    for (let z = lo[2]; z <= hi[2]; z++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let x = lo[0]; x <= hi[0]; x++) {
          if (++entries + cells > MAX_TEXELS) return null;
          const i = x + size[0] * (y + size[1] * z);
          const bin = bins.get(i) ?? [];
          bin.push(t);
          bins.set(i, bin);
        }
  }
  const height = Math.ceil((cells + entries) / TUBE_GRID_WIDTH);
  const data = new Float32Array(TUBE_GRID_WIDTH * height * 2);
  let next = cells;
  for (const [cell, bin] of bins) {
    data[cell * 2] = next;
    data[cell * 2 + 1] = bin.length;
    for (const t of bin) data[next++ * 2] = t;
  }
  return { origin, size, data, height };
}
