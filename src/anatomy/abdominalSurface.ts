import { THORACIC_SURFACE } from './thoracicSurfaceData';
import { ABDOMINAL_SURFACE } from './abdominalSurfaceData';
import { loadPinnedGzip } from './loadAbdominalAtlas';
export let thoracicSurface: Float32Array | undefined;
export let abdominalSurface: Float32Array | undefined;
/** Deferred with the navigator; surface extraction is offline, not a million runtime field queries. */
export async function loadAbdominalSurface(): Promise<void> {
  thoracicSurface ??= new Float32Array(
    await loadPinnedGzip(new URL('./thoracic-surface.gzip.bin?no-inline', import.meta.url), THORACIC_SURFACE),
  );
  abdominalSurface ??= new Float32Array(
    await loadPinnedGzip(new URL('./abdominal-surface.gzip.bin?no-inline', import.meta.url), ABDOMINAL_SURFACE),
  );
}
