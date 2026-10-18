import { expect, it } from 'vitest';
import { cutMapDirections, cutMapPoint } from '../ui/cutMapGeometry';
import { CONVEX_C35, pointOnLine, probeFrame } from '../probe/probe';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';

it('cada centro de la rejilla 96×128 conserva exactamente el rayo adquirido al trasladar y angular la sonda', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  let points = 0,
    mismatches = 0;
  for (const pose of [
    { phi: 1.5, z: -40, yaw: 0, rock: 0, tilt: 0, lift: 0 },
    { phi: 3.9, z: -140, yaw: 1.2, rock: -0.3, tilt: 0.5, lift: -2 },
    { phi: -1.55, z: 180, yaw: -2, rock: 1.1, tilt: -0.8, lift: 4 },
  ]) {
    const frame = probeFrame(pose, CONVEX_C35, scene.torso);
    const directions = cutMapDirections(frame, CONVEX_C35, 96);
    for (let v = 0; v < 128; v++)
      for (let u = 0; u < 96; u++) {
        const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * (u + 0.5)) / 96;
        const depth = (180 * (v + 0.5)) / 128;
        const expected = pointOnLine(frame, CONVEX_C35, theta, depth);
        const actual = cutMapPoint(frame.curvatureCenter, directions[u], CONVEX_C35.curvatureRadius + depth);
        if (actual.some((x, i) => !Object.is(x, expected[i]))) mismatches++;
        points++;
      }
  }
  expect(points).toBe(36864);
  expect(mismatches).toBe(0);
});
