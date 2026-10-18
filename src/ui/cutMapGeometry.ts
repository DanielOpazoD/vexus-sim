import { lineDirection, type ProbeFrame, type Transducer } from '../probe/probe';
import type { Vec3 } from '../core/vec3';

/** Exact normalized beam directions, shared by all depth samples of a column. */
export function cutMapDirections(frame: ProbeFrame, transducer: Transducer, width: number): Vec3[] {
  return Array.from({ length: width }, (_, u) =>
    lineDirection(frame, -transducer.halfSector + (2 * transducer.halfSector * (u + 0.5)) / width),
  );
}

/** Same operation order as pointOnLine, with the direction already computed. */
export function cutMapPoint(center: Vec3, direction: Vec3, range: number): Vec3 {
  return [center[0] + direction[0] * range, center[1] + direction[1] * range, center[2] + direction[2] * range];
}
