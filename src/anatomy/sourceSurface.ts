import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import type { PersonField } from './anatomyBundle';
import { HALF } from './halfFloat';
const corners = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const edges = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];
export interface SourceSurface {
  name: string;
  asset: 'abdominal' | 'thoracic';
  positions: Float32Array;
  maxBlockMs: number;
}
/** Zero of the original trilinear lattice. No resampling, fixed triangle buffer or cubic normal caches. Worker only. */
export async function sourceSurface(data: Uint16Array, f: PersonField, texture: readonly number[]): Promise<SourceSurface> {
  const d = f.dimensions,
    chunks: Float32Array[] = [];
  const values = new Float64Array(8),
    vertices = new Float64Array(36);
  let length = 0,
    maxBlockMs = 0;
  for (let bz = 0; bz < d[2] - 1; bz += 32)
    for (let by = 0; by < d[1] - 1; by += 32)
      for (let bx = 0; bx < d[0] - 1; bx += 32) {
        const begin = performance.now(),
          nx = Math.min(32, d[0] - 1 - bx),
          ny = Math.min(32, d[1] - 1 - by),
          nz = Math.min(32, d[2] - 1 - bz);
        const positions = new Float32Array(nx * ny * nz * 5 * 9);
        let count = 0;
        for (let z = bz; z < bz + nz; z++)
          for (let y = by; y < by + ny; y++)
            for (let x = bx; x < bx + nx; x++) {
              let cube = 0;
              for (let c = 0; c < 8; c++) {
                const v = corners[c];
                values[c] =
                  HALF[data[2 * (x + v[0] + f.offset[0] + texture[0] * (y + v[1] + f.offset[1] + texture[1] * (z + v[2] + f.offset[2])))]];
                if (values[c] < 0) cube |= 1 << c;
              }
              const mask = edgeTable[cube];
              if (mask === 0) continue;
              for (let e = 0; e < 12; e++)
                if (mask & (1 << e)) {
                  const [a, b] = edges[e],
                    t = -values[a] / (values[b] - values[a]);
                  for (let axis = 0; axis < 3; axis++)
                    vertices[3 * e + axis] =
                      ([x, y, z][axis] + corners[a][axis] + t * (corners[b][axis] - corners[a][axis])) * f.pitchMm + f.originMm[axis];
                }
              for (let k = 0; k < 16 && triTable[cube * 16 + k] !== -1; k++)
                for (let a = 0; a < 3; a++) positions[count++] = vertices[3 * triTable[cube * 16 + k] + a];
            }
        if (count > positions.length) throw new Error('Malla truncada');
        if (count) chunks.push(positions.slice(0, count));
        length += count;
        maxBlockMs = Math.max(maxBlockMs, performance.now() - begin);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
  const positions = new Float32Array(length);
  let off = 0;
  for (const chunk of chunks) {
    positions.set(chunk, off);
    off += chunk.length;
  }
  return { name: f.name, asset: f.asset, positions, maxBlockMs };
}
