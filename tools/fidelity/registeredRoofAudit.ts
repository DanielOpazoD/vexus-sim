/** Refutation bank for the actual shared roof; no acceptance by a few selected heights. */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { setAbdominalAtlas } from '../../src/anatomy/abdominalAtlas';
import { setAbdominalBody } from '../../src/anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../../src/anatomy/scene';
import { diaphragmHeight, diaphragmSurfaceZ, sdDiaphragm, torsoDepth } from '../../src/anatomy/primitives';
import { diaphragmRim } from '../../src/anatomy/diaphragmRim';
import { NORMAL_ADULT } from '../../src/cases';
import type { Vec3 } from '../../src/core/vec3';
const output = process.argv[2];
if (!output) throw Error('Output required');
const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
setAbdominalAtlas(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2));
const body = readFileSync('src/anatomy/abdominal-body.bin');
setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
const scene = new AnatomyScene(NORMAL_ADULT),
  failures = [],
  surface = [];
for (let y = -110.23; y <= 90; y += 3.7)
  for (let x = -145.17; x <= 145; x += 3.7) {
    const height = diaphragmHeight(x, y, scene.diaphragm, scene.torso);
    if (-torsoDepth([x, y, height], scene.torso) <= scene.wallThickness()) continue;
    try {
      const zero = diaphragmSurfaceZ(x, y, scene.diaphragm, scene.torso),
        p: Vec3 = [x, y, zero],
        residual = sdDiaphragm(p, scene.diaphragm, scene.torso);
      const row = { p, height, residual, tissue: scene.classify(p, BASELINE_CALIBER, false).tissue };
      surface.push(row);
      if (Math.abs(residual) > 0.001) failures.push(row);
    } catch (error) {
      failures.push({ x, y, height, error: String(error) });
    }
  }
const rim = [];
for (let i = 0; i < 96; i++) {
  const p = diaphragmRim((i * 2 * Math.PI) / 96, scene.diaphragm, scene.torso, scene.wallThickness()),
    residual = sdDiaphragm(p, scene.diaphragm, scene.torso),
    wallResidual = torsoDepth(p, scene.torso) + scene.wallThickness();
  rim.push({ p, residual, wallResidual });
}
const hashes = Object.fromEntries(
  [
    'src/anatomy/primitives.ts',
    'src/anatomy/abdominalAtlas.ts',
    'src/anatomy/abdominal-atlas.gzip.bin',
    'src/anatomy/gpu/anatomy.glsl.ts',
    'src/anatomy/scene.ts',
  ].map((f) => [f, createHash('sha256').update(readFileSync(f)).digest('hex')]),
);
writeFileSync(
  output,
  JSON.stringify(
    {
      hashes,
      surface,
      failures,
      rim,
      clinicallyValidated: false,
      meaning:
        'Material-space refutation. 3D zero must match actual acoustic SDF; cortical/vascular clinical acceptance and performance separate.',
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({ samples: surface.length, failures: failures.length, rimMaxResidual: Math.max(...rim.map((r) => Math.abs(r.residual))) }),
);
