import { anatomyBundle } from '../anatomy/anatomyBundle';
import { loadPinnedGzip } from '../anatomy/loadAbdominalAtlas';
import { S0028_SURFACE } from '../anatomy/s0028SurfaceData';
import { indexedSurfaces, verifySurfaceProvenance, type IndexedSourceSurface } from '../anatomy/s0028Surface';
import { markStartup } from '../app/startupTrace';
export let s0028Surfaces: readonly IndexedSourceSurface[] = [];
export async function loadS0028Surfaces(signal: AbortSignal): Promise<void> {
  if (anatomyBundle.person !== 's0028') throw new Error('Superficies de otra persona');
  signal.throwIfAborted();
  markStartup('surfaces:begin');
  await verifySurfaceProvenance();
  const raw = await loadPinnedGzip(new URL('../anatomy/s0028/surfaces.gzip.bin?no-inline', import.meta.url), S0028_SURFACE, {
    signal,
    rawLimit: 64143792,
    gzipLimit: 25000000,
  });
  signal.throwIfAborted();
  s0028Surfaces = indexedSurfaces(raw);
  markStartup('surfaces:ready');
}
