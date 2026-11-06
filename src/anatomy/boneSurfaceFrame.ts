/** @twin atlas-toracico */
import type { Vec3 } from '../core/vec3';
import { THORACIC_ATLAS as F } from './thoracicAtlasData';
/** @twin atlas-toracico */
export function boneSurfaceFrame(p: Vec3, distance: (p: Vec3) => number): { axis: Vec3; curvature: number } {
  const g = [0, 1, 2].map((i) => {
      const a: Vec3 = [...p],
        b: Vec3 = [...p];
      a[i] += 0.25;
      b[i] -= 0.25;
      return (distance(a) - distance(b)) / 0.5;
    }) as Vec3,
    norm = Math.hypot(...g),
    n = g.map((v) => v / (norm || 1)) as Vec3;
  if (norm < 1e-6) return { axis: [0, 0, 1], curvature: 0 };
  const u: Vec3 = Math.abs(n[2]) < 0.9 ? [-n[1], n[0], 0] : [0, -n[2], n[1]];
  const l = Math.hypot(...u);
  u.forEach((v, i) => (u[i] = v / (l || 1)));
  const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const h = 2 * F.pitchMm,
    at = (a: number, b: number) => distance(p.map((x, i) => x + h * (a * u[i] + b * v[i])) as Vec3),
    d = at(0, 0);
  const a = (at(1, 0) + at(-1, 0) - 2 * d) / (h * h),
    c = (at(0, 1) + at(0, -1) - 2 * d) / (h * h),
    b = (at(1, 1) - at(1, -1) - at(-1, 1) + at(-1, -1)) / (4 * h * h);
  const theta = 0.5 * Math.atan2(2 * b, a - c),
    co = Math.cos(theta),
    si = Math.sin(theta);
  const hi = 0.5 * (a + c + Math.hypot(a - c, 2 * b)),
    lo = 0.5 * (a + c - Math.hypot(a - c, 2 * b)),
    high = Math.abs(hi) < Math.abs(lo);
  return {
    axis: u.map((x, i) => (high ? co * x + si * v[i] : -si * x + co * v[i])) as Vec3,
    curvature: Math.max(Math.abs(lo), Math.abs(hi)) / (norm || 1),
  };
}
