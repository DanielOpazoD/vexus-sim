import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setAbdominalAtlas } from '../../src/anatomy/abdominalAtlas';
import { setAbdominalBody } from '../../src/anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../../src/anatomy/scene';
import { NORMAL_ADULT } from '../../src/cases';
import { diaphragmHeight } from '../../src/anatomy/primitives';
const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin')),
  body = readFileSync('src/anatomy/abdominal-body.bin');
setAbdominalAtlas(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2));
setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
const s = new AnatomyScene(NORMAL_ADULT),
  failures = [];
for (const id of ['ivcInfra', 'ivcSupra'] as const) {
  const t = s.vesselById.get(id)!.tube;
  for (let j = 0; j < t.nodes.length - 1; j++)
    for (let k = 0; k <= 10; k++) {
      const p = t.nodes[j].p.map((x, i) => x + ((t.nodes[j + 1].p[i] - x) * k) / 10) as [number, number, number];
      s.diaphragm.hepaticContact = false;
      const before = s.classify(p, BASELINE_CALIBER, false);
      s.diaphragm.hepaticContact = true;
      const after = s.classify(p, BASELINE_CALIBER, false);
      if (before.vessel !== after.vessel || before.tissue !== after.tissue)
        failures.push({
          id,
          p,
          before: { tissue: before.tissue, vessel: before.vessel },
          after: { tissue: after.tissue, vessel: after.vessel },
          dome: diaphragmHeight(p[0], p[1], s.diaphragm, s.torso),
        });
    }
}
console.log(
  JSON.stringify(
    {
      cavalContinuityChanges: failures,
      cavalUpperSamples: [0, 10, 15, 20, 25, 30, 35, 40].map((z) => {
        const p: [number, number, number] = [-15, -5.6, z];
        s.diaphragm.hepaticContact = false;
        const b = s.classify(p, BASELINE_CALIBER, false);
        s.diaphragm.hepaticContact = true;
        const a = s.classify(p, BASELINE_CALIBER, false);
        return {
          p,
          before: { tissue: b.tissue, vessel: b.vessel, iface: b.interface },
          after: { tissue: a.tissue, vessel: a.vessel, iface: a.interface },
        };
      }),
      heartRoof: [
        [-22, 6],
        [39, 30],
        [13, 5],
      ].map(([x, y]) => ({
        x,
        y,
        old: diaphragmHeight(x, y, { ...s.diaphragm, hepaticContact: false }, s.torso),
        current: diaphragmHeight(x, y, s.diaphragm, s.torso),
      })),
    },
    null,
    2,
  ),
);
