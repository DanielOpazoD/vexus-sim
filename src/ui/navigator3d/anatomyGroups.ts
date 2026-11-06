import type * as THREE from 'three';
import type { PersonSurfaces } from '../../anatomy/person';
import type { AnatomyScene, VesselCaliber } from '../../anatomy/scene';
import { buildSkeleton, buildSkin } from './body';
import { buildWindowMarks } from './labels';
import { buildOrgans } from './organs';
import { buildVessels } from './tubes';

export function buildAnatomyGroups(
  a: AnatomyScene,
  caliber: VesselCaliber,
  surfaces: PersonSurfaces = {},
): {
  skin: THREE.Mesh;
  skeleton: THREE.Group;
  organs: THREE.Group;
  vessels: THREE.Group;
  windows: THREE.Group;
} {
  return {
    skin: buildSkin(a),
    skeleton: buildSkeleton(a, surfaces),
    organs: buildOrgans(a, surfaces),
    vessels: buildVessels(a, caliber),
    windows: buildWindowMarks(a),
  };
}

/** Libera geometrías, materiales y texturas de un subárbol de three.js. */
