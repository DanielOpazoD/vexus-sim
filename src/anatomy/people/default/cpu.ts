import { hepaticCostalBody } from '../../hepaticCostalWall';
import { digestiveGasPlane, digestiveWallMm } from '../../organs/abdomen';
import type { AnatomyPerson, InstalledCpuPerson } from '../../person';
import type { PersonAssets, PersonBuffers } from '../../personAssets';
import { createAbdominalQueries, createThoracicQueries } from '../../personAtlas';
import { orthonormalBasis } from '../../primitives';
import { installDefaultAssets } from './assets';
import { classifyInside, classifyWall } from './classifier';

export function installDefaultCpu(buffers: PersonBuffers, legacy = false): InstalledCpuPerson {
  const assets = installDefaultAssets(buffers, legacy);
  return createDefaultCpu(assets);
}

export function createDefaultCpu(assets: PersonAssets): InstalledCpuPerson {
  const cpu: AnatomyPerson = {
    classifyInside,
    classifyWall,
    assets,
    atlas: Object.freeze({ ...createAbdominalQueries(assets), ...createThoracicQueries(assets) }),
    skinMm: 2,
    fitBody: (profile, wallMm, skinMm) => hepaticCostalBody(profile, wallMm, skinMm, cpu),
    digestiveWallMm,
    digestiveGas: digestiveGasPlane,
    isColon: (label) => label >= 5 && label <= 9,
    // Decisión 329: el riñón derecho del atlas, inclinado (coronal 12°, sagital −29,5°), 7 mm más alto (por debajo del
    // izquierdo) y 18 mm más atrás, fuera del colon; el campo se movió con él (`tools/anatomy/move-right-kidney.ts`).
    kidneyRightFrame: () => ({
      center: [-66.1862655, -50.3988, -138.5475],
      ...orthonormalBasis([0.18191302, -0.48420729, 0.85583348], [0.96209555, 0.26747979, -0.05316694]),
    }),
  };
  return Object.freeze({ identity: assets.identity, assetKey: assets.assetKey, assets, cpu: Object.freeze(cpu) });
}
