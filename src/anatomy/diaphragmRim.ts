import { diaphragmSurfaceZ, torsoDepth, type Diaphragm, type Torso } from './primitives';
import type { Vec3 } from '../core/vec3';

/** Borde del diafragma existente en la pared corporal interna, en mm materiales.
 * Altura y profundidad usan los mismos campos que el clasificador acústico. */
export function diaphragmRim(phi: number, d: Diaphragm, torso: Torso, wallMm: number): Vec3 {
  const cy = torso.y0 ?? 0;
  const c = Math.cos(phi),
    s = Math.sin(phi);
  const point = (r: number): Vec3 => {
    const x = r * c,
      y = cy + r * s;
    return [x, y, diaphragmSurfaceZ(x, y, d, torso)];
  };
  const depth = (r: number): number => torsoDepth(point(r), torso) + wallMm;
  let lo = 0,
    hi = Math.max(torso.a, torso.b);
  if (depth(lo) >= 0) throw new Error('Diaphragm rim has no interior origin');
  for (let i = 0; i < 8 && depth(hi) < 0; i++) hi *= 2;
  if (!(depth(hi) >= 0)) throw new Error('Diaphragm rim has no body boundary');
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (depth(mid) > 0) hi = mid;
    else lo = mid;
  }
  return point((lo + hi) / 2);
}
