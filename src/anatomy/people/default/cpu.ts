import { hepaticCostalBody } from '../../hepaticCostalWall';
import { digestiveGasPlane, digestiveWallMm } from '../../organs/abdomen';
import type { Vec3 } from '../../../core/vec3';
import type { AnatomyPerson, InstalledCpuPerson } from '../../person';
import type { PersonAssets, PersonBuffers } from '../../personAssets';
import { createAbdominalQueries, createThoracicQueries } from '../../personAtlas';
import { orthonormalBasis } from '../../primitives';
import { installDefaultAssets } from './assets';
import { KIDNEY_FRAMES } from './kidneyFrames';
import { classifyInside, classifyWall } from './classifier';

const KIDNEY_BASES = KIDNEY_FRAMES.map((f) => [orthonormalBasis(f.source.long, f.source.hilumHint), orthonormalBasis(f.long, f.hilumHint)]);
/** El punto del riñón movido (campos 5 y 6) que corresponde a p con el riñón en su marco fuente; los demás campos, p. */
export function kidneyAtSource(p: Vec3, field: number): Vec3 {
  const f = KIDNEY_FRAMES[field - 5];
  if (!f) return p;
  const [s, m] = KIDNEY_BASES[field - 5],
    d = [0, 1, 2].map((i) => p[i] - f.source.center[i]),
    q = [s.u, s.v, s.w].map((a) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2]);
  return [0, 1, 2].map((i) => f.center[i] + q[0] * m.u[i] + q[1] * m.v[i] + q[2] * m.w[i]) as Vec3;
}

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
    // Decisión 330: el ajuste parietal (183, 222) se calibró sobre los riñones del atlas en su posición fuente; moverlos no
    // mueve la piel (con la 329 la piel del flanco posterior derecho salía hasta 9 mm)
    fitBody: (profile, wallMm, skinMm) => hepaticCostalBody(profile, wallMm, skinMm, cpu, kidneyAtSource),
    digestiveWallMm,
    digestiveGas: digestiveGasPlane,
    isColon: (label) => label >= 5 && label <= 9,
    // Decisiones 329 y 330: los dos riñones del atlas, movidos con su campo bajo el hígado y el bazo
    // (`tools/anatomy/move-kidneys.ts`, que genera estos marcos)
    kidneyFrame: (side) => {
      const f = KIDNEY_FRAMES[side];
      return { center: [...f.center] as Vec3, ...orthonormalBasis(f.long, f.hilumHint) };
    },
  };
  return Object.freeze({ identity: assets.identity, assetKey: assets.assetKey, assets, cpu: Object.freeze(cpu) });
}
