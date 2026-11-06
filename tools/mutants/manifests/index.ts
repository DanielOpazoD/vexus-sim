/** Manifiestos de mutantes, uno por módulo (decisión 322, punto 8). Un módulo nuevo se añade aquí. */
import type { MutantManifest } from '../manifest';
import { contact } from './contact';
import { cutMapWorker } from './cutMapWorker';
import { s0028Classifier } from './s0028Classifier';
import { s0028Solids } from './s0028Solids';
import { s0028Wall } from './s0028Wall';
import { s0028WallGlsl } from './s0028WallGlsl';
import { scene } from './scene';
import { structureIdentity } from './structureIdentity';

export const MANIFESTS: readonly MutantManifest[] = [
  contact,
  s0028Wall,
  s0028WallGlsl,
  s0028Solids,
  scene,
  s0028Classifier,
  cutMapWorker,
  structureIdentity,
];
