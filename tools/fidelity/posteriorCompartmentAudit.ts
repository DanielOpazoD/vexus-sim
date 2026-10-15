/** Source interior samples vs actual material classifier. No anatomy fitting or signal claims. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { AnatomyScene } from '../../src/anatomy/scene';
import { AnatomyQuery } from '../../src/anatomy/query';
import { Tissue } from '../../src/anatomy/tissues';
import { setAbdominalAtlas } from '../../src/anatomy/abdominalAtlas';
import { setThoracicAtlas } from '../../src/anatomy/thoracicAtlas';
import { setAbdominalBody } from '../../src/anatomy/referenceBody';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../../src/cases';
import { PhysiologyEngine } from '../../src/physiology/engine';
import type { Vec3 } from '../../src/core/vec3';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: posteriorCompartmentAudit.ts SOURCE_POINTS.json OUTPUT.json');
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const bytes = readFileSync(input);
const bank = JSON.parse(bytes.toString()) as { groups: Array<{ id: string; start: number; count: number }>; points: Vec3[] };
const sources: Record<string, string> = {};
for (const [name, setter] of [
  ['abdominal-atlas.gzip.bin', setAbdominalAtlas],
  ['thoracic-atlas.gzip.bin', setThoracicAtlas],
] as const) {
  const packed = readFileSync(`src/anatomy/${name}`),
    raw = gunzipSync(packed);
  sources[name] = hash(packed);
  setter(new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
}
const body = readFileSync('src/anatomy/abdominal-body.bin');
sources['abdominal-body.bin'] = hash(body);
setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
const results = [];
for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION]) {
  const state = { ...patient, respiratoryPattern: 'apnea-expiratory' as const };
  const scene = new AnatomyScene(state);
  const query = new AnatomyQuery(scene);
  const engine = new PhysiologyEngine(state, scene.vesselAreas());
  for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
  const sample = engine.sample,
    caliber = query.caliberFor(sample);
  const classifications = new Uint16Array(bank.points.length);
  const groups = [];
  for (const group of bank.groups) {
    const counts: Record<string, number> = {},
      withoutCurtain: Record<string, number> = {};
    const witnesses: Record<string, Vec3> = {};
    for (let i = group.start; i < group.start + group.count; i++) {
      const p = bank.points[i],
        material = scene.classify(p, caliber),
        noCurtain = scene.classify(p, caliber, false);
      const name = Tissue[material.tissue],
        negativeName = Tissue[noCurtain.tissue];
      counts[name] = (counts[name] ?? 0) + 1;
      withoutCurtain[negativeName] = (withoutCurtain[negativeName] ?? 0) + 1;
      witnesses[name] ??= p;
      classifications[i] = material.tissue;
    }
    groups.push({ ...group, counts, withoutCurtain, witnesses });
  }
  const target = resolve(output.replace(/\.json$/, `-${patient.id}-classes.bin`));
  const classificationBytes = new Uint8Array(classifications.buffer);
  writeFileSync(target, classificationBytes);
  results.push({
    caseId: patient.id,
    sampleTime: sample.t,
    respiratoryDisplacementMm: caliber.diaphragmCaudalMm,
    groups,
    classificationFile: target,
    classificationSha256: hash(classificationBytes),
  });
}
writeFileSync(
  output,
  JSON.stringify(
    {
      sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      moduleSha256: hash(readFileSync('src/anatomy/scene.ts')),
      inputSha256: hash(bytes),
      sources,
      results,
      coordinates:
        'Material LAS, static expiratory sample, no probe compression. Source lattice points are not acquired ultrasound pixels.',
      clinicalValidation: false,
      runtimeChanged: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ cases: results.length, pointsPerCase: bank.points.length, output }));
