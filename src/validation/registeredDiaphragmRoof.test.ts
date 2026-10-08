import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { ABDOMINAL_ATLAS, ABDOMINAL_FIELDS } from '../anatomy/abdominalAtlasData';
import { diaphragmHeight, diaphragmSurfaceZ, sdDiaphragm, torsoDepth } from '../anatomy/primitives';
import { diaphragmRim } from '../anatomy/diaphragmRim';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import { raInferiorZ, raSdf } from '../anatomy/organs/heart';
import { NORMAL_ADULT } from '../cases';
import preserved from './fixtures/registered-roof-preserved-fields.json';
const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
const body = readFileSync('src/anatomy/abdominal-body.bin');
afterEach(() => {
  setAbdominalAtlas();
  setAbdominalBody();
});
function scene(): AnatomyScene {
  setAbdominalAtlas(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2));
  setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
  return new AnatomyScene(NORMAL_ADULT);
}
it('preserves every organ distance and categorical label from the pinned pre-roof atlas', () => {
  const [w, h] = ABDOMINAL_ATLAS.textureDimensions;
  expect(preserved.baselineAtlasSha256).toBe('fb1a372f2d2f53bd69d2aea95733cb71ea2574ff6222b8471c5f498c9a1fb67d');
  for (const f of ABDOMINAL_FIELDS) {
    const hash = createHash('sha256'),
      [x, y, z] = f.offset,
      [nx, ny, nz] = f.dimensions;
    for (let k = z; k < z + nz; k++)
      for (let j = y; j < y + ny; j++) {
        const start = 4 * (k * w * h + j * w + x);
        hash.update(raw.subarray(start, start + 4 * nx));
      }
    expect(hash.digest('hex'), f.name).toBe(preserved.fieldSha256[f.name]);
  }
});
it('does not return to the inherited tall domes at independent source-crossing witnesses', () => {
  const s = scene();
  // Independent source-triangle upper crossings, not values copied from the packed table.
  // 1.5 mm is the lattice pitch bound at these mild-gradient witnesses, not a clinical range.
  for (const [x, y, sourceUpper] of [
    [-31, -45, 10.16894],
    [-52.5, -68, -2.69546],
    [51, -18, 6.421334],
  ]) {
    expect(Math.abs(diaphragmHeight(x, y, s.diaphragm, s.torso) - sourceUpper)).toBeLessThan(1.5);
  }
});
it('uses the actual acoustic zero even where hepatic normal-contact support is zero', () => {
  const s = scene();
  // Rejected v1 witnesses: the liver obstacle moved the zero but the navigator skipped its solve.
  for (const [x, y] of [
    [-30.47, -58.43],
    [-19.37, -14.03],
  ]) {
    const z = diaphragmSurfaceZ(x, y, s.diaphragm, s.torso);
    expect(Math.abs(sdDiaphragm([x, y, z], s.diaphragm, s.torso))).toBeLessThan(0.001);
  }
});
it('keeps the registered rim on both the acoustic zero and internal body boundary', () => {
  const s = scene();
  for (let i = 0; i < 96; i++) {
    const p = diaphragmRim((i * 2 * Math.PI) / 96, s.diaphragm, s.torso, s.wallThickness());
    expect(Math.abs(sdDiaphragm(p, s.diaphragm, s.torso))).toBeLessThan(0.001);
    expect(Math.abs(torsoDepth(p, s.torso) + s.wallThickness())).toBeLessThan(0.0001);
  }
});

it('preserves the actual cava approach when the registered diaphragm is below the atrium', () => {
  const s = scene();
  // Rejected roof v1 deleted 29 infrahepatic and 9 suprahepatic centerline samples.
  // The approach must reach the existing atrium before its septal exclusion applies.
  for (const id of ['ivcInfra', 'ivcSupra'] as const) {
    const t = s.vesselById.get(id)!.tube;
    for (let j = 0; j < t.nodes.length - 1; j++) {
      const a = t.nodes[j].p,
        b = t.nodes[j + 1].p,
        n = Math.ceil(Math.hypot(...b.map((x, k) => x - a[k])));
      for (let i = 0; i <= n; i++) {
        const p = a.map((x, k) => x + ((b[k] - x) * i) / n) as Vec3;
        expect(s.classify(p, BASELINE_CALIBER, false).tissue, `${id}: ${p.join(',')}`).toBe(Tissue.Blood);
      }
    }
  }
});

it('locates the atrial approach on the actual tilted ellipsoid', () => {
  for (const x of [-30, -22, -15])
    for (const y of [-5, 6, 14]) {
      const z = raInferiorZ(x, y);
      expect(Math.abs(raSdf([x, y, z]))).toBeLessThan(0.000001);
      expect(raSdf([x, y, z - 0.1])).toBeGreaterThan(0);
      expect(raSdf([x, y, z + 0.1])).toBeLessThan(0);
    }
});
