import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Tissue } from '../../src/anatomy/tissues';
import { NORMAL_ADULT } from '../../src/cases';
import type { Vec3 } from '../../src/core/vec3';
import { setAbdominalAtlas } from '../../src/validation/support/legacyPerson/abdominalAtlas';
import { setAbdominalBody } from '../../src/validation/support/legacyPerson/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../../src/validation/support/legacyPerson/scene';
const b = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
setAbdominalAtlas(new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2));
const body = readFileSync('src/anatomy/abdominal-body.bin');
setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
const s = new AnatomyScene(NORMAL_ADULT),
  rows = [];
for (const v of s.vessels) {
  if (!/ivc|hv|aorta|pvTrunk/i.test(v.id)) continue;
  const samples = [];
  for (let j = 0; j < v.tube.nodes.length - 1; j++) {
    const a = v.tube.nodes[j].p,
      b = v.tube.nodes[j + 1].p,
      n = Math.ceil(Math.hypot(...b.map((x, k) => x - a[k])));
    for (let i = 0; i <= n; i++) {
      const p = a.map((x, k) => x + ((b[k] - x) * i) / n) as Vec3,
        c = s.classify(p, BASELINE_CALIBER, false);
      samples.push({ p, tissue: Tissue[c.tissue], vessel: c.vessel });
    }
  }
  rows.push({ id: v.id, nodes: v.tube.nodes, samples });
}
writeFileSync(process.argv[2], JSON.stringify(rows, null, 2) + '\n');
console.log(
  JSON.stringify(
    rows.map((v) => ({
      id: v.id,
      samples: v.samples.length,
      blood: v.samples.filter((c) => c.tissue === 'Blood').length,
      other: v.samples.filter((c) => c.tissue !== 'Blood').slice(0, 2),
    })),
  ),
);
