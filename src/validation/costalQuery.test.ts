import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { ribCentre, ribDistanceLowerBound, sdRib } from '../anatomy/primitives';
import { setReferenceBody, validateReferenceBody } from '../anatomy/referenceBody';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';

const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = validateReferenceBody(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
function minimum(scene: AnatomyScene, p: Vec3, prune: boolean) {
  let any = 1e3,
    bone = 1e3,
    calls = 0,
    inside = -1;
  for (const [i, rib] of scene.ribs.entries()) {
    if (prune && !rib.sourceCartilage && ribDistanceLowerBound(p, rib) > Math.max(any, bone) + 0.01) continue;
    const result = sdRib(p, rib, scene.torso, scene.spine);
    calls++;
    if (result.d < 0) {
      inside = i;
      return { any: result.d, bone, inside, cartilage: result.cartilage, calls };
    }
    any = Math.min(any, result.d);
    if (!result.cartilage) bone = Math.min(bone, result.d);
  }
  return { any, bone, inside, cartilage: false, calls };
}
describe('descarte costal conservador frente a todos los arcos', () => {
  it('conserva mínimos y primer interior en ambos cuerpos, superficies y extremos libres', () => {
    for (const reference of [false, true]) {
      setReferenceBody(reference ? profile : undefined);
      try {
        const scene = new AnatomyScene(NORMAL_ADULT);
        const points: Vec3[] = [];
        for (let x = -220; x <= 220; x += 20)
          for (let y = -150; y <= 150; y += 25) for (let z = -180; z <= 220; z += 20) points.push([x, y, z]);
        for (const rib of scene.ribs)
          for (const phi of [0, 0.2, 1.57, 2, 2.8, 3.14, 4, 4.7, 5.5, rib.frontPhi ?? 0])
            for (const side of [-1, 1]) {
              const q = ribCentre(phi, rib, scene.torso);
              q[0] *= side;
              for (const delta of [-rib.halfWidth, -0.001, 0, 0.001, rib.halfWidth]) points.push([q[0], q[1], q[2] + delta]);
            }
        let bruteCalls = 0,
          prunedCalls = 0;
        for (const p of points) {
          const brute = minimum(scene, p, false),
            pruned = minimum(scene, p, true);
          bruteCalls += brute.calls;
          prunedCalls += pruned.calls;
          const { calls: _b, ...a } = brute,
            { calls: _p, ...b } = pruned;
          expect(b).toEqual(a);
          for (const rib of scene.ribs.filter((r) => !r.sourceCartilage))
            expect(ribDistanceLowerBound(p, rib)).toBeLessThanOrEqual(sdRib(p, rib, scene.torso, scene.spine).d + 1e-9);
        }
        expect(prunedCalls).toBeLessThan(bruteCalls);
        console.info(JSON.stringify({ reference, points: points.length, bruteCalls, prunedCalls }));
      } finally {
        setReferenceBody();
      }
    }
  });
});
