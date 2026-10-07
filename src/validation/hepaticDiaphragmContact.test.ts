import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { abdominalAtlasSdf, setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { ABDOMINAL_ATLAS, ABDOMINAL_FIELDS } from '../anatomy/abdominalAtlasData';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { tubeQuery } from '../anatomy/primitives';
import { NORMAL_ADULT } from '../cases';
import { sdDiaphragm, diaphragmHeight, diaphragmSurfaceZ } from '../anatomy/primitives';
import { DIAPHRAGM_THICKNESS_MM } from '../anatomy/tissues';

const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
const body = readFileSync('src/anatomy/abdominal-body.bin');
// Independently select the contact region from the hepatic field, never from the new support map.
const f = ABDOMINAL_FIELDS[4],
  [w, h] = ABDOMINAL_ATLAS.textureDimensions;
const half = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
const exteriorProjection: [number, number][] = [];
for (let y = 0; y < f.dimensions[1]; y++)
  for (let x = 0; x < f.dimensions[0]; x++) {
    let occupied = false;
    for (let z = 0; z < f.dimensions[2]; z++) {
      const value = half[2 * ((z + f.offset[2]) * w * h + (y + f.offset[1]) * w + x + f.offset[0])];
      if ((value & 0x8000) !== 0 && (value & 0x7fff) !== 0) {
        occupied = true;
        break;
      }
    }
    if (!occupied) exteriorProjection.push([f.originMm[0] + 1.5 * x, f.originMm[1] + 1.5 * y]);
  }
afterEach(() => {
  setAbdominalAtlas();
  setAbdominalBody();
});

/** Independent sub-voxel zero search, offset from the table construction lattice. */
function roof(x: number, y: number): number | null {
  let hi = 30;
  for (let z = 28.5; z >= -81; z -= 1.5) {
    if (abdominalAtlasSdf([x, y, z], 4) < 0) {
      let lo = z;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (abdominalAtlasSdf([x, y, mid], 4) < 0) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    hi = z;
  }
  return null;
}

it('apposes the registered superior liver without a virtual fat layer at independent points', () => {
  setAbdominalAtlas(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2));
  setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
  const scene = new AnatomyScene(NORMAL_ADULT);
  const failures: unknown[] = [];
  let count = 0,
    worst = 0;
  for (let y = -60.23; y < 60; y += 5.3)
    for (let x = -110.17; x < 60; x += 4.7) {
      const z = roof(x, y),
        zx0 = roof(x - 0.5, y),
        zx1 = roof(x + 0.5, y),
        zy0 = roof(x, y - 0.5),
        zy1 = roof(x, y + 0.5);
      if (z === null || z <= -45 || [zx0, zx1, zy0, zy1].some((v) => v === null)) continue;
      if (Math.hypot(zx1! - zx0!, zy1! - zy0!) >= 1 || exteriorProjection.some(([ex, ey]) => Math.hypot(x - ex, y - ey) <= 13.5)) continue;
      const gap = sdDiaphragm([x, y, z], scene.diaphragm, scene.torso) - DIAPHRAGM_THICKNESS_MM;
      worst = Math.max(worst, Math.abs(gap));
      count++;
      if (Math.abs(gap) > 1.5) failures.push({ p: [x, y, z], gap });
    }
  console.log(JSON.stringify({ independentSamples: count, worstNormalGapMm: worst, failures }));
  expect(count).toBeGreaterThan(300);
  expect(failures).toEqual([]);
  // The inherited right hepatic axis used to pass above this hepatic roof.
  // Correct the vessel geometry; do not hide it by giving diaphragm priority.
  const witness = scene.classify([-60, -15, 19.75], BASELINE_CALIBER, false);
  expect(witness.tissue).toBe(9);
  expect(witness.vessel).toBeNull();
  const cava = scene.vesselById.get('ivcInfra')!.tube;
  for (const id of ['hvRight', 'hvMiddle', 'hvLeft', 'hvCommonTrunk'] as const) {
    const t = scene.vesselById.get(id)!.tube;
    for (let j = 0; j < t.nodes.length - 1; j++) {
      const a = t.nodes[j].p,
        b = t.nodes[j + 1].p,
        n = Math.ceil(Math.hypot(...b.map((x, k) => x - a[k])));
      for (let k = 0; k <= n; k++) {
        const p = a.map((x, i) => x + ((b[i] - x) * k) / n) as [number, number, number];
        expect(abdominalAtlasSdf(p, 4) <= 0 || tubeQuery(p, cava).d < 0, `${id} ${p.join(',')}`).toBe(true);
        expect(abdominalAtlasSdf(p, 1), `${id} ${p.join(',')}`).toBeGreaterThanOrEqual(0);
      }
    }
  }
  for (const [child, parent] of [
    ['hvRightAnterior', 'hvRight'],
    ['hvRightPosterior', 'hvRight'],
    ['hvMiddleTributary', 'hvMiddle'],
    ['hvLeftTributary', 'hvLeft'],
    ['hvMiddle', 'hvCommonTrunk'],
    ['hvLeft', 'hvCommonTrunk'],
  ] as const) {
    const end = scene.vesselById.get(child)!.tube.nodes.at(-1)!.p;
    expect(tubeQuery(end, scene.vesselById.get(parent)!.tube).d, `${child} → ${parent}`).toBeLessThan(0);
  }
  // The navigator upper surface is the acoustic zero; the lower abdomen is never
  // accidentally interpreted as another side of the hepatic shell.
  for (const [x, y] of [
    [-60, -15],
    [-80, 10],
    [-40, -25],
    [-45, 10],
    [-25, 20],
  ]) {
    const z = diaphragmSurfaceZ(x, y, scene.diaphragm, scene.torso);
    expect(Math.abs(sdDiaphragm([x, y, z], scene.diaphragm, scene.torso))).toBeLessThan(0.001);
    expect(sdDiaphragm([x, y, -200], scene.diaphragm, scene.torso)).toBeGreaterThan(10);
  }
  // Outside the registered patch, no global translation of the dome or costal insertion.
  for (const [x, y] of [
    [-150, -80],
    [145, -80],
    [0, 100],
  ])
    expect(diaphragmHeight(x, y, scene.diaphragm, scene.torso)).toBe(
      diaphragmHeight(x, y, { ...scene.diaphragm, hepaticContact: false }, scene.torso),
    );
});
