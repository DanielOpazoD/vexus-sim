import { ABDOMINAL_BODY } from './abdominalAtlasData';
import { setAbdominalBody, validateReferenceBody } from './referenceBody';
import { anatomyBundle, installAnatomyBundle, S0028_BUNDLE as B } from './anatomyBundle';
import { loadPinnedGzip, sha256 } from './loadAbdominalAtlas';
import { setAbdominalAtlas } from './abdominalAtlas';
import { setThoracicAtlas } from './thoracicAtlas';
import { setS0028Wall } from './s0028Wall';

let loading = false;
export let s0028Auxiliary: { capacity: ArrayBuffer; skin: ArrayBuffer } | undefined;
/** The pinned manifest fixes provenance, frame and dimensions; self-consistent foreign metadata cannot replace it. */
export async function verifyS0028Manifest(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  if (bytes.length !== B.manifest.bytes || (await sha256(bytes)) !== B.manifest.sha256)
    throw new Error('Paquete s0028: marco, dimensiones o procedencia alterados');
}
export async function loadS0028(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (loading || anatomyBundle.person === 's0028') throw new Error('Carga de persona ya iniciada; recargue');
  loading = true;
  try {
    const manifest = await fetch(new URL('./s0028/candidate-manifest.bin?no-inline', import.meta.url), { signal });
    if (!manifest.ok) throw new Error('Paquete s0028: HTTP ' + manifest.status);
    await verifyS0028Manifest(new Uint8Array(await manifest.arrayBuffer()));
    const options = { signal, rawLimit: 139921010, gzipLimit: 19510002 };
    // Serie: no overlap of gzip staging/hash copies from the two atlases.
    const abdomen = await loadPinnedGzip(new URL('./s0028/abdominal-direct.gzip.bin?no-inline', import.meta.url), B.abdominal, options);
    const thorax = await loadPinnedGzip(new URL('./s0028/thoracic-direct.gzip.bin?no-inline', import.meta.url), B.thoracic, {
      ...options,
      rawLimit: 60413664,
    });
    const capacity = await loadPinnedGzip(new URL('./s0028/annotation-capacity.gzip.bin?no-inline', import.meta.url), B.capacity, options);
    const skin = await loadPinnedGzip(new URL('./s0028/skin-polar.gzip.bin?no-inline', import.meta.url), B.skin, options);
    const bodyResponse = await fetch(new URL('./abdominal-body.bin?no-inline', import.meta.url), { signal });
    if (!bodyResponse.ok) throw new Error('Perfil provisional: HTTP ' + bodyResponse.status);
    const body = new Uint8Array(await bodyResponse.arrayBuffer());
    if (body.length !== ABDOMINAL_BODY.bytes || (await sha256(body)) !== ABDOMINAL_BODY.sha256)
      throw new Error('Perfil provisional alterado');
    const profile = validateReferenceBody(new Float32Array(body.buffer));
    signal.throwIfAborted();
    if (
      B.abdominal.rawBytes + B.capacity.rawBytes - 1179648 + B.skin.rawBytes + B.manifest.bytes + 960 > 139921010 ||
      B.thoracic.rawBytes + 1179648 > 60413664
    )
      throw new Error('Paquete s0028 excede su techo exclusivo');
    installAnatomyBundle(B);
    setAbdominalBody(profile);
    setAbdominalAtlas(new Uint16Array(abdomen));
    setThoracicAtlas(new Uint16Array(thorax));
    setS0028Wall(capacity, skin);
    s0028Auxiliary = { capacity, skin };
  } finally {
    loading = false;
  }
}
