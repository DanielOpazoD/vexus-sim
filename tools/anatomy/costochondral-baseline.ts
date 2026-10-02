/** Campo CPU publicado sobre las muestras completas del banco offline; sin DOM/GPU/red.
 * Sólo datos derivados BodyParts3D/DBCLS CC BY4.0. No usar como medición del alumno.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bodyDepth, setReferenceBody } from '../../src/anatomy/referenceBody';
import { AnatomyScene } from '../../src/anatomy/scene';
import { sdRib } from '../../src/anatomy/primitives';
import { referenceCartilage } from '../../src/anatomy/referenceCartilage';
import { NORMAL_ADULT } from '../../src/cases';
import type { Vec3 } from '../../src/core/vec3';

type Samples = {
  format: string;
  sourceSha256: Record<string, string>;
  parts: {
    id: string;
    side: string;
    tissue: string;
    points: Vec3[];
    skinAnteriorY?: ([number, number] | null)[];
    contactBands: { maxExactSourceDistanceMm: number; sampleIndices: number[] }[];
  }[];
};
function summary(x: number[]) {
  if (!x.length || !x.every(Number.isFinite)) throw new Error('No hay muestras finitas para la estadística');
  const sorted = [...x].sort((a, b) => a - b);
  const p = (sorted.length - 1) * 0.95;
  const i = Math.floor(p);
  return {
    count: x.length,
    min: sorted[0],
    rms: Math.sqrt(x.reduce((s, d) => s + d * d, 0) / x.length),
    p95: sorted[i] + (sorted[Math.ceil(p)] - sorted[i]) * (p - i),
    max: sorted.at(-1),
  };
}
function fieldSummary(values: number[]) {
  const finiteField = values.filter((d) => d !== 1000);
  return {
    samples: values.length,
    farFieldSentinelSamples: values.length - finiteField.length,
    absoluteApproximateFieldExcludingSentinelMm: finiteField.length ? summary(finiteField.map(Math.abs)) : null,
  };
}
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Uso: tsx tools/anatomy/costochondral-baseline.ts puntos.json salida-nueva.json');
const samples = JSON.parse(readFileSync(input, 'utf8')) as Samples;
if (samples.format !== 'vexus-costochondral-oracle-v1' || samples.parts.length !== 4) throw new Error('Formato de oráculo inválido');
for (const part of samples.parts) {
  if (
    !['bone', 'cartilage'].includes(part.tissue) ||
    !['left', 'right'].includes(part.side) ||
    !part.points.length ||
    !part.points.every((p) => p.length === 3 && p.every(Number.isFinite))
  )
    throw new Error('Muestras inválidas');
  for (const band of part.contactBands)
    if (!band.sampleIndices.every((i) => Number.isInteger(i) && i >= 0 && i < part.points.length))
      throw new Error('Región de contacto inválida');
}
const bytes = readFileSync(resolve('src/anatomy/reference-body.bin'));
const body = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
setReferenceBody(body);
try {
  const scene = new AnatomyScene(NORMAL_ADULT);
  const bone = { ...scene.ribs[2], sourceCartilage: false };
  const rows = samples.parts.map((part) => {
    const boneField = part.points.map((p) => sdRib(p, bone, scene.torso, scene.spine).d);
    const cartilageField = part.points.map((p) => referenceCartilage(p).d);
    const own = part.tissue === 'bone' ? boneField : cartilageField;
    const other = part.tissue === 'bone' ? cartilageField : boneField;
    let bodyProfileComparison;
    if (part.skinAnteriorY) {
      if (part.skinAnteriorY.length !== part.points.length) throw new Error('Intersecciones cutáneas incompletas');
      const differences: number[] = [];
      for (let i = 0; i < part.points.length; i++) {
        const hits = part.skinAnteriorY[i];
        if (!hits) continue;
        if (hits.length !== 2 || !hits.every(Number.isFinite)) throw new Error('Intersecciones cutáneas inválidas');
        const p = part.points[i];
        let lo = -20,
          hi = 400;
        if (bodyDepth([p[0], lo, p[2]], body) >= 0 || bodyDepth([p[0], hi, p[2]], body) <= 0) throw new Error('Raíz cutánea no acotada');
        for (let k = 0; k < 48; k++) {
          const mid = (lo + hi) / 2;
          if (bodyDepth([p[0], mid, p[2]], body) > 0) hi = mid;
          else lo = mid;
        }
        differences.push((lo + hi) / 2 - hits[1]);
      }
      const depths = part.points.map((p) => bodyDepth(p, body));
      bodyProfileComparison = {
        runtimeFrontMinusOriginalOuterYmm: summary(differences),
        runtimeBodyFieldMm: summary(depths),
        runtimeSkinMm: scene.torso.skinMm,
        samplesWithinRuntimeRadialSkin: depths.filter((d) => d >= -scene.torso.skinMm && d <= 0).length,
        zClampingApplied: part.points.some((p) => p[2] < -160 || p[2] > 120),
      };
    }
    return {
      id: part.id,
      bodyProfileComparison,
      side: part.side,
      tissue: part.tissue,
      ownApproximateField: fieldSummary(own),
      contactBands: part.contactBands.map((b) => ({
        maxExactSourceDistanceMm: b.maxExactSourceDistanceMm,
        ownApproximateField: fieldSummary(b.sampleIndices.map((i) => own[i])),
        otherApproximateField: fieldSummary(b.sampleIndices.map((i) => other[i])),
      })),
    };
  });
  writeFileSync(
    output,
    JSON.stringify(
      {
        method:
          'Published CPU fields on all original used vertices/face centroids and complete sampled bilateral contact bands. Approximate field values are not exact Euclidean distances.',
        runtimeChanged: false,
        sourceSha256: samples.sourceSha256,
        rows,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
} finally {
  setReferenceBody();
}
