/** Conservative candidates inside the original tube-sphere domain; optional segment envelopes tighten membership. */
export const TUBE_GRID_PITCH_MM = 32;
export const TUBE_GRID_WIDTH = 256;
const MAX_TEXELS = TUBE_GRID_WIDTH * 2048;
// A conservative margin also covers shader float rounding at cell and sphere boundaries.
const PAD_MM = 1;
export type TubeSphere = readonly [number, number, number, number];
export type TubeBox = { min: readonly number[]; max: readonly number[] };
export interface TubeGrid {
  origin: [number, number, number];
  size: [number, number, number];
  data: Float32Array;
  height: number;
  pitch: number;
}

/**
 * Euclidean envelope of the current Float32 H0/H1/H4 tube header. The metric
 * distance is at least |delta| / stretch, and noise cannot exceed amp * radius.
 * Round only UP, for cache reuse; a changed reach must invalidate membership.
 */
export function tubeGridReach(header: ArrayLike<number>, maximumRadius: number, offset = 0): number {
  const ap = header[offset + 2],
    scale = header[offset + 3],
    wall = header[offset + 4];
  if (maximumRadius < 0 || scale < 0 || ap <= 0 || wall < 0) return NaN;
  const stretch = Math.max(1, ap, Math.pow(1 + header[offset + 16] ** 2 + header[offset + 17] ** 2 + header[offset + 18] ** 2, 0.25));
  const radius = maximumRadius * scale * (1 + Math.max(0, header[offset + 19]));
  // Portal wallThicknessMm is capped at 1.4 mm; other walls use H1.x.
  return Math.ceil(((radius + Math.max(1.4, wall)) * stretch) / 4) * 4;
}

/** Union of segment capsules, enclosed by boxes. Reads the exact packed GPU nodes. */
export function tubeGridRegions(nodes: ArrayLike<number>, firstFloat: number, count: number, reach: number): TubeBox[] {
  const result: TubeBox[] = [];
  if (
    !Number.isSafeInteger(count) ||
    count < 2 ||
    !Number.isSafeInteger(firstFloat) ||
    firstFloat < 0 ||
    !Number.isFinite(reach) ||
    reach < 0 ||
    firstFloat + 4 * count > nodes.length
  )
    return result;
  for (let segment = 0; segment < count - 1; segment++) {
    const a = firstFloat + segment * 4,
      b = a + 4;
    result.push({
      min: [0, 1, 2].map((k) => Math.min(nodes[a + k], nodes[b + k]) - reach),
      max: [0, 1, 2].map((k) => Math.max(nodes[a + k], nodes[b + k]) + reach),
    });
  }
  return result;
}

/** Cell headers are (first index, count); entries retain ascending compact tube order. */
export function buildTubeGrid(
  spheres: readonly TubeSphere[],
  regions?: readonly (readonly TubeBox[])[],
  pitch = TUBE_GRID_PITCH_MM,
): TubeGrid | null {
  if (!Number.isFinite(pitch) || pitch <= 0) return null;
  if (!spheres.length) return null;
  if (spheres.some((s) => !s.every((v) => Number.isFinite(v) && Math.abs(v) <= 32768) || s[3] < 0)) return null;
  if (
    regions &&
    (regions.length !== spheres.length ||
      regions.some(
        (list) =>
          !list.length ||
          list.some(
            (box) =>
              box.min.length !== 3 ||
              box.max.length !== 3 ||
              box.min.some(
                (v, k) =>
                  !Number.isFinite(v) ||
                  !Number.isFinite(box.max[k]) ||
                  Math.abs(v) > 32768 ||
                  Math.abs(box.max[k]) > 32768 ||
                  v > box.max[k],
              ),
          ),
      ))
  )
    return null;
  const origin = [0, 1, 2].map(
    (k) => Math.floor(Math.min(...spheres.map((s) => s[k] - s[3] - PAD_MM)) / pitch) * pitch,
  ) as TubeGrid['origin'];
  const size = [0, 1, 2].map(
    (k) => Math.floor((Math.max(...spheres.map((s) => s[k] + s[3] + PAD_MM)) - origin[k]) / pitch) + 1,
  ) as TubeGrid['size'];
  const cells = size[0] * size[1] * size[2];
  if (!Number.isSafeInteger(cells) || cells <= 0 || cells > MAX_TEXELS) return null;
  const bins = new Map<number, number[]>();
  let entries = 0;
  for (let t = 0; t < spheres.length; t++) {
    const visitedCells = new Set<number>();
    const sphere = spheres[t];
    const boxes = regions?.[t] ?? [{ min: [0, 1, 2].map((k) => sphere[k] - sphere[3]), max: [0, 1, 2].map((k) => sphere[k] + sphere[3]) }];
    for (const box of boxes) {
      const lo = origin.map((v, k) => Math.max(0, Math.floor((box.min[k] - PAD_MM - v) / pitch)));
      const hi = origin.map((v, k) => Math.min(size[k] - 1, Math.floor((box.max[k] + PAD_MM - v) / pitch)));
      for (let z = lo[2]; z <= hi[2]; z++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let x = lo[0]; x <= hi[0]; x++) {
            const i = x + size[0] * (y + size[1] * z);
            if (visitedCells.has(i)) continue;
            visitedCells.add(i);
            if (++entries + cells > MAX_TEXELS) return null;
            const bin = bins.get(i) ?? [];
            bin.push(t);
            bins.set(i, bin);
          }
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
  return { origin, size, data, height, pitch };
}
