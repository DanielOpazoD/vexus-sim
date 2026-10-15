/** Identical source surface samples against the real runtime shell, before/after. */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setAbdominalAtlas } from '../../src/anatomy/abdominalAtlas';
import { setThoracicAtlas } from '../../src/anatomy/thoracicAtlas';
import { setAbdominalBody } from '../../src/anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../../src/anatomy/scene';
import { sdDiaphragm } from '../../src/anatomy/primitives';
import { DIAPHRAGM_THICKNESS_MM, Tissue } from '../../src/anatomy/tissues';
import { NORMAL_ADULT } from '../../src/cases';
import type { Vec3 } from '../../src/core/vec3';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Input bank and output required');
const bytes = readFileSync(input),
  bank = JSON.parse(bytes.toString()) as { groups: Array<{ id: string; start: number; count: number }>; points: Vec3[] };
for (const [name, setter] of [
  ['abdominal-atlas.gzip.bin', setAbdominalAtlas],
  ['thoracic-atlas.gzip.bin', setThoracicAtlas],
] as const) {
  const b = gunzipSync(readFileSync('src/anatomy/' + name));
  setter(new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2));
}
const body = readFileSync('src/anatomy/abdominal-body.bin');
setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
const scene = new AnatomyScene(NORMAL_ADULT),
  groups = [];
for (const g of bank.groups) {
  const counts: Record<string, number> = {},
    witnesses = [];
  let shellSamples = 0;
  for (let i = g.start; i < g.start + g.count; i++) {
    const p = bank.points[i],
      d = sdDiaphragm(p, scene.diaphragm, scene.torso),
      c = scene.classify(p, BASELINE_CALIBER, false),
      name = Tissue[c.tissue];
    counts[name] = (counts[name] ?? 0) + 1;
    if (d >= 0 && d < DIAPHRAGM_THICKNESS_MM) {
      shellSamples++;
      witnesses.push({ point: p, diaphragmSdfMm: d, tissue: name, vessel: c.vessel });
    }
  }
  groups.push({ ...g, counts, shellSamples, witnesses });
}
writeFileSync(
  output,
  JSON.stringify(
    {
      headSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      bankSha256: createHash('sha256').update(bytes).digest('hex'),
      hashes: Object.fromEntries(
        ['src/anatomy/primitives.ts', 'src/anatomy/abdominal-atlas.gzip.bin', 'src/anatomy/scene.ts'].map((f) => [
          f,
          createHash('sha256').update(readFileSync(f)).digest('hex'),
        ]),
      ),
      groups,
      completeSurfaceIntersectionProof: false,
      clinicalAcceptance: false,
      meaning:
        'Every source vertex and face centroid. Shell membership is a discrepancy witness, not an overlap area, global clearance or normal hiatal model. Vessel classifier priority is not validation of anatomy.',
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(groups.map((g) => ({ id: g.id, samples: g.count, shellSamples: g.shellSamples, counts: g.counts }))));
