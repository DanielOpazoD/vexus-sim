import { ABDOMINAL_ATLAS, ABDOMINAL_BODY, ABDOMINAL_FIELDS } from '../../abdominalAtlasData';
import { freezeDescriptor, installPersonAssets, type PersonAssetDescriptor, type PersonBuffers } from '../../personAssets';
import { THORACIC_ATLAS } from '../../thoracicAtlasData';

export const DEFAULT_ASSETS = freezeDescriptor({
  identity: {
    person: 'current',
    frameId: 'registered-las-v1',
    revision: 'current',
    schemaVersion: 1,
    manifestSha256: ABDOMINAL_BODY.sha256,
  },
  abdominal: ABDOMINAL_ATLAS,
  thoracic: THORACIC_ATLAS,
  fields: ABDOMINAL_FIELDS,
  thoracicField: {
    originMm: THORACIC_ATLAS.originMm,
    dimensions: THORACIC_ATLAS.textureDimensions,
    offset: [0, 0, 0],
    pitchMm: THORACIC_ATLAS.pitchMm,
  },
  dome: true,
  thoracicMaterials: THORACIC_ATLAS.materials,
} as const satisfies PersonAssetDescriptor);

export const LEGACY_ASSETS = freezeDescriptor({
  identity: { person: 'legacy', frameId: 'procedural-las-v1', revision: 'current', schemaVersion: 1, manifestSha256: '' },
  fields: [],
} as const satisfies PersonAssetDescriptor);

export function installDefaultAssets(buffers: PersonBuffers, legacy = false) {
  return installPersonAssets(legacy ? LEGACY_ASSETS : DEFAULT_ASSETS, buffers);
}
