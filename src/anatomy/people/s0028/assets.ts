import { ABDOMINAL_FIELDS } from '../../abdominalAtlasData';
import { freezeDescriptor, installPersonAssets, type PersonAssetDescriptor, type PersonBuffers } from '../../personAssets';
import { S0028_BUNDLE as B } from './descriptor';

export const S0028_ASSETS = freezeDescriptor({
  identity: { person: B.person, frameId: B.frameId, revision: B.revision, schemaVersion: 1, manifestSha256: B.manifest.sha256 },
  abdominal: B.abdominal,
  thoracic: B.thoracic,
  fields: ABDOMINAL_FIELDS.map((field) => B.fields.find((f) => f.name === field.name)),
  thoracicField: B.fields.find((f) => f.name === 'thoracicBone')!,
  labelModulus: 128,
  thoracicMaterials: Array.from({ length: 38 }, (_, i) => (i >= 25 && i <= 36 ? 2 : i > 0 ? 0 : -1)),
  capacityBytes: B.capacity.rawBytes,
  skinBytes: B.skin.rawBytes,
} satisfies PersonAssetDescriptor);

export function installS0028Assets(buffers: PersonBuffers) {
  return installPersonAssets(S0028_ASSETS, buffers);
}
