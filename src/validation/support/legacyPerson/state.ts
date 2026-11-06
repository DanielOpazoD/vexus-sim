import type { LEGACY_BUNDLE } from '../../../anatomy/anatomyBundle';
import { CURRENT_BUNDLE } from '../../../anatomy/anatomyBundle';
import { DEFAULT_ASSETS, LEGACY_ASSETS } from '../../../anatomy/people/default/assets';
import { createDefaultCpu } from '../../../anatomy/people/default/cpu';
import { S0028_ASSETS } from '../../../anatomy/people/s0028/assets';
import { createS0028Cpu } from '../../../anatomy/people/s0028/cpu';
import type { S0028_BUNDLE } from '../../../anatomy/people/s0028/descriptor';
import type { InstalledCpuPerson, InstalledPerson } from '../../../anatomy/person';
import { installPersonAssets, type PersonAssetDescriptor, type PersonBuffers } from '../../../anatomy/personAssets';
export let anatomyBundle: typeof CURRENT_BUNDLE | typeof LEGACY_BUNDLE | typeof S0028_BUNDLE = CURRENT_BUNDLE;
export let buffers: PersonBuffers = {};
let cached: InstalledCpuPerson | undefined;
export function select(bundle: typeof anatomyBundle): void {
  anatomyBundle = bundle;
  cached = undefined;
}
export function stage(next: Partial<PersonBuffers>): void {
  buffers = { ...buffers, ...next };
  cached = undefined;
}
export function stageChecked(next: Partial<PersonBuffers>): void {
  const previous = buffers,
    installed = cached;
  stage(next);
  try {
    fixturePerson();
  } catch (error) {
    buffers = previous;
    cached = installed;
    throw error;
  }
}
/** Partial readers are unit-test fixtures; the app/Worker always use pinned complete installers. */
export function fixturePerson(): InstalledCpuPerson {
  if (cached) return cached;
  const template: PersonAssetDescriptor =
    anatomyBundle.person === 's0028' ? S0028_ASSETS : anatomyBundle.person === 'legacy' ? LEGACY_ASSETS : DEFAULT_ASSETS;
  const descriptor: PersonAssetDescriptor = {
    ...template,
    abdominal: buffers.abdominal ? template.abdominal : undefined,
    thoracic: buffers.thoracic ? template.thoracic : undefined,
    capacityBytes: buffers.capacity?.byteLength,
    skinBytes: buffers.skin?.byteLength,
  };
  const assets = installPersonAssets(descriptor, buffers);
  cached = anatomyBundle.person === 's0028' ? createS0028Cpu(assets) : createDefaultCpu(assets);
  return cached;
}
export function fixtureInstalled(): InstalledPerson {
  return { ...fixturePerson(), gpu: { specializeFragment: (source) => source, uploads: [] }, loadSurfaces: () => Promise.resolve({}) };
}
