import { FACE_GRADIENT_EPS_MM } from '../anatomy/interfaces';

/** Reúne diferencias GPU por eje; conserva la normal analítica y el fallback de faceGradient. */
export function assembleQueryGradient(axes: readonly Float32Array[], fallback: Float32Array): Float32Array {
  const result = axes[0].slice();
  for (let i = 0; i < result.length; i += 4) {
    if (result[i + 3] >= 0) continue;
    const difference = axes.map((a) => a[i]);
    const length = Math.hypot(...difference);
    const g = length > 0 ? difference : Array.from(fallback.subarray(i, i + 3));
    const norm = Math.hypot(...g);
    result.set(norm > 0 ? g.map((v) => v / norm) : [0, 1, 0], i);
    result[i + 3] = length > 0 ? length / (2 * FACE_GRADIENT_EPS_MM) : 1;
  }
  return result;
}
