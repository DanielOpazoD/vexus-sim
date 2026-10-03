import { dot, smoothstep, type Vec3 } from '../core/vec3';
import { warpAt, type ProbeCompression, type Warp } from './compression';
import { torsoDepth, torsoDepthGradient } from './primitives';
import { RESPIRATORY_DIRECTION as DIR } from './respiratoryDirection';
import type { AnatomyScene } from './scene';

/** Derivada analítica del mismo peso, fuera de las uniones no diferenciables del perfil torácico. */
export function respiratoryWeightGradient(scene: AnatomyScene, m: Vec3): Vec3 {
  const inside = -torsoDepth(m, scene.torso) - scene.wallThickness();
  const dx = m[0] - scene.spine.x0,
    dy = m[1] - scene.spine.y0;
  const r = Math.hypot(dx, dy);
  const wall = smoothstep(0, 25, inside);
  const spine = smoothstep(scene.spine.r + 5, scene.spine.r + 35, r);
  const slope = (a: number, b: number, x: number): number => {
    const u = (x - a) / (b - a);
    return u > 0 && u < 1 ? (6 * u * (1 - u)) / (b - a) : 0;
  };
  const a = -spine * slope(0, 25, inside);
  const b = (wall * slope(scene.spine.r + 5, scene.spine.r + 35, r)) / Math.max(r, 1e-9);
  if (a === 0) return [b * dx, b * dy, 0];
  const g = torsoDepthGradient(m, scene.torso);
  return [a * g[0] + b * dx, a * g[1] + b * dy, a * g[2]];
}

/** Inverse-transpose order: respiratory covector first, then probe compression. */
export function anatomyWarpAt(scene: AnatomyScene, p: Vec3, m: Vec3, displacementMm: number, compression: ProbeCompression | null): Warp {
  const w = warpAt(p, compression);
  if (displacementMm === 0) return w;
  const g = respiratoryWeightGradient(scene, m);
  const factor = displacementMm / (1 + displacementMm * dot(DIR, g));
  return { ...w, respiratory: [factor * g[0], factor * g[1], factor * g[2]] };
}
