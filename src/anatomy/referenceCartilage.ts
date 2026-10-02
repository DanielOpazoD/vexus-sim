import type { Vec3 } from '../core/vec3';
import { CARTILAGE_ROWS, CARTILAGE_X0, CARTILAGE_X1 } from './referenceCartilageData';

/** Measured seventh-cartilage sections in the common mm/LAS frame; bilateral average.
 * Elliptical section/interpolation error is quantified in reference-cartilage-source.json. */
export function referenceCartilage(p: Vec3): { d: number; tangent: Vec3; curvature: number } {
  const x = -Math.abs(p[0]);
  const step = (CARTILAGE_X1 - CARTILAGE_X0) / (CARTILAGE_ROWS.length - 1);
  const u = Math.max(0, Math.min(CARTILAGE_ROWS.length - 1, (x - CARTILAGE_X0) / step));
  const i = Math.min(CARTILAGE_ROWS.length - 2, Math.floor(u));
  const a = CARTILAGE_ROWS[i],
    b = CARTILAGE_ROWS[i + 1];
  const q = a.map((v, k) => v + (b[k] - v) * (u - i));
  const dy = p[1] - q[0],
    dz = p[2] - q[1];
  const rho = Math.hypot(dy / q[2], dz / q[3]);
  const d = Math.max((rho - 1) * Math.min(q[2], q[3]), CARTILAGE_X0 - x, x - CARTILAGE_X1);
  const tangent: Vec3 = [p[0] > 0 ? -step : step, b[0] - a[0], b[1] - a[1]];
  const l = Math.hypot(...tangent);
  const c = rho > 0 ? dy / q[2] / rho : 1,
    s = rho > 0 ? dz / q[3] / rho : 0;
  return {
    d,
    tangent: tangent.map((v) => v / l) as Vec3,
    curvature: (q[2] * q[3]) / Math.pow(q[2] * q[2] * s * s + q[3] * q[3] * c * c, 1.5),
  };
}
