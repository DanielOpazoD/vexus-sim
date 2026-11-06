import { ABDOMINAL_SURFACE } from '../../abdominalSurfaceData';
import { loadPinnedGzip } from '../../loadPinnedAsset';
import type { PersonSurfaces } from '../../person';
import { THORACIC_SURFACE } from '../../thoracicSurfaceData';
export async function loadSurfaces(signal: AbortSignal): Promise<PersonSurfaces> {
  const thoracic = new Float32Array(
    await loadPinnedGzip(new URL('../../thoracic-surface.gzip.bin?no-inline', import.meta.url), THORACIC_SURFACE, { signal }),
  );
  const abdominal = new Float32Array(
    await loadPinnedGzip(new URL('../../abdominal-surface.gzip.bin?no-inline', import.meta.url), ABDOMINAL_SURFACE, { signal }),
  );
  return Object.freeze({ thoracic, abdominal });
}
