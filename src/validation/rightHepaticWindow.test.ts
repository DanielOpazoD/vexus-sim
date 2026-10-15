import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Vector3, type Mesh } from 'three';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { setAbdominalAtlas, abdominalAtlasSdf } from '../anatomy/abdominalAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { CONVEX_C35, pointOnLine } from '../probe/probe';
import { buildProbe } from '../ui/navigator3d/probe';
import { buildPosteriorMuscles } from '../ui/navigator3d/organs';
import { disposeObject } from '../ui/navigator3d/common';
import { sdDiaphragm } from '../anatomy/primitives';
import type { Vec3 } from '../core/vec3';
beforeEach(() => {
  const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalAtlas(new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  setAbdominalBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
});
afterEach(() => {
  setAbdominalAtlas();
  setAbdominalBody();
});
it('keeps the diaphragm outside held-out hepatic parenchyma', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  const p: Vec3 = [-102.5214446, -7.9255744, -14.6906777];
  expect(abdominalAtlasSdf(p, 4)).toBeLessThan(-5);
  expect(sdDiaphragm(p, scene.diaphragm, scene.torso)).toBeGreaterThan(7.5);
  expect(scene.classify(p, BASELINE_CALIBER).tissue).toBe(Tissue.Liver);
});
it('does not call lateral perihepatic residual tissue mesentery', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  expect(scene.classify([-119.2229074, 31.9839385, -28.6120199], BASELINE_CALIBER).tissue).not.toBe(Tissue.MesentericFat);
});
it('registers the QL below rib 12 and anterior to the posterior lumbar arches', () => {
  const group = buildPosteriorMuscles(new AnatomyScene(NORMAL_ADULT));
  group.updateMatrixWorld(true);
  for (const o of group.children.filter((o) => o.name.startsWith('Cuadrado lumbar'))) {
    const mesh = o as Mesh,
      p = mesh.geometry.getAttribute('position');
    let hiZ = -Infinity,
      loY = Infinity,
      loZ = Infinity;
    for (let i = 0; i < p.count; i++) {
      const v = new Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).multiplyScalar(10);
      hiZ = Math.max(hiZ, v.z);
      loY = Math.min(loY, v.y);
      loZ = Math.min(loZ, v.z);
    }
    expect(hiZ).toBeLessThan(-100);
    expect(loZ).toBeLessThan(-205);
    expect(loY).toBeGreaterThan(-94);
  }
  disposeObject(group);
});
it('places every physical lens element at its radial acoustic origin', () => {
  const { probe } = buildProbe(CONVEX_C35);
  probe.updateMatrixWorld(true);
  const lens = probe.children[0] as Mesh,
    positions = lens.geometry.getAttribute('position');
  const frame = {
    face: [0, 0, 0] as Vec3,
    axial: [0, 0, 1] as Vec3,
    lateral: [1, 0, 0] as Vec3,
    elevation: [0, 1, 0] as Vec3,
    curvatureCenter: [0, 0, -60] as Vec3,
    skinPoint: [0, 0, 0] as Vec3,
    skinNormal: [0, 0, -1] as Vec3,
  };
  for (let i = 0; i < positions.count; i++) {
    const p = new Vector3().fromBufferAttribute(positions, i).applyMatrix4(lens.matrixWorld).multiplyScalar(10);
    const theta = Math.atan2(p.x, p.z + 60),
      origin = pointOnLine(frame, CONVEX_C35, theta, 0);
    expect(Math.hypot(p.x - origin[0], p.z - origin[2])).toBeLessThan(0.00001);
    expect(Math.abs(p.y)).toBeLessThanOrEqual(CONVEX_C35.elevationMm / 2 + 0.00001);
    expect(Math.abs(theta)).toBeLessThanOrEqual(CONVEX_C35.halfSector + 0.00001);
  }
  expect(2 * CONVEX_C35.curvatureRadius * Math.sin(CONVEX_C35.halfSector)).toBeCloseTo(CONVEX_C35.footprintMm, 10);
  disposeObject(probe);
});

it('keeps lung and diaphragm outside the complete shipped hepatic interior', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  let sampled = 0;
  for (let z = -130; z <= 20; z += 6)
    for (let y = -70; y <= 80; y += 6)
      for (let x = -115; x <= 95; x += 6) {
        const p: Vec3 = [x, y, z];
        if (abdominalAtlasSdf(p, 4) >= -2) continue;
        sampled++;
        const c = scene.classify(p, BASELINE_CALIBER);
        expect([Tissue.Lung, Tissue.Diaphragm]).not.toContain(c.tissue);
        expect(sdDiaphragm(p, scene.diaphragm, scene.torso)).toBeGreaterThan(4.5);
      }
  expect(sampled).toBeGreaterThan(5000);
});

it('has no distance jump at the hepatic zero crossing', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  let crossings = 0;
  for (let x = -108; x <= -70; x += 4)
    for (let y = -30; y <= 30; y += 6) {
      let hi = 30,
        lo = -80;
      if (abdominalAtlasSdf([x, y, lo], 4) >= 0) continue;
      for (let n = 0; n < 30; n++) {
        const z = (hi + lo) / 2;
        if (abdominalAtlasSdf([x, y, z], 4) < 0) lo = z;
        else hi = z;
      }
      const z = (hi + lo) / 2;
      const below = sdDiaphragm([x, y, z - 1e-5], scene.diaphragm, scene.torso);
      const above = sdDiaphragm([x, y, z + 1e-5], scene.diaphragm, scene.torso);
      expect(Math.abs(above - below)).toBeLessThan(0.001);
      crossings++;
    }
  expect(crossings).toBeGreaterThan(50);
});
