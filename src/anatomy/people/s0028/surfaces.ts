import { loadPinnedGzip } from '../../loadPinnedAsset';
import type { PersonSurfaces } from '../../person';
import { indexedSurfaces, verifySurfaceProvenance } from '../../s0028Surface';
import { S0028_SURFACE } from '../../s0028SurfaceData';
export async function loadSurfaces(signal: AbortSignal): Promise<PersonSurfaces> {
  signal.throwIfAborted();
  await verifySurfaceProvenance();
  const raw = await loadPinnedGzip(new URL('../../s0028/surfaces.gzip.bin?no-inline', import.meta.url), S0028_SURFACE, {
    signal,
    rawLimit: 64143792,
    gzipLimit: 25000000,
  });
  signal.throwIfAborted();
  return Object.freeze({ indexed: indexedSurfaces(raw) });
}
