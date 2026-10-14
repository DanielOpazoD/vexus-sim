import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setAbdominalAtlas, abdominalAtlasSdf } from '../anatomy/abdominalAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { ABDOMINAL_SURFACE } from '../anatomy/abdominalSurfaceData';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { kidneyLocal, perirenalOuterSdf, RENAL_FASCIA_MM } from '../anatomy/organs/kidney';
import { Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
const body = readFileSync('src/anatomy/abdominal-body.bin');
const surface = gunzipSync(readFileSync('src/anatomy/abdominal-surface.gzip.bin'));
const vertices = new Float32Array(surface.buffer, surface.byteOffset, surface.byteLength / 4);
beforeAll(() => {
  setAbdominalAtlas(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2));
  setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setAbdominalBody();
});
describe('volumetric renal bed', () => {
  it('separates both renal surfaces from psoas without relying on classifier priority', () => {
    for (const [field, other] of [
      [5, [9]],
      [6, [9]],
      [9, [5, 6]],
    ] as const) {
      const f = ABDOMINAL_SURFACE.fields[field];
      let worst = Infinity;
      for (let i = 0; i < f.count; i++) {
        const p = Array.from(vertices.subarray(f.offset + 3 * i, f.offset + 3 * i + 3)) as Vec3;
        worst = Math.min(worst, ...other.map((k) => abdominalAtlasSdf(p, k)));
      }
      expect(worst, f.name).toBeGreaterThan(1.99);
    }
  });
  it('crosses capsule, adipose volume, fascia and muscle at both former contact sites', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const rays: Array<{ p: Vec3; n: Vec3 }> = [
      { p: [-54, -30, -197.25], n: [0, -0.3333016832, -0.942820231] },
      { p: [58.5, -36, -179.25], n: [-0.3162007423, -0.3162007423, -0.8944462986] },
    ];
    for (const { p, n } of rays) {
      const sequence: Tissue[] = [];
      let fatLength = 0,
        fasciaLength = 0;
      // Include the bounded sub-voxel contour shift from lattice regularization.
      for (let step = -40; step <= 120; step++) {
        const t = step * 0.05;
        const c = scene.classify(p.map((v, i) => v + t * n[i]) as Vec3, BASELINE_CALIBER);
        if (sequence.at(-1) !== c.tissue) sequence.push(c.tissue);
        if (c.tissue === Tissue.PerirenalFat) fatLength += 0.05;
        if (c.tissue === Tissue.SoftCapsule) fasciaLength += 0.05;
        expect(c.vessel).toBeNull();
      }
      const capsule = sequence.indexOf(Tissue.RenalCapsule);
      expect(capsule).toBeGreaterThanOrEqual(0);
      expect(sequence.slice(capsule)).toEqual([Tissue.RenalCapsule, Tissue.PerirenalFat, Tissue.SoftCapsule, Tissue.Psoas]);
      expect(fatLength).toBeGreaterThan(1.4);
      expect(fasciaLength).toBeGreaterThan(0.2);
      expect(fasciaLength).toBeLessThan(0.4);
    }
  });
  it('extracts both 3D envelopes from the same acoustic field, within meshing resolution', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    expect(ABDOMINAL_SURFACE.envelopes.length).toBe(4);
    for (const f of ABDOMINAL_SURFACE.envelopes) {
      const kidney = f.side ? scene.kidneyLeft : scene.kidneyRight;
      let worst = 0;
      for (let i = 0; i < f.count; i += 37) {
        const p = Array.from(vertices.subarray(f.offset + i * 3, f.offset + i * 3 + 3)) as Vec3;
        worst = Math.max(worst, Math.abs(perirenalOuterSdf(kidneyLocal(p, kidney), kidney) + (f.fascia ? 0 : RENAL_FASCIA_MM)));
      }
      expect(worst, f.name).toBeLessThan(0.8);
    }
  });
});
