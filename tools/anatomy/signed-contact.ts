import type { Vec3 } from '../../src/core/vec3';

/** Diagnóstico de campos independientes; no pasa por la prioridad del clasificador. */
export function signedContactSamples(points: readonly Vec3[], field: (p: Vec3) => number) {
  if (points.length === 0) throw new Error('Contacto sin muestras');
  let minimum = Infinity;
  let witness: Vec3 = points[0];
  let negativeSamples = 0;
  let maximum = -Infinity;
  for (const point of points) {
    if (!point.every(Number.isFinite)) throw new Error('Muestra no finita');
    const value = field(point);
    if (!Number.isFinite(value)) throw new Error('Campo no finito');
    if (value < minimum) {
      minimum = value;
      witness = point;
    }
    maximum = Math.max(maximum, value);
    if (value < 0) negativeSamples++;
  }
  return {
    sampleCount: points.length,
    minimumSignedFieldMm: minimum,
    maximumSignedFieldMm: maximum,
    negativeSamples,
    witness,
    interpretation: negativeSamples ? 'sampled-penetration-witness' : 'inconclusive-no-sampled-penetration',
    globalMinimumCertified: false,
  };
}
