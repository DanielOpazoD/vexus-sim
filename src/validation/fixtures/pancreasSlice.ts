import type { ProbePose } from '../../probe/probe';

/** Adquisición de prueba en el mismo plano mundo anterior a 282.
 * Reexpresada tras el ensanche parietal 285. Dato fuera de línea; no dirige la sonda en producción ni consulta órganos. */
export const PANCREAS_SLICE_POSE = {
  phi: 1.23,
  z: -115.23328370178814,
  yaw: -1.5211036781192486,
  rock: 0.4845642019534145,
  tilt: -0.15298979301373036,
  lift: 0,
} satisfies ProbePose;
