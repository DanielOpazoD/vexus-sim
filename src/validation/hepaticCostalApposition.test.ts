import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { setAbdominalAtlas, abdominalAtlasSdf } from '../anatomy/abdominalAtlas';
import { setThoracicAtlas, thoracicValue, thoracicMaterial, thoracicGradient } from '../anatomy/thoracicAtlas';
import { setAbdominalBody, bodySection } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { torsoDepth } from '../anatomy/primitives';
import { NORMAL_ADULT } from '../cases';
import { startPointsFor } from '../app/startPoints';
import { CONVEX_C35, probeFrame, pointOnLine } from '../probe/probe';
import { Tissue } from '../anatomy/tissues';
import { Interface } from '../anatomy/interfaces';
import type { Vec3 } from '../core/vec3';
function field(file: string) {
  const b = gunzipSync(readFileSync(file));
  return new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
beforeEach(() => {
  setAbdominalAtlas(field('src/anatomy/abdominal-atlas.gzip.bin'));
  setThoracicAtlas(field('src/anatomy/thoracic-atlas.gzip.bin'));
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
});
afterEach(() => {
  setAbdominalAtlas();
  setThoracicAtlas();
  setAbdominalBody();
});
it('apposes the hepatic lateral surface to the actual parietal boundary at held-out positions', () => {
  const s = new AnatomyScene(NORMAL_ADULT);
  let count = 0;
  const failures: unknown[] = [];
  for (let z = -78.3; z <= -28; z += 9.1)
    for (let phi = 2.73; phi <= 3.22; phi += 0.071) {
      const cy = bodySection(phi, z, s.torso.profile!)[3];
      const p = (r: number): Vec3 => [r * Math.cos(phi), cy + r * Math.sin(phi), z];
      let lo = 0;
      for (let r = 0; r < 180; r += 0.8) if (abdominalAtlasSdf(p(r), 4) < 0) lo = r;
      if (!lo) continue;
      let hi = lo + 1.6;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (abdominalAtlasSdf(p(mid), 4) < 0) lo = mid;
        else hi = mid;
      }
      const r = (lo + hi) / 2;
      // Reject competing viscera and costal clearances: these are not hepatic apposition sites.
      if ([0, 1, 2, 3, 5, 6, 7, 9].some((f) => abdominalAtlasSdf(p(r + 2), f) < 2)) continue;
      let bone = 0;
      for (let q = r; q < r + s.wallThickness(); q += 0.5) if (thoracicValue(p(q)).d < 0) bone = q;
      if (bone > r + s.wallThickness() - 4) continue;
      const gap = -torsoDepth(p(r), s.torso) - s.wallThickness();
      count++;
      // Independent 1.5-mm atlas plus interpolation on curved skin, not a clinical tolerance.
      if (Math.abs(gap) > 2.5) failures.push({ z, phi, r, gap });
    }
  console.log(JSON.stringify({ count, failures }));
  expect(count).toBeGreaterThan(25);
  expect(failures).toEqual([]);
});
it('gives deep costal cortex an acoustic owner before bone, without erasing bone', () => {
  const s = new AnatomyScene(NORMAL_ADULT);
  // Hold the original thick-wall contour to exercise deep cortical ownership
  // independently of the contact fit, which brings most ribs back into wall.
  const bytes = readFileSync('src/anatomy/abdominal-body.bin');
  const original = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  s.torso.profile = Float32Array.from(original, (r, i) => (i % 65 === 0 ? r : r + 18));
  let deep = 0;
  const missing: unknown[] = [];
  for (let z = -90.3; z < -15; z += 5.1)
    for (let x = -150.3; x < -90; x += 3.1)
      for (let y = -30.2; y < 65; y += 5.1) {
        const p: Vec3 = [x, y, z],
          q = thoracicValue(p);
        if (thoracicMaterial(q.label) !== 'bone' || q.d < 0.08 || q.d > 0.3 || -torsoDepth(p, s.torso) < s.wallThickness()) continue;
        const c = s.classify(p, BASELINE_CALIBER, false);
        if ([Tissue.Lung, Tissue.Bone, Tissue.Vertebra].includes(c.tissue)) continue;
        deep++;
        if (c.interface !== Interface.RibCortex) missing.push({ p, q, tissue: c.tissue, iface: c.interface });
        const g = thoracicGradient(p),
          n = Math.hypot(...g),
          inside = p.map((v, i) => v - (1.2 * g[i]) / n) as Vec3;
        expect([Tissue.Bone, Tissue.Vertebra]).toContain(s.classify(inside, BASELINE_CALIBER, false).tissue);
      }
  expect(deep).toBeGreaterThan(5);
  expect(missing).toEqual([]);
});
it('marks the intercostal oblique posteriorly while keeping a rigid, equivalent acquisition plane', () => {
  const s = new AnatomyScene(NORMAL_ADULT),
    sp = startPointsFor(s.torso).find((p) => p.id === 'intercostal')!;
  const fr = probeFrame({ ...sp, lift: 0, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 }, s.torso, CONVEX_C35);
  expect(fr.lateral[1]).toBeLessThan(-0.5);
  const original = probeFrame(
    { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw + Math.PI, rock: -(sp.rock ?? 0), tilt: -(sp.tilt ?? 0) },
    s.torso,
    CONVEX_C35,
  );
  for (const theta of [-0.4, 0, 0.4])
    for (const r of [0, 40, 120])
      expect(
        Math.hypot(...pointOnLine(fr, CONVEX_C35, theta, r).map((v, i) => v - pointOnLine(original, CONVEX_C35, -theta, r)[i])),
      ).toBeLessThan(1e-8);
});
