import type { PersonAssets } from '../../personAssets';
/** @twin trabajador-corte */
import type { Vec3 } from '../../../core/vec3';
import type { AnatomyPerson, InstalledCpuPerson } from '../../person';
import type { PersonBuffers } from '../../personAssets';
import { createAbdominalQueries, createThoracicQueries } from '../../personAtlas';
import { installS0028Assets } from './assets';
import { createSourceQueries } from './atlas';
import { classifyInside, classifyWall } from './classifier';
import { createSolidsQueries } from './solids';
import { createWallQueries } from './wall';
import { GASTRIC_WALL } from '../../organs/abdomen';

/** s0028 está en pausa: su estómago conserva las capas de la decisión 312 (la 332 engrosa la muscular solo por defecto). */
export const GASTRIC_312 = { ...GASTRIC_WALL, muscularisMm: 1.2, submucosaMm: 2.8, submucosaFoldMm: 0.4 };

/** Política digestiva de esta persona. @twin s0028-digestivo */
export function digestiveWallMm(label: number): number {
  return label === 1 ? 3 : label === 4 ? 2.5 : 2;
}
/** Gas de la máscara de esta persona. @twin s0028-digestivo */
export function digestiveGasPlane(point: Vec3, sourceGas: (point: Vec3) => boolean): number {
  return sourceGas(point) ? 1 : -1;
}

/** Entrada CPU del Worker: no instala estado de módulo ni importa carga de red, vistas o GLSL. */
/** @twin trabajador-corte */
export function installS0028Cpu(buffers: PersonBuffers): InstalledCpuPerson {
  const assets = installS0028Assets(buffers);
  return createS0028Cpu(assets);
}

export function createS0028Cpu(assets: PersonAssets): InstalledCpuPerson {
  const source = createSourceQueries(assets);
  const regional = Object.freeze({ ...source, ...createWallQueries(assets, source), ...createSolidsQueries(assets) });
  const cpu: AnatomyPerson = {
    classifyInside,
    classifyWall,
    assets,
    atlas: Object.freeze({ ...createAbdominalQueries(assets), ...createThoracicQueries(assets) }),
    skinMm: 1.5,
    regional,
    fitBody: (profile) => profile,
    digestiveWallMm,
    digestiveGas: (point) => digestiveGasPlane(point, source.sourceGas),
    isColon: (label) => label === 4,
    gastricWall: GASTRIC_312,
  };
  return Object.freeze({ identity: assets.identity, assetKey: assets.assetKey, assets, cpu: Object.freeze(cpu) });
}
