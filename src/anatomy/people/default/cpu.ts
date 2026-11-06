import { hepaticCostalBody } from '../../hepaticCostalWall';
import { digestiveGasPlane, digestiveWallMm } from '../../organs/abdomen';
import type { AnatomyPerson, InstalledCpuPerson } from '../../person';
import type { PersonAssets, PersonBuffers } from '../../personAssets';
import { createAbdominalQueries, createThoracicQueries } from '../../personAtlas';
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
  };
  return Object.freeze({ identity: assets.identity, assetKey: assets.assetKey, assets, cpu: Object.freeze(cpu) });
}
