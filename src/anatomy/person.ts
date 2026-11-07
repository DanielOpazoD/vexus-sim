import type { Vec3 } from '../core/vec3';
import type { createSourceQueries } from './people/s0028/atlas';
import type { createSolidsQueries } from './people/s0028/solids';
import type { createWallQueries } from './people/s0028/wall';
import type { PersonAssets, PersonIdentity } from './personAssets';
import type { createAbdominalQueries, createThoracicQueries } from './personAtlas';
import type { IndexedSourceSurface } from './s0028Surface';
import type { AnatomyScene } from './scene';

export interface AnatomyPerson {
  readonly classifyInside: (
    scene: AnatomyScene,
    ...args: Parameters<AnatomyScene['classifyInside']>
  ) => ReturnType<AnatomyScene['classifyInside']>;
  readonly classifyWall: (
    scene: AnatomyScene,
    ...args: Parameters<AnatomyScene['classifyWall']>
  ) => ReturnType<AnatomyScene['classifyWall']>;
  readonly assets: PersonAssets;
  readonly atlas: ReturnType<typeof createAbdominalQueries> & ReturnType<typeof createThoracicQueries>;
  readonly skinMm: number;
  readonly regional?: ReturnType<typeof createSourceQueries> &
    ReturnType<typeof createWallQueries> &
    ReturnType<typeof createSolidsQueries>;
  readonly fitBody: (profile: Float32Array, wallMm: number, skinMm: number) => Float32Array;
  readonly digestiveWallMm: (label: number) => number;
  readonly digestiveGas: (point: Vec3, label: number) => number;
  readonly isColon: (label: number) => boolean;
  /** Marco nuevo (copia propia) del riñón derecho del atlas cuando la persona lo mueve (decisión 329); sin él, el de la escena. */
  readonly kidneyRightFrame?: () => { center: Vec3; u: Vec3; v: Vec3; w: Vec3 };
}

export interface AtlasUpload {
  readonly offset: readonly number[];
  readonly size: readonly number[];
  readonly data: Uint16Array;
}

export interface PersonGpuPlan {
  readonly specializeFragment: (source: string) => string;
  readonly uploads: readonly AtlasUpload[];
}

export interface InstalledCpuPerson {
  readonly identity: PersonIdentity;
  readonly assetKey: string;
  readonly assets: PersonAssets;
  readonly cpu: AnatomyPerson;
}

export interface PersonSurfaces {
  readonly abdominal?: Float32Array;
  readonly thoracic?: Float32Array;
  readonly indexed?: readonly IndexedSourceSurface[];
}

export interface InstalledPerson extends InstalledCpuPerson {
  readonly loadSurfaces: () => Promise<PersonSurfaces>;
  readonly gpu: PersonGpuPlan;
}
