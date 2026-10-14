import { beforeAll, afterAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setAbdominalAtlas, abdominalAtlasValue } from '../anatomy/abdominalAtlas';
import { ABDOMINAL_FIELDS } from '../anatomy/abdominalAtlasData';
import { abdomenQuery, digestiveGasPlane, digestiveWallMm } from '../anatomy/organs/abdomen';
import { Tissue, TISSUES, attenuationDbPerCm } from '../anatomy/tissues';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { NORMAL_ADULT } from '../cases';
import { structureIdentity } from '../anatomy/structureIdentity';
import { lumenExcessPerMm, rayAttenuationDb } from '../ultrasound/transmission';
import type { Vec3 } from '../core/vec3';

beforeAll(() => {
  const b = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
  setAbdominalAtlas(new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  const body = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setAbdominalBody();
});

it('the observed cavity above the kidney belongs to nonvascular ascending-colon contents', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  for (const p of [
    [-90.5, -11.8, -146],
    [-84, -11.7, -163.5],
    [-92.6, -4.7, -179],
  ] as Vec3[]) {
    const atlas = abdominalAtlasValue(p, 1),
      c = scene.classify(p, BASELINE_CALIBER);
    expect(atlas.label).toBe(6);
    expect(atlas.d).toBeLessThan(-10);
    expect(c.tissue).toBe(Tissue.ColonicContents);
    expect(c.vessel).toBeNull();
    expect(c.vesselHit).toBeNull();
    expect(structureIdentity(p, c.tissue, c.interface, scene)).toBe(13);
  }
});

it('uses the registered colonic lumen only, retaining gas, clear small-bowel fluid and all five wall strata', () => {
  const f = ABDOMINAL_FIELDS[1],
    counts = { contents: 0, gas: 0, fluid: 0, wall: 0 };
  const labels = new Set<number>();
  for (let z = 0; z < f.dimensions[2]; z += 5)
    for (let y = 0; y < f.dimensions[1]; y += 5)
      for (let x = 0; x < f.dimensions[0]; x += 5) {
        const p = f.originMm.map((v, i) => v + [x, y, z][i] * f.pitchMm) as Vec3;
        const q = abdominalAtlasValue(p, 1);
        if (q.d >= 0) continue;
        const c = abdomenQuery(p)!;
        // Another registered organ can own an overlapping surface voxel.
        if (![23, 24].includes(c.interface)) continue;
        const inner = q.d + digestiveWallMm(q.label);
        if (inner >= 0) {
          expect([Tissue.SoftCapsule, Tissue.GutMuscularis, Tissue.GutSubmucosa, Tissue.Bowel]).toContain(c.tissue);
          counts.wall++;
        } else if (digestiveGasPlane(p, q.label) > 0) {
          expect(c.tissue).toBe(Tissue.BowelGas);
          counts.gas++;
        } else if (q.label >= 5 && q.label <= 9) {
          expect(c.tissue).toBe(Tissue.ColonicContents);
          counts.contents++;
          labels.add(q.label);
        } else {
          expect(c.tissue).toBe(Tissue.Fluid);
          counts.fluid++;
        }
      }
  for (const count of Object.values(counts)) expect(count).toBeGreaterThan(50);
  expect([...labels].sort()).toEqual([5, 6, 7, 8, 9]);
});

it('preserves simple fluid in the gallbladder and bladder', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  for (const field of [2, 7]) {
    const f = ABDOMINAL_FIELDS[field];
    let fluid = 0;
    for (let z = 0; z < f.dimensions[2]; z += 3)
      for (let y = 0; y < f.dimensions[1]; y += 3)
        for (let x = 0; x < f.dimensions[0]; x += 3) {
          const p = f.originMm.map((v, i) => v + [x, y, z][i] * f.pitchMm) as Vec3;
          if (abdominalAtlasValue(p, field).d >= -4) continue;
          expect(scene.classify(p, BASELINE_CALIBER).tissue).toBe(Tissue.Fluid);
          fluid++;
        }
    expect(fluid).toBeGreaterThan(20);
  }
});

it('acquires particulate scattering and finite material attenuation, with the declared fluid impedance proxy', () => {
  const c = TISSUES[Tissue.ColonicContents],
    fluid = TISSUES[Tissue.Fluid];
  expect(c.gas).toBe(false);
  expect(c.bone).toBe(false);
  expect(c.backscatter).toBeGreaterThan(fluid.backscatter);
  expect(c.speckleClump).toBeGreaterThan(0);
  expect([c.c, c.rho]).toEqual([fluid.c, fluid.rho]);
  expect(lumenExcessPerMm(Tissue.ColonicContents)).toBe(lumenExcessPerMm(Tissue.Fluid));
  const loss = rayAttenuationDb([Tissue.ColonicContents, Tissue.ColonicContents], 5, 2.5);
  expect(loss).toBeCloseTo(2 * attenuationDbPerCm(Tissue.ColonicContents, 2.5), 10);
});
