import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { NORMAL_ADULT } from '../cases';
import { startPointsFor } from '../app/startPoints';
import { clampPose, CONVEX_C35, pointOnLine, probeFrame, type ProbePose } from '../probe/probe';
import { translateProbe } from '../probe/translation';
import { probeContact } from '../probe/contact';

afterEach(() => {
  setAbdominalAtlas();
  setAbdominalBody();
});

function sampledTorso() {
  const atlas = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
  setAbdominalAtlas(new Uint16Array(atlas.buffer.slice(atlas.byteOffset, atlas.byteOffset + atlas.byteLength)));
  const raw = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  return new AnatomyScene(NORMAL_ADULT).torso;
}

it('reaches every requested step around the torso and through thoracic/abdominal heights from every window', () => {
  const torso = sampledTorso();
  expect(torso.profile).toBeDefined();
  for (const start of startPointsFor(torso))
    for (const direction of [-1, 1]) {
      let pose: ProbePose = { ...start, lift: 0, rock: start.rock ?? 0, tilt: start.tilt ?? 0 };
      const original = probeFrame(pose, torso, CONVEX_C35);
      // Two complete circuits cross both lateral regions, front, back and the phi seam.
      for (let step = 1; step <= 96; step++) {
        const phi = pose.phi + (direction * Math.PI) / 24;
        const z = -70 + 350 * Math.sin((step * Math.PI) / 24);
        pose = clampPose(translateProbe(pose, phi, z, torso, CONVEX_C35), torso);
        expect(Math.atan2(Math.sin(pose.phi - phi), Math.cos(pose.phi - phi)), start.id).toBeCloseTo(0, 11);
        expect(pose.z, start.id).toBe(z);
        const frame = probeFrame(pose, torso, CONVEX_C35);
        for (const axis of ['axial', 'lateral', 'elevation'] as const)
          for (let i = 0; i < 3; i++) expect(frame[axis][i], `${start.id}/${direction}/${step}/${axis}`).toBeCloseTo(original[axis][i], 10);
        for (const theta of [-0.5, 0, 0.5]) {
          const a = pointOnLine(original, CONVEX_C35, theta, 150);
          const b = pointOnLine(frame, CONVEX_C35, theta, 150);
          for (let i = 0; i < 3; i++) expect(b[i] - a[i]).toBeCloseTo(frame.face[i] - original.face[i], 8);
        }
      }
    }
});

it('preserves full angular turns in both directions rather than pinning rock and tilt at 40 degrees', () => {
  const torso = sampledTorso();
  for (const start of startPointsFor(torso))
    for (const key of ['yaw', 'rock', 'tilt'] as const)
      for (const angle of [-3 * Math.PI, -2.7, -1.6, -1.2, 1.2, 1.6, 2.7, 3 * Math.PI]) {
        const pose = { ...start, lift: 0, rock: start.rock ?? 0, tilt: start.tilt ?? 0, [key]: angle };
        const expected = probeFrame(pose, torso, CONVEX_C35);
        const limited = probeFrame(clampPose(pose), torso, CONVEX_C35);
        for (const axis of ['axial', 'lateral', 'elevation'] as const)
          for (let i = 0; i < 3; i++) expect(limited[axis][i], `${start.id}/${key}/${angle}`).toBeCloseTo(expected[axis][i], 12);
      }
});

it('crosses a lateral-axis gimbal alignment without losing the requested rigid frame', () => {
  const torso = new AnatomyScene(NORMAL_ADULT).torso;
  for (const rock of [-Math.PI / 2, Math.PI / 2])
    for (const yaw of [-2.4, 0, 1.9]) {
      const original = { phi: Math.PI / 2, z: -80, lift: 0, yaw, rock, tilt: 1.4 };
      const frame = probeFrame(original, torso, CONVEX_C35);
      for (const dphi of [-1e-8, 0, 1e-8, 0.02]) {
        const pose = clampPose(translateProbe(original, original.phi + dphi, original.z + 1, torso, CONVEX_C35));
        expect(pose.z).toBe(original.z + 1);
        const moved = probeFrame(pose, torso, CONVEX_C35);
        for (const axis of ['axial', 'lateral', 'elevation'] as const)
          for (let i = 0; i < 3; i++) expect(moved[axis][i], `${rock}/${yaw}/${dphi}`).toBeCloseTo(frame[axis][i], 10);
      }
    }
});

it('uses the shared torso extent and rejects non-finite commands before they can reach contact or shaders', () => {
  const torso = sampledTorso();
  const pose = { phi: 0, z: 0, yaw: 0, rock: 0, tilt: 0, lift: 0 };
  expect(clampPose({ ...pose, z: -1e4 }, torso).z).toBe(torso.zMin);
  expect(clampPose({ ...pose, z: 1e4 }, torso).z).toBe(torso.zMax);
  for (const key of ['phi', 'z', 'yaw', 'rock', 'tilt', 'lift'] as const)
    for (const value of [NaN, Infinity, -Infinity]) expect(() => clampPose({ ...pose, [key]: value }, torso)).toThrow(RangeError);
});

it('keeps extreme rotations finite and loses coupling when the entire face points out of the patient', () => {
  const torso = sampledTorso();
  for (const phi of [-Math.PI / 2, 0, Math.PI / 2, Math.PI])
    for (const key of ['rock', 'tilt'] as const)
      for (const angle of [-Math.PI, -Math.PI / 2, Math.PI / 2, Math.PI]) {
        const pose = clampPose({ phi, z: -80, yaw: 0.6, rock: 0, tilt: 0, lift: 0, [key]: angle }, torso);
        const contact = probeContact(pose, CONVEX_C35, torso);
        for (const axis of ['axial', 'lateral', 'elevation', 'face', 'curvatureCenter'] as const)
          expect(contact.frame[axis].every(Number.isFinite)).toBe(true);
        expect(contact.contact.every((c) => Number.isFinite(c) && c >= 0 && c <= 1)).toBe(true);
        if (Math.abs(angle) === Math.PI) expect(Math.max(...contact.contact), `${phi}/${key}/${angle}`).toBe(0);
      }
});
