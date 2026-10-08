import type { Vec3 } from '../core/vec3';
import { HALF } from './halfFloat';

/** A fixed RG16F brick: R is distance, G categorical identity, in the common material frame. */
export interface SourceVolume {
  readonly originMm: readonly number[];
  readonly dimensions: readonly number[];
  readonly offset: readonly number[];
  readonly pitchMm: number;
}

/** Same eight nodes and x/y/z summation order as the GPU reader; no per-query arrays or closures. */
export function sourceDistance(data: Uint16Array, p: Vec3, f: SourceVolume, textureDimensions: readonly number[]): number {
  const qx = (p[0] - f.originMm[0]) / f.pitchMm,
    qy = (p[1] - f.originMm[1]) / f.pitchMm,
    qz = (p[2] - f.originMm[2]) / f.pitchMm;
  if (qx < 0 || qy < 0 || qz < 0 || qx > f.dimensions[0] - 1 || qy > f.dimensions[1] - 1 || qz > f.dimensions[2] - 1) return 16;
  const ax = Math.min(f.dimensions[0] - 2, Math.floor(qx)),
    ay = Math.min(f.dimensions[1] - 2, Math.floor(qy)),
    az = Math.min(f.dimensions[2] - 2, Math.floor(qz)),
    tx = qx - ax,
    ty = qy - ay,
    tz = qz - az,
    sy = 2 * textureDimensions[0],
    sz = sy * textureDimensions[1],
    base = (az + f.offset[2]) * sz + (ay + f.offset[1]) * sy + 2 * (ax + f.offset[0]);
  let d = 0;
  for (let z = 0; z <= 1; z++)
    for (let y = 0; y <= 1; y++)
      for (let x = 0; x <= 1; x++)
        d += HALF[data[base + z * sz + y * sy + 2 * x]] * (x ? tx : 1 - tx) * (y ? ty : 1 - ty) * (z ? tz : 1 - tz);
  return d;
}

/** Nearest label only when identity is requested; a clipped distance16 is still inside the brick. */
export function sourceLabel(data: Uint16Array, p: Vec3, f: SourceVolume, textureDimensions: readonly number[]): number {
  const qx = (p[0] - f.originMm[0]) / f.pitchMm,
    qy = (p[1] - f.originMm[1]) / f.pitchMm,
    qz = (p[2] - f.originMm[2]) / f.pitchMm;
  if (qx < 0 || qy < 0 || qz < 0 || qx > f.dimensions[0] - 1 || qy > f.dimensions[1] - 1 || qz > f.dimensions[2] - 1) return 0;
  const [w, h] = textureDimensions;
  return HALF[data[2 * ((Math.round(qz) + f.offset[2]) * w * h + (Math.round(qy) + f.offset[1]) * w + Math.round(qx) + f.offset[0]) + 1]];
}
