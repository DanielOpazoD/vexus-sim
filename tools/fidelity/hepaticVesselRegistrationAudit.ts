import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { abdominalAtlasSdf, setAbdominalAtlas } from '../../src/anatomy/abdominalAtlas';
import { setAbdominalBody } from '../../src/anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../../src/anatomy/scene';
import { NORMAL_ADULT } from '../../src/cases';
import { diaphragmHeight, sdDiaphragm, diaphragmSurfaceZ } from '../../src/anatomy/primitives';
import type { Vec3 } from '../../src/core/vec3';
const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin')),
  body = readFileSync('src/anatomy/abdominal-body.bin');
setAbdominalAtlas(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2));
setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
const s = new AnatomyScene(NORMAL_ADULT),
  vessels = [];
for (const v of s.vessels.filter((v) => v.id.startsWith('hv'))) {
  let worstGut = { d: 16, p: [0, 0, 0] as Vec3 },
    worstLiver = { d: -64, p: [0, 0, 0] as Vec3 };
  const failures = [];
  for (let j = 0; j < v.tube.nodes.length - 1; j++) {
    const a = v.tube.nodes[j].p,
      b = v.tube.nodes[j + 1].p,
      n = Math.ceil(Math.hypot(...b.map((x, k) => x - a[k])));
    for (let i = 0; i <= n; i++) {
      const p = a.map((x, k) => x + ((b[k] - x) * i) / n) as Vec3,
        d = abdominalAtlasSdf(p, 1),
        l = abdominalAtlasSdf(p, 4);
      if (d < worstGut.d) worstGut = { d, p };
      if (l > worstLiver.d) worstLiver = { d: l, p };
      if (d < -4) failures.push({ p, gut: d, liver: l });
    }
  }
  vessels.push({ id: v.id, worstGut, worstLiver, failures });
}
const witness = s.classify([-60, -15, 19.75], BASELINE_CALIBER, false);
console.log(
  JSON.stringify(
    {
      vessels,
      superiorOldVesselWitness: witness,
      surfaceSamples: [
        [-60, -15],
        [-80, 10],
        [-40, -25],
        [-45, 10],
        [-25, 20],
      ].map(([x, y]) => ({
        x,
        y,
        height: diaphragmHeight(x, y, s.diaphragm, s.torso),
        zero: diaphragmSurfaceZ(x, y, s.diaphragm, s.torso),
        sd: sdDiaphragm([x, y, diaphragmSurfaceZ(x, y, s.diaphragm, s.torso)], s.diaphragm, s.torso),
      })),
    },
    null,
    2,
  ),
);
