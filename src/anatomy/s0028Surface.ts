import { sha256 } from './loadPinnedAsset';
import { S0028_BUNDLE as B } from './people/s0028/descriptor';
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
    meta.format !== 'indexed-delta32-v1' ||
    meta.sourceBundleSha256 !== (await sha256(new TextEncoder().encode(JSON.stringify(B)))) ||
    meta.fields.length !== B.fields.length ||
    meta.fields.some((f, i) => f.name !== B.fields[i].name || f.asset !== B.fields[i].asset)
  )
    throw new Error('Superficies s0028: procedencia, marco o inventario alterados');
}
const decoded = new WeakSet<ArrayBuffer>();
export function indexedSurfaces(raw: ArrayBuffer): IndexedSourceSurface[] {
  if (raw.byteLength !== M.rawBytes) throw new Error('Superficies s0028 incompletas');
  if (decoded.has(raw)) throw new Error('Superficies s0028 ya descodificadas');
  decoded.add(raw);
  // El buffer verificado es exclusivo del cargador: se transforma una sola vez, in-place.
  // Deltas de bits por eje, no de valores Float32: conserva hasta los triángulos casi degenerados.
  return M.fields.map((f) => {
    const bits = new Uint32Array(raw, f.positionOffset, f.vertexCount * 3);
    for (let axis = 0; axis < 3; axis++) {
      let previous = 0;
      for (let i = axis; i < bits.length; i += 3) {
        previous = (previous + bits[i]) >>> 0;
        bits[i] = previous;
      }
    }
    const indices = new Uint32Array(raw, f.indexOffset, f.indexCount);
    let previous = 0;
    for (let i = 0; i < indices.length; i++) {
      const zigzag = indices[i];
      previous += (zigzag >>> 1) ^ -(zigzag & 1);
      if (previous < 0 || previous >= f.vertexCount) throw new Error('Superficies s0028: índice fuera de malla');
      indices[i] = previous;
    }
    return {
      name: f.name,
      asset: f.asset,
      positions: new Float32Array(raw, f.positionOffset, f.vertexCount * 3),
      indices,
    };
  });
}
