import { S0028_BUNDLE as B } from './anatomyBundle';
import { sha256 } from './loadAbdominalAtlas';
import { S0028_SURFACE as M } from './s0028SurfaceData';

export interface IndexedSourceSurface {
  name: string;
  asset: 'abdominal' | 'thoracic';
  positions: Float32Array;
  indices: Uint32Array;
}
/** B includes CT, frame, units via pitch/origins, full inventory and both source hashes. */
export async function verifySurfaceProvenance(
  meta: {
    person: string;
    frameId: string;
    revision: string;
    units: string;
    format: string;
    sourceBundleSha256: string;
    fields: readonly { name: string; asset: string }[];
  } = M,
): Promise<void> {
  if (
    meta.person !== B.person ||
    meta.frameId !== B.frameId ||
    meta.revision !== B.revision ||
    meta.units !== 'mm' ||
    meta.format !== 'indexed-f32-u32-v1' ||
    meta.sourceBundleSha256 !== (await sha256(new TextEncoder().encode(JSON.stringify(B)))) ||
    meta.fields.length !== B.fields.length ||
    meta.fields.some((f, i) => f.name !== B.fields[i].name || f.asset !== B.fields[i].asset)
  )
    throw new Error('Superficies s0028: procedencia, marco o inventario alterados');
}
export function indexedSurfaces(raw: ArrayBuffer): IndexedSourceSurface[] {
  if (raw.byteLength !== M.rawBytes) throw new Error('Superficies s0028 incompletas');
  return M.fields.map((f) => ({
    name: f.name,
    asset: f.asset,
    positions: new Float32Array(raw, f.positionOffset, f.vertexCount * 3),
    indices: new Uint32Array(raw, f.indexOffset, f.indexCount),
  }));
}
