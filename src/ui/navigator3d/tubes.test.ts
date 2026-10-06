import { expect, it } from 'vitest';
import type { Mesh } from 'three';
import { type AnatomyScene, BASELINE_CALIBER } from '../../anatomy/scene';
import { CM } from './common';
import { buildVessels } from './tubes';

it('pelvic vessel remains at its acoustic source coordinates in the complete atlas', () => {
  const scene = {
    hasAbdominalAtlas: true,
    vessels: [
      {
        id: 'externalIliacArteryRight',
        tube: {
          apScale: 1,
          nodes: [
            { p: [-35, -40, -300], r: 4 },
            { p: [-45, -30, -390], r: 3 },
          ],
        },
      },
    ],
  } as unknown as AnatomyScene;
  const mesh = buildVessels(scene, BASELINE_CALIBER).children[0] as Mesh;
  mesh.geometry.computeBoundingBox();
  expect(mesh.geometry.boundingBox!.min.z / CM).toBeLessThan(-385);
  expect(mesh.geometry.boundingBox!.max.z / CM).toBeLessThan(-295);
  mesh.geometry.dispose();
});
