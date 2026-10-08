/** Offline paired source-reader audit. Does not loosen UI/CI deadlines or certify anatomy. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus, platform, arch } from 'node:os';
import type { Vec3 } from '../../src/core/vec3';
import { START_POINTS, startPointsFor } from '../../src/app/startPoints';
import { CONVEX_C35, probeFrame, pointOnLine } from '../../src/probe/probe';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../../src/cases';

const [beforeArg, afterArg, output] = process.argv.slice(2);
if (!beforeArg || !afterArg || !output) throw new Error('Usage: atlasQueryAudit.ts BASELINE_CHECKOUT CANDIDATE_CHECKOUT OUTPUT.json');
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
async function load(repo: string) {
  const root = resolve(repo);
  const module = <T>(p: string) => import(pathToFileURL(`${root}/src/${p}.ts`).href) as Promise<T>;
  const reader = await module<typeof import('../../src/anatomy/abdominalAtlas')>('anatomy/abdominalAtlas');
  const thoracic = await module<typeof import('../../src/anatomy/thoracicAtlas')>('anatomy/thoracicAtlas');
  const body = await module<typeof import('../../src/anatomy/referenceBody')>('anatomy/referenceBody');
  const anatomy = await module<typeof import('../../src/anatomy/scene')>('anatomy/scene');
  const meta = await module<typeof import('../../src/anatomy/abdominalAtlasData')>('anatomy/abdominalAtlasData');
  const tmeta = await module<typeof import('../../src/anatomy/thoracicAtlasData')>('anatomy/thoracicAtlasData');
  const sources: Record<string, string> = {};
  for (const [name, setter] of [
    ['abdominal-atlas.gzip.bin', reader.setAbdominalAtlas],
    ['thoracic-atlas.gzip.bin', thoracic.setThoracicAtlas],
  ] as const) {
    const packed = readFileSync(`${root}/src/anatomy/${name}`),
      raw = gunzipSync(packed);
    sources[name] = sha(packed);
    setter(new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  }
  const profile = readFileSync(`${root}/src/anatomy/abdominal-body.bin`);
  body.setAbdominalBody(new Float32Array(profile.buffer.slice(profile.byteOffset, profile.byteOffset + profile.byteLength)));
  for (const name of ['abdominal-body.bin', 'abdominal-surface.gzip.bin', 'thoracic-surface.gzip.bin'])
    sources[name] = sha(readFileSync(`${root}/src/anatomy/${name}`));
  return {
    root,
    reader,
    thoracic,
    anatomy,
    meta,
    tmeta,
    sources,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    diff: execFileSync('git', ['diff', '--', 'src/anatomy'], { cwd: root, encoding: 'utf8' }),
    glslHashes: [sha(reader.ABDOMINAL_ATLAS_GLSL), sha(thoracic.THORACIC_GLSL)],
  };
}
const before = await load(beforeArg),
  after = await load(afterArg);
if (
  JSON.stringify(before.sources) !== JSON.stringify(after.sources) ||
  JSON.stringify(before.glslHashes) !== JSON.stringify(after.glslHashes)
)
  throw new Error('Geometry/source shader changed; this is not a reader-only comparison');
let seed = 8082026;
function random() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 2 ** 32;
}
const queries: Array<{ p: Vec3; field: number; thoracic: boolean }> = [];
for (const [field, f] of before.meta.ABDOMINAL_FIELDS.entries()) {
  for (let i = 0; i < 300; i++)
    queries.push({ field, thoracic: false, p: f.originMm.map((v, axis) => v + random() * (f.dimensions[axis] - 1) * f.pitchMm) as Vec3 });
  for (let axis = 0; axis < 3; axis++)
    for (const fraction of [-1e-6, 0, 0.5, 1, 1 + 1e-6]) {
      const p = f.originMm.map((v, i) => v + ((f.dimensions[i] - 1) * f.pitchMm) / 2) as Vec3;
      p[axis] = f.originMm[axis] + fraction * (f.dimensions[axis] - 1) * f.pitchMm;
      queries.push({ p, field, thoracic: false });
    }
}
const tf = before.tmeta.THORACIC_ATLAS;
for (let i = 0; i < 1000; i++)
  queries.push({
    field: 0,
    thoracic: true,
    p: tf.originMm.map((v, axis) => v + random() * (tf.textureDimensions[axis] - 1) * tf.pitchMm) as Vec3,
  });
for (let axis = 0; axis < 3; axis++)
  for (const fraction of [-1e-6, 0, 1, 1 + 1e-6]) {
    const p = tf.originMm.map((v, i) => v + ((tf.textureDimensions[i] - 1) * tf.pitchMm) / 2) as Vec3;
    p[axis] = tf.originMm[axis] + fraction * (tf.textureDimensions[axis] - 1) * tf.pitchMm;
    queries.push({ p, field: 0, thoracic: true });
  }
let mismatches = 0,
  gradientWorstMm = 0;
for (const q of queries) {
  const a = q.thoracic ? before.thoracic.thoracicValue(q.p) : before.reader.abdominalAtlasValue(q.p, q.field);
  const b = q.thoracic ? after.thoracic.thoracicValue(q.p) : after.reader.abdominalAtlasValue(q.p, q.field);
  if (!Object.is(a.d, b.d) || a.label !== b.label) mismatches++;
  const ga = q.thoracic ? before.thoracic.thoracicGradient(q.p) : before.reader.abdominalAtlasGradient(q.p, q.field);
  const gb = q.thoracic ? after.thoracic.thoracicGradient(q.p) : after.reader.abdominalAtlasGradient(q.p, q.field);
  gradientWorstMm = Math.max(gradientWorstMm, ...ga.map((v, i) => Math.abs(v - gb[i])));
}
let sink = 0;
function readerBatch(version: typeof before, repeats: number) {
  const start = performance.now();
  for (let i = 0; i < repeats; i++)
    for (const q of queries) sink += q.thoracic ? version.thoracic.thoracicSdf(q.p) : version.reader.abdominalAtlasSdf(q.p, q.field);
  return performance.now() - start;
}
readerBatch(before, 10);
readerBatch(after, 10);
const readerTimings: Array<{ variant: string; round: number; ms: number }> = [];
for (let round = 0; round < 6; round++)
  for (const [variant, version] of round % 2
    ? ([
        ['after', after],
        ['before', before],
      ] as const)
    : ([
        ['before', before],
        ['after', after],
      ] as const))
    readerTimings.push({ variant, round, ms: readerBatch(version, 100) });
const planes: Array<Record<string, unknown>> = [],
  mapTimings: Array<Record<string, unknown>> = [];
for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION]) {
  const scenes = [new before.anatomy.AnatomyScene(patient), new after.anatomy.AnatomyScene(patient)];
  for (const startPoint of startPointsFor(scenes[0].torso)) {
    const pose = {
      phi: startPoint.phi,
      z: startPoint.z,
      yaw: startPoint.yaw,
      rock: startPoint.rock ?? 0,
      tilt: startPoint.tilt ?? 0,
      lift: 0,
    };
    for (const [neighbor, patch] of [
      ['base', {}],
      ['fan-minus', { tilt: pose.tilt - Math.PI / 36 }],
      ['fan-plus', { tilt: pose.tilt + Math.PI / 36 }],
      ['rotation', { yaw: pose.yaw + Math.PI / 36 }],
      ['slide', { z: pose.z + 5 }],
      ['pressure', { lift: -2 }],
    ] as const) {
      const frame = probeFrame({ ...pose, ...patch }, scenes[0].torso, CONVEX_C35),
        hashes = [createHash('sha256'), createHash('sha256')];
      let changes = 0;
      for (let v = 0; v < 24; v++)
        for (let u = 0; u < 32; u++) {
          const p = pointOnLine(
            frame,
            CONVEX_C35,
            -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * (u + 0.5)) / 32,
            (180 * (v + 0.5)) / 24,
          );
          const responses = scenes.map((s, i) =>
            JSON.stringify(s.classify(p, i ? after.anatomy.BASELINE_CALIBER : before.anatomy.BASELINE_CALIBER)),
          );
          hashes.forEach((h, i) => h.update(responses[i]));
          if (responses[0] !== responses[1]) changes++;
        }
      planes.push({
        patient: patient.id,
        window: startPoint.id,
        neighbor,
        points: 32 * 24,
        changes,
        sha256: hashes.map((h) => h.digest('hex')),
        pose: { ...pose, ...patch },
      });
      if (neighbor !== 'base') continue;
      // Same 96x128 support as the current cut-map worker. Measures material
      // classification only, not world deformation, messaging, GUI or rendering.
      const points: Vec3[] = [];
      for (let v = 0; v < 128; v++)
        for (let u = 0; u < 96; u++)
          points.push(
            pointOnLine(frame, CONVEX_C35, -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * (u + 0.5)) / 96, (180 * (v + 0.5)) / 128),
          );
      function classifyBatch(index: number) {
        const t = performance.now();
        for (const p of points)
          sink += scenes[index].classify(p, index ? after.anatomy.BASELINE_CALIBER : before.anatomy.BASELINE_CALIBER).tissue;
        return performance.now() - t;
      }
      classifyBatch(0);
      classifyBatch(1);
      for (let round = 0; round < 4; round++)
        for (const i of round % 2 ? [1, 0] : [0, 1])
          mapTimings.push({ patient: patient.id, window: startPoint.id, round, variant: i ? 'after' : 'before', ms: classifyBatch(i) });
      console.log(patient.id, startPoint.id, 'compared');
    }
  }
}
if (START_POINTS.length !== 9) throw new Error('Unexpected window coverage');
const result = {
  at: new Date().toISOString(),
  sourceBefore: before.head,
  sourceAfter: after.head,
  candidateDiffSha256: sha(after.diff),
  sources: before.sources,
  glslHashes: before.glslHashes,
  environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  queries: queries.length,
  mismatches,
  gradientWorstMm,
  readerTimings,
  readerQueriesPerBatch: queries.length * 100,
  planes,
  mapTimings,
  sink,
  acceptance: {
    numericalParity: mismatches === 0 && gradientWorstMm === 0 && planes.every((p) => p.changes === 0),
    clinical: false,
    fullAppFluency: false,
  },
  limitations: [
    'Finite sampled CPU comparison, not independent clinical anatomy.',
    'Material classification uses baseline caliber; pressure pose does not enable the acquisition compression operator.',
    'Warm Node24 interleaved batches are not browser startup, end-to-end worker latency or FPS.',
  ],
};
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
if (!result.acceptance.numericalParity) throw new Error('Source query or material classification changed');
console.log(
  JSON.stringify({ queries: queries.length, mismatches, gradientWorstMm, planes: planes.length, classifiedPoints: planes.length * 768 }),
);
