import { ABDOMINAL_ATLAS, ABDOMINAL_BODY } from '../../abdominalAtlasData';
import { loadPinnedGzip, sha256 } from '../../loadPinnedAsset';
import type { InstalledPerson } from '../../person';
import { validateReferenceBody } from '../../referenceBody';
import { THORACIC_ATLAS } from '../../thoracicAtlasData';
import { installDefaultCpu } from './cpu';

export async function loadPerson(signal: AbortSignal, legacy: boolean, reference: boolean): Promise<InstalledPerson> {
  let abdominal: Uint16Array | undefined,
    thoracic: Uint16Array | undefined,
    body: Float32Array | undefined,
    registered: Float32Array | undefined;
  if (!legacy) {
    abdominal = new Uint16Array(
      await loadPinnedGzip(new URL('../../abdominal-atlas.gzip.bin?no-inline', import.meta.url), ABDOMINAL_ATLAS, { signal }),
    );
    thoracic = new Uint16Array(
      await loadPinnedGzip(new URL('../../thoracic-atlas.gzip.bin?no-inline', import.meta.url), THORACIC_ATLAS, { signal }),
    );
    const response = await fetch(new URL('../../abdominal-body.bin?no-inline', import.meta.url), { signal });
    if (!response.ok) throw new Error(`Perfil abdominal: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== ABDOMINAL_BODY.bytes || (await sha256(bytes)) !== ABDOMINAL_BODY.sha256)
      throw new Error('Perfil abdominal alterado');
    body = validateReferenceBody(new Float32Array(bytes.buffer));
  }
  if (reference) {
    const response = await fetch(new URL('../../reference-body.bin?no-inline', import.meta.url), { signal });
    if (!response.ok) throw new Error(`Referencia corporal: HTTP ${response.status}`);
    registered = validateReferenceBody(new Float32Array(await response.arrayBuffer()));
  }
  signal.throwIfAborted();
  return Object.freeze({
    ...installDefaultCpu({ abdominal, thoracic, body, reference: registered }, legacy),
    gpu: Object.freeze({ specializeFragment: (source: string) => source, uploads: [] }),
    loadSurfaces: async () => (await import('./surfaces')).loadSurfaces(signal),
  });
}
