import { dot, smoothstep, type Vec3 } from '../core/vec3';
import { warpAt, type ProbeCompression, type Warp } from './compression';
import { torsoDepth, torsoDepthGradient } from './primitives';
import { s0028RespiratoryRamp, s0028WallFaceGradient } from './s0028Wall';
import { RESPIRATORY_DIRECTION as DIR } from './respiratoryDirection';
import type { AnatomyScene } from './scene';

/** Derivada analítica del mismo peso, fuera de las uniones no diferenciables del perfil torácico. @twin deformacion */
export function respiratoryWeightGradient(scene: AnatomyScene, m: Vec3): Vec3 {
  const s0028 = scene.identity.person === 's0028' ? s0028WallFaceGradient(m, 2) : undefined;
  // s0028 U: sin cara interna; el peso es la rampa por profundidad de su fila, smoothstep(p10, p90, −τ), y ∇ = −∇τ.
  const ramp = s0028 === null ? s0028RespiratoryRamp(m) : null;
  if (s0028 === null && ramp === null) return [0, 0, 0];
  const [lo, hi] = ramp ? [ramp.d0, ramp.d1] : [0, 25];
  const inside = ramp ? ramp.x : s0028 ? s0028.sd : -torsoDepth(m, scene.torso) - scene.wallThickness();
  const dx = m[0] - scene.spine.x0,
    dy = m[1] - scene.spine.y0;
  const r = Math.hypot(dx, dy);
  const wall = smoothstep(lo, hi, inside);
  const spine = smoothstep(scene.spine.r + 5, scene.spine.r + 35, r);
  const slope = (a: number, b: number, x: number): number => {
    const u = (x - a) / (b - a);
    return u > 0 && u < 1 ? (6 * u * (1 - u)) / (b - a) : 0;
  };
  const a = -spine * slope(lo, hi, inside);
  const b = (wall * slope(scene.spine.r + 5, scene.spine.r + 35, r)) / Math.max(r, 1e-9);
  if (a === 0) return [b * dx, b * dy, 0];
  // ∇inside: −∇τ en el tronco genérico y en la rampa U; en una celda D/E, el gradiente analítico de la cara interna.
  const g: Vec3 = s0028 ? [-s0028.gradient[0], -s0028.gradient[1], -s0028.gradient[2]] : torsoDepthGradient(m, scene.torso);
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
