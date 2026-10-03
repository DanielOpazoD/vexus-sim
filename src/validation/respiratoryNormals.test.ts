import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { warpAt, warpBound, warpNormal } from '../anatomy/compression';
import { RespiratoryDeformation } from '../anatomy/deformation';
import { setReferenceBody } from '../anatomy/referenceBody';
import { anatomyWarpAt, respiratoryWeightGradient } from '../anatomy/respiratoryNormals';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { dot, length, type Vec3 } from '../core/vec3';
import { PhysiologyEngine } from '../physiology/engine';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine } from '../probe/probe';

const bytes = readFileSync(new URL('../anatomy/reference-body.bin', import.meta.url));
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const gradient = (f: (p: Vec3) => number, p: Vec3, h = 0.0001): Vec3 =>
  [0, 1, 2].map((j) => {
    const a: Vec3 = [...p],
      b: Vec3 = [...p];
    a[j] += h;
    b[j] -= h;
    return (f(a) - f(b)) / (2 * h);
  }) as Vec3;
const error = (a: Vec3, b: Vec3): number => Math.hypot(...a.map((v, j) => v - b[j]));

afterEach(() => setReferenceBody(undefined));
for (const reference of [false, true])
  describe(`normales respiratorias: ${reference ? 'referencia' : 'legado'}`, () => {
    const setup = () => {
      setReferenceBody(reference ? profile : undefined);
      const scene = new AnatomyScene(NORMAL_ADULT),
        deformation = new RespiratoryDeformation(scene);
      const engine = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas());
      engine.step();
      return { scene, deformation, sample: engine.sample.resp };
    };
    it('la derivada del peso coincide con diferencias centrales en ambas transiciones', () => {
      const { scene } = setup();
      let transitions = 0;
      for (let x = -123; x < 125; x += 19)
        for (let y = -73; y < 90; y += 17)
          for (const z of [-133, -67, 13, 73]) {
            const p: Vec3 = [x, y, z];
            const g = respiratoryWeightGradient(scene, p);
            expect(
              error(
                g,
                gradient((m) => scene.respiratoryWeight(m), p),
              ),
              String(p),
            ).toBeLessThan(2e-7);
            if (length(g) > 0) transitions++;
          }
      expect(transitions).toBeGreaterThan(30);
    });
    it('transporta el gradiente completo de un campo material, con y sin compresión', () => {
      const { scene, deformation, sample } = setup();
      const normals: Vec3[] = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [0.3, -0.7, 1.8],
      ];
      const points: Vec3[] = [
        [-70, 55, 45],
        [80, 60, 15],
        [28, -35, -67],
        [-104, 30, -93],
      ];
      const contact = probeContact({ phi: 3.3, z: -55, lift: 0, yaw: 0.107927, rock: -0.309003, tilt: 0.133669 }, CONVEX_C35, scene.torso);
      deformation.compression = contact;
      for (const r of [20, 30, 40, 50, 60, 80])
        points.push(deformation.toMaterial(pointOnLine(contact.frame, CONVEX_C35, 0, r), { ...sample, diaphragmCaudalMm: 10 }));
      let activeCompression = 0;
      for (const compressed of [false, true])
        for (const D of [0, 10, 30]) {
          deformation.compression = compressed ? contact : null;
          const resp = { ...sample, diaphragmCaudalMm: D };
          for (const m of points) {
            const p = deformation.toWorld(m, resp),
              w = anatomyWarpAt(scene, p, m, D, deformation.compression);
            if (compressed && Math.abs(w.shift) > 0.01 && w.respiratory && length(w.respiratory) > 0.01) activeCompression++;
            for (const n of normals) {
              const actual = warpNormal(w, n);
              const expected = gradient((q) => dot(n, deformation.toMaterial(q, resp)), p, 0.001);
              expect(error(actual, expected), `${compressed}/${D}/${String(m)}/${String(n)}`).toBeLessThan(0.003);
              expect(length(actual)).toBeLessThanOrEqual(warpBound(w) * length(n) + 1e-12);
            }
          }
        }
      expect(activeCompression).toBeGreaterThan(0);
    });
    it('OFF conserva exactamente la compresión y la traslación rígida no inclina normales', () => {
      const { scene, deformation, sample } = setup();
      const p: Vec3 = [0, 20, -40],
        n: Vec3 = [0.3, 0.4, 0.5];
      const off = { ...sample, diaphragmCaudalMm: 0 };
      expect(anatomyWarpAt(scene, p, p, off.diaphragmCaudalMm, null)).toEqual(warpAt(p, null));
      const contact = probeContact({ phi: 3.3, z: -55, lift: 0, yaw: 0.107927, rock: -0.309003, tilt: 0.133669 }, CONVEX_C35, scene.torso);
      const pressed = pointOnLine(contact.frame, CONVEX_C35, 0, 20);
      expect(anatomyWarpAt(scene, pressed, pressed, 0, contact)).toEqual(warpAt(pressed, contact));
      expect(warpNormal(anatomyWarpAt(scene, p, p, off.diaphragmCaudalMm, null), n)).toEqual(n);
      const resp = { ...sample, diaphragmCaudalMm: 10 };
      expect(warpNormal(anatomyWarpAt(scene, deformation.toWorld(p, resp), p, resp.diaphragmCaudalMm, null), n)).toEqual(n);
    });
  });
