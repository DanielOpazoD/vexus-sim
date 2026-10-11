import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { CONVEX_C35, probeFrame, pointOnLine, clampPose } from '../probe/probe';
import { translateProbe } from '../probe/translation';
import { startPointsFor } from '../app/startPoints';
import { setReferenceBody } from '../anatomy/referenceBody';

afterEach(() => setReferenceBody());

it('translates rays rigidly over sampled skin without aiming or changing their directions', () => {
  const raw = readFileSync('src/anatomy/reference-body.bin');
  const profile = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  setReferenceBody(profile);
  const torso = new AnatomyScene(NORMAL_ADULT).torso;
  expect(torso.profile).toBe(profile);
  for (const sp of startPointsFor(torso)) {
    const original = { ...sp, lift: 0, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
    const old = probeFrame(original, torso, CONVEX_C35);
    const moved = translateProbe(original, original.phi + 0.02, original.z + 3, torso, CONVEX_C35);
    expect(moved.phi).toBeCloseTo(original.phi + 0.02, 12);
    expect(moved.z).toBe(original.z + 3);
    const now = probeFrame(moved, torso, CONVEX_C35);
    for (const axis of ['axial', 'lateral', 'elevation'] as const)
      for (let i = 0; i < 3; i++) expect(now[axis][i], sp.id).toBeCloseTo(old[axis][i], 12);
    for (const theta of [-0.5, 0, 0.5])
      for (const depth of [0, 50, 150]) {
        const a = pointOnLine(old, CONVEX_C35, theta, depth),
          b = pointOnLine(now, CONVEX_C35, theta, depth);
        for (let i = 0; i < 3; i++) expect(b[i] - a[i]).toBeCloseTo(now.face[i] - old.face[i], 10);
      }
  }
});

it('stops a large slide at the existing angle limit rather than rotating silently', () => {
  const torso = new AnatomyScene(NORMAL_ADULT).torso;
  const p = { phi: Math.PI, z: -100, lift: 0, yaw: 0, rock: 0, tilt: 0 };
  const old = probeFrame(p, torso, CONVEX_C35);
  const moved = translateProbe(p, p.phi + 1.4, p.z, torso, CONVEX_C35);
  expect(moved.phi).toBeGreaterThan(p.phi);
  expect(moved.phi).toBeLessThan(p.phi + 1.4);
  expect(moved.z).toBe(p.z);
  expect(Math.max(Math.abs(moved.rock), Math.abs(moved.tilt))).toBeCloseTo(0.7, 5);
  const now = probeFrame(clampPose(moved), torso, CONVEX_C35);
  for (const axis of ['axial', 'lateral', 'elevation'] as const)
    for (let i = 0; i < 3; i++) expect(now[axis][i]).toBeCloseTo(old[axis][i], 10);
});
