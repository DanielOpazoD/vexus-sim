import type { Vec3 } from '../../core/vec3';
import { torsoDepth, type Torso } from '../primitives';

/**
 * Primer registro esternal acústico, decisión 166. Dimensiones ESTIMADAS, adaptadas de lus-sim
 * 7a7def6 (MIT), organs/ribcage.ts: no medidas del adulto VExUS ni tolerancias clínicas.
 * Decisión 167: z=0 punta xifoidea del marco VExUS; unión z=18,2615 del landmark
 * BodyParts3D ya registrado (REFERENCE_TORSO.md). El resto sigue estimado, sin ajuste 3D nuevo.
 */
export const STERNUM = {
  zTopMm: 163.33333333333334,
  zAngleMm: 116.66666666666667,
  zTipMm: 0,
  zJunctionMm: 18.2615,
  manubriumHalfWidthMm: 27,
  bodyHalfWidthMm: 14,
  xiphoidHalfWidthMm: 8,
  thicknessMm: 12,
  ribScale: 0.85,
} as const;

export function sternumHalfWidth(z: number): number {
  if (z < STERNUM.zJunctionMm)
    return STERNUM.xiphoidHalfWidthMm * Math.max(0, Math.min(1, (z - STERNUM.zTipMm) / (STERNUM.zJunctionMm - STERNUM.zTipMm)));
  const t = Math.max(0, Math.min(1, (z - STERNUM.zAngleMm) / (STERNUM.zTopMm - STERNUM.zAngleMm)));
  return STERNUM.bodyHalfWidthMm + t * (STERNUM.manubriumHalfWidthMm - STERNUM.bodyHalfWidthMm);
}

/** Campo de caja en profundidad cutánea; no extrapolar un esternón por detrás del tronco. */
export function sternumSd(m: Vec3, torso: Torso): number {
  if (m[1] <= (torso.y0 ?? 0)) return 1e3;
  const q = [
    Math.abs(m[0]) - sternumHalfWidth(m[2]),
    Math.abs(-torsoDepth(m, torso) - (1 - STERNUM.ribScale) * torso.b) - STERNUM.thicknessMm / 2,
    Math.max(STERNUM.zTipMm - m[2], m[2] - STERNUM.zTopMm),
  ];
  return Math.hypot(...q.map((v) => Math.max(v, 0))) + Math.min(Math.max(...q), 0);
}

export const STERNUM_GLSL = /* glsl */ `
#define STERNUM_JUNCTION ${STERNUM.zJunctionMm.toFixed(8)}
float sternumHalfWidth(float z) {
  if (z < STERNUM_JUNCTION) return ${STERNUM.xiphoidHalfWidthMm.toFixed(4)} * clamp((z - ${STERNUM.zTipMm.toFixed(4)}) / ${(STERNUM.zJunctionMm - STERNUM.zTipMm).toFixed(8)}, 0.0, 1.0);
  float t = clamp((z - ${STERNUM.zAngleMm.toFixed(8)}) / ${(STERNUM.zTopMm - STERNUM.zAngleMm).toFixed(8)}, 0.0, 1.0);
  return ${STERNUM.bodyHalfWidthMm.toFixed(4)} + t * ${(STERNUM.manubriumHalfWidthMm - STERNUM.bodyHalfWidthMm).toFixed(4)};
}
float sternumSd(vec3 m) {
  if (m.y <= uTorsoY) return 1e3;
  vec3 q = vec3(abs(m.x) - sternumHalfWidth(m.z),
    abs(-torsoDepth(m) - ${(1 - STERNUM.ribScale).toFixed(8)} * uTorso.y) - ${(STERNUM.thicknessMm / 2).toFixed(4)},
    max(${STERNUM.zTipMm.toFixed(4)} - m.z, m.z - ${STERNUM.zTopMm.toFixed(8)}));
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
`;
