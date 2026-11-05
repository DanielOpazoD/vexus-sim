import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { installAnatomyBundle, S0028_BUNDLE as B } from '../anatomy/anatomyBundle';
import { setAbdominalAtlas, s0028Depth } from '../anatomy/abdominalAtlas';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { torsoDepth, torsoDepthGradient, torsoSkinPoint } from '../anatomy/primitives';
import { Interface } from '../anatomy/interfaces';
import { Tissue } from '../anatomy/tissues';
import { wallFaceSd, wallFaceGradient } from '../anatomy/organs/wall';
import { NORMAL_ADULT } from '../cases';
import { startPointsFor } from '../app/startPoints';
import { CONVEX_C35, probeFrame } from '../probe/probe';
import { probeContact, contactCoupling, firstCrossing } from '../probe/contact';
import type { Vec3 } from '../core/vec3';
import { setS0028Wall, s0028InsideWall } from '../anatomy/s0028Wall';
import { setS0028Solids } from '../anatomy/s0028Solids';
let scene: AnatomyScene;
let atlas: Uint16Array;
beforeAll(() => {
  installAnatomyBundle(B);
  const raw = new Uint8Array(gunzipSync(readFileSync('src/anatomy/s0028/abdominal-direct.gzip.bin')));
  atlas = new Uint16Array(raw.buffer);
  setAbdominalAtlas(atlas);
  const thorax = new Uint8Array(gunzipSync(readFileSync('src/anatomy/s0028/thoracic-direct.gzip.bin')));
  setThoracicAtlas(new Uint16Array(thorax.buffer));
  const auxiliary = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
  const capacity = auxiliary('annotation-capacity');
  setS0028Wall(capacity, auxiliary('skin-polar'));
  setS0028Solids(capacity);
  const profile = new Uint8Array(readFileSync('src/anatomy/abdominal-body.bin'));
  setAbdominalBody(new Float32Array(profile.buffer));
  scene = new AnatomyScene(NORMAL_ADULT);
});

it('profundidad B alimenta signo, magnitud, caras profundas y respiración, también fuera de caja', () => {
  const p: Vec3 = [B.depth.originMm[0] - 6, B.depth.originMm[1] - 6, B.depth.originMm[2]];
  expect(torsoDepth(p, scene.torso)).toBeGreaterThan(0);
  expect(scene.classify(p, BASELINE_CALIBER).tissue).toBe(Tissue.Air);
  expect(scene.respiratoryWeight(p)).toBe(0);
  const points: Vec3[] = [p, [0, 0, -100], [-80, 40, -50], [40, -40, -180]];
  for (const m of points) {
    const depth = s0028Depth(m);
    expect(torsoDepth(m, scene.torso)).toBe(depth);
    expect(scene.insideWallMm(m)).toBe(s0028InsideWall(m) ?? -1e3);
    expect(Number.isFinite(scene.liverInteriorMargin(m))).toBe(true);
    const g = torsoDepthGradient(m, scene.torso);
    for (const axis of [0, 1, 2]) {
      const a: Vec3 = [...m],
        b: Vec3 = [...m];
      a[axis] += 1.5;
      b[axis] -= 1.5;
      expect(g[axis]).toBeCloseTo((torsoDepth(a, scene.torso) - torsoDepth(b, scene.torso)) / 3, 10);
    }
    for (const face of [Interface.SkinFat, Interface.DeepFascia, Interface.Peritoneum]) {
      if (face === Interface.SkinFat || s0028InsideWall(m) !== null) {
        expect(Number.isFinite(wallFaceSd(m, face, scene.torso))).toBe(true);
        // Analítico: sólo la celda de m (sus cuatro soportes D/E), sin vecinos que crucen un hueco U.
        expect(wallFaceGradient(m, face, scene.torso).every(Number.isFinite)).toBe(true);
      } else {
        expect(Number.isNaN(wallFaceSd(m, face, scene.torso))).toBe(true);
        expect(wallFaceGradient(m, face, scene.torso).every(Number.isNaN)).toBe(true);
      }
    }
  }
  // Negative: removing B must change a real consumer, rather than merely changing metadata.
  const before = points.map((m) => torsoDepth(m, scene.torso));
  setAbdominalAtlas(undefined);
  expect(points.map((m) => torsoDepth(m, scene.torso))).not.toEqual(before);
  setAbdominalAtlas(atlas);
  expect(points.map((m) => torsoDepth(m, scene.torso))).toEqual(before);
});

it('las diez poses provisionales recorren apoyo, gradiente ±1 mm, entrada cutánea y cara interna', () => {
  for (const sp of startPointsFor(scene.torso, B)) {
    const samples = [];
    for (const lift of [-6, 0, 25]) {
      const pose = { phi: sp.phi, z: sp.z, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift };
      const frame = probeFrame(pose, scene.torso, CONVEX_C35);
      const contact = probeContact(pose, CONVEX_C35, scene.torso);
      expect(frame.face.every(Number.isFinite)).toBe(true);
      expect(contact.nodes.flat().every(Number.isFinite)).toBe(true);
      expect(contact.contact.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
      const coupling = contactCoupling(contact, 0);
      expect(coupling).toBeGreaterThanOrEqual(0);
      expect(coupling).toBeLessThanOrEqual(1);
      samples.push(contact);
    }
    // Lifting away must release compression even where a provisional pose has no acoustic window.
    expect(samples[2].summary.indentMm).toBe(0);
  }
  // Endpoint-negative from the real crossing consumer: last partial interval must be visited.
  expect(firstCrossing((r) => r, 3, 0, 3)).toBeCloseTo(3, 5);
  expect(firstCrossing(() => -1, 0, 0, 6)).toBeNull();
});

// Runtime coverage, not an independent CT accuracy claim. The provisional skin
// is intentionally retained: P2 owns its replacement. Exercise every azimuth,
// both D seams, the interior and the exterior 6-mm consumer envelope.
it('cubre profundidad y consumidores en el dominio completo y la envolvente de 6 mm', () => {
  for (const z of [-211, -210, -209, -180, -90, 0, 59, 60, 61])
    for (let angle = 0; angle <= 32; angle++) {
      const phi = -Math.PI / 2 + (angle * Math.PI) / 16;
      const skin = torsoSkinPoint(phi, z, scene.torso);
      for (const radius of [0, 0.5, 1]) {
        const p: Vec3 = [skin[0] * radius, skin[1] * radius, z];
        expect(Number.isFinite(torsoDepth(p, scene.torso))).toBe(true);
        expect(Number.isFinite(scene.insideWallMm(p))).toBe(true);
        expect(Number.isFinite(scene.respiratoryWeight(p))).toBe(true);
        expect(Number.isFinite(scene.classify(p, BASELINE_CALIBER).tissue)).toBe(true);
      }
      for (const offset of [-6, 0, 6]) {
        const p: Vec3 = [skin[0] + offset * Math.cos(phi), skin[1] + offset * Math.sin(phi), z];
        expect(torsoDepth(p, scene.torso)).toBe(s0028Depth(p));
        // Contact's smoothed skinGap uses ±1 mm, separate from the 1.5-mm
        // acquisition gradient. All six samples must remain usable.
        for (const axis of [0, 1, 2])
          for (const sign of [-1, 1]) {
            const q: Vec3 = [...p];
            q[axis] += sign;
            expect(Number.isFinite(torsoDepth(q, scene.torso))).toBe(true);
          }
      }
    }
  const d = B.depth;
  for (const axis of [0, 1, 2])
    for (const side of [-1, 1]) {
      const p: Vec3 = [0, 0, -100];
      p[axis] = d.originMm[axis] + (side < 0 ? -6 : (d.dimensions[axis] - 1) * d.pitchMm + 6);
      expect(Number.isFinite(torsoDepth(p, scene.torso))).toBe(true);
      expect(torsoDepthGradient(p, scene.torso).every(Number.isFinite)).toBe(true);
    }
});
