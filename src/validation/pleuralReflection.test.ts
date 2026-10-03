import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { RespiratoryDeformation } from '../anatomy/deformation';
import { setReferenceBody } from '../anatomy/referenceBody';
import { anatomyWarpAt } from '../anatomy/respiratoryNormals';
import { AnatomyScene } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { dot, normalize, type Vec3 } from '../core/vec3';
import { PhysiologyEngine } from '../physiology/engine';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine } from '../probe/probe';
import { FRAG_TRANS_HITS } from '../ultrasound/shaders/passes.glsl';
import { MIRROR_DIRECTION_GLSL, mirrorDirection, transmissionHitsLine } from '../ultrasound/transmission';

const bytes = readFileSync(new URL('../anatomy/reference-body.bin', import.meta.url));
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
afterEach(() => setReferenceBody(undefined));
for (const reference of [false, true])
  it(`el espejo conserva la ley de reflexión en la superficie deformada (${reference ? 'referencia' : 'legado'})`, () => {
    setReferenceBody(reference ? profile : undefined);
    const scene = new AnatomyScene(NORMAL_ADULT);
    const deformation = new RespiratoryDeformation(scene);
    const engine = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas());
    engine.step();
    const contact = probeContact({ phi: 3.3, z: -55, lift: 0, yaw: 0.107927, rock: -0.309003, tilt: 0.133669 }, CONVEX_C35, scene.torso);
    let changed = 0,
      combined = 0;
    for (const compressed of [false, true])
      for (const D of [0, 10, 30]) {
        deformation.compression = compressed ? contact : null;
        const resp = { ...engine.sample.resp, diaphragmCaudalMm: D };
        const points: Vec3[] = [
          [-70, 55, 45],
          [28, -35, -67],
          [80, 60, 15],
        ];
        for (const depth of [20, 30, 40, 50]) points.push(deformation.toMaterial(pointOnLine(contact.frame, CONVEX_C35, 0, depth), resp));
        for (const m0 of points) {
          const n = normalize([0.3, -0.7, 1.8]);
          const p0 = deformation.toWorld(m0, resp);
          const field = (p: Vec3) => dot(n, deformation.toMaterial(p, resp)) - dot(n, m0);
          const h = 0.001;
          const gradient = (p: Vec3): Vec3 =>
            [0, 1, 2].map((j) => {
              const a: Vec3 = [...p],
                b: Vec3 = [...p];
              a[j] += h;
              b[j] -= h;
              return (field(a) - field(b)) / (2 * h);
            }) as Vec3;
          const incoming = normalize(gradient(p0).map((x, j) => x + [0.3, 0.1, -0.1][j]) as Vec3);
          const origin = p0.map((x, j) => x - 2 * incoming[j]) as Vec3;
          let warpCalls = 0;
          const got = transmissionHitsLine(
            {
              at: (p) => ({ tissue: field(p) >= 0 ? Tissue.Lung : Tissue.Liver, normal: n, curtain: false }),
              behind: () => Tissue.Liver,
              insideWall: () => -1,
              curtainEdge: () => null,
              warpAt: (p) => {
                warpCalls++;
                return anatomyWarpAt(scene, p, deformation.toMaterial(p, resp), D, deformation.compression);
              },
            },
            origin,
            incoming,
            4,
            32,
            () => 0,
          );
          expect(got.mirrorSeg).toBeGreaterThanOrEqual(0);
          expect(warpCalls).toBe(1);
          const hit = origin.map((x, j) => x + got.mirrorR * incoming[j]) as Vec3;
          const worldNormal = normalize(gradient(hit));
          const expected = incoming.map((x, j) => x - 2 * dot(incoming, worldNormal) * worldNormal[j]);
          const error = Math.hypot(...got.dir.map((x, j) => x - expected[j]));
          expect(error, `${compressed}/${D}/${String(m0)}`).toBeLessThan(0.003);
          expect(Math.abs(Math.hypot(...got.dir) - 1)).toBeLessThan(1e-10);
          const old = incoming.map((x, j) => x - 2 * dot(incoming, n) * n[j]);
          if (Math.hypot(...old.map((x, j) => x - expected[j])) > 0.05) {
            changed++;
            if (compressed && D > 0) combined++;
          }
        }
      }
    expect(changed).toBeGreaterThan(5);
    expect(combined).toBeGreaterThan(0);
  });

it('A0 usa el transporte solo al cerrar el impacto y conserva el espejo rígido', () => {
  expect(FRAG_TRANS_HITS).toContain(MIRROR_DIRECTION_GLSL);
  expect(FRAG_TRANS_HITS).toContain('dir = mirrorDirection(dir, nn, anatomyWarpAt(hitPoint, toMaterial(hitPoint)));');
  const n: Vec3 = [0, 0, 1],
    dir = normalize([1, 2, 3]);
  expect(mirrorDirection(dir, n)).toEqual([dir[0], dir[1], -dir[2]]);
  expect(mirrorDirection(dir, [0, 0, -1])).toEqual(mirrorDirection(dir, n));
});
