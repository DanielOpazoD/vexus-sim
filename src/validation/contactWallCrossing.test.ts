import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { nodeSin } from '../anatomy/compression';
import { torsoDepth } from '../anatomy/primitives';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { probeContact } from '../probe/contact';
import { CONVEX_C35 } from '../probe/probe';

beforeAll(() => {
  const a = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
  setAbdominalAtlas(new Uint16Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)));
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setAbdominalBody();
});

// Exact acquired pose of the thin renal line, plus neighboring manual slides.
// Compare the reported wall with a separate fine scan of the SAME body depth,
// not a saved image or a prescribed coupling value. Real lifted probes still lose contact.
it('finds the real first wall crossing throughout a hepatorenal slide, including a short final bracket', () => {
  const scene = new AnatomyScene(NORMAL_ADULT),
    tr = CONVEX_C35;
  for (const dz of [-1, -0.2, 0, 0.2, 1]) {
    const contact = probeContact(
      { phi: 2.99, z: -113 + dz, lift: 0, yaw: -0.24452521426888296, rock: -0.13406390040993016, tilt: -0.3591483268294911 },
      tr,
      scene.torso,
    );
    const f = contact.frame,
      W = contact.plateMm;
    for (let k = 24; k <= 30; k++) {
      const s = nodeSin(k, tr.halfSector),
        c = Math.sqrt(1 - s * s);
      const dir = f.axial.map((v, i) => v * c + f.lateral[i] * s) as Vec3;
      const E = f.curvatureCenter.map((v, i) => v + tr.curvatureRadius * dir[i]);
      const depthAt = (r: number) => -torsoDepth(E.map((v, i) => v + dir[i] * r) as Vec3, scene.torso);
      const rs = contact.summary.skinAlongMm[k];
      let first = rs;
      while (depthAt(first) < W && first < rs + 3 * W) first += 0.025;
      expect(depthAt(first), `dz${dz}, node${k}: scan reaches the wall`).toBeGreaterThanOrEqual(W);
      const reported = contact.summary.wallAlongMm[k];
      expect(Math.abs(reported - first), `dz${dz}, node${k}: first crossing`).toBeLessThan(0.026);
      expect(Math.abs(depthAt(reported) - W)).toBeLessThan(0.001);
    }
  }
  const lifted = probeContact(
    { phi: 2.99, z: -113, lift: 30, yaw: -0.24452521426888296, rock: -0.13406390040993016, tilt: -0.3591483268294911 },
    tr,
    scene.torso,
  );
  expect(Math.min(...lifted.summary.skinAlongMm)).toBeGreaterThan(4.5);
  expect(Math.max(...lifted.contact)).toBe(0);
});
