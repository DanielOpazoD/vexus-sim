import type { Vec3 } from '../core/vec3';

/** Caudal y ligeramente anterior; compartida por desplazamiento y transporte de normales. */
export const RESPIRATORY_DIRECTION: Vec3 = [0, 0.15 / Math.hypot(0.15, 1), -1 / Math.hypot(0.15, 1)];
