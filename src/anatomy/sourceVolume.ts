import type { Vec3 } from '../core/vec3';
import { HALF } from './halfFloat';

/** A fixed RG16F brick: R is distance, G categorical identity, in the common material frame. */
export interface SourceVolume {
  readonly originMm: readonly number[];
  readonly dimensions: readonly number[];
  readonly offset: readonly number[];
  readonly pitchMm: number;
}

/** Trilinear interpolation of the same eight nodes as the GPU reader; no per-query arrays or closures. */
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
  const mx = 1 - tx,
    my = 1 - ty,
    mz = 1 - tz;
  // Same eight products and summation order as the former z/y/x loops.
  // Keep float64 arithmetic and its boundary signs; remove only loop/branch work.
  d += HALF[data[base]] * mx * my * mz;
  d += HALF[data[base + 2]] * tx * my * mz;
  d += HALF[data[base + sy]] * mx * ty * mz;
  d += HALF[data[base + sy + 2]] * tx * ty * mz;
  d += HALF[data[base + sz]] * mx * my * tz;
  d += HALF[data[base + sz + 2]] * tx * my * tz;
  d += HALF[data[base + sz + sy]] * mx * ty * tz;
  d += HALF[data[base + sz + sy + 2]] * tx * ty * tz;
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

/** Interpolación de los mismos ocho nodos RG16F en alta precisión del shader.
 * El filtrado fijo cuantiza pesos y puede cambiar el signo junto a una superficie (223).
 * Usar cerca de las interfaces óseas; no altera la rejilla ni el campo fuente. */
export const SOURCE_DISTANCE_GLSL = /* glsl */ `
#define SOURCE_NODE(x,y,z) texelFetch(field,a+off+ivec3(x,y,z),0).r
float sourceDistancePrecise(highp sampler3D field, vec3 q, ivec3 dim, ivec3 off) {
  ivec3 a = min(ivec3(floor(q)), dim - 2);
  vec3 t = q - vec3(a);
  vec4 lo = vec4(SOURCE_NODE(0,0,0), SOURCE_NODE(1,0,0), SOURCE_NODE(0,1,0), SOURCE_NODE(1,1,0));
  vec4 hi = vec4(SOURCE_NODE(0,0,1), SOURCE_NODE(1,0,1), SOURCE_NODE(0,1,1), SOURCE_NODE(1,1,1));
  vec2 u = mix(lo.xz, lo.yw, t.x), v = mix(hi.xz, hi.yw, t.x);
  return mix(mix(u.x, u.y, t.y), mix(v.x, v.y, t.y), t.z);
}
#undef SOURCE_NODE
`;
