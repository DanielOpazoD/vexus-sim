import { ABDOMINAL_BODY } from '../../abdominalAtlasData';
import { loadPinnedGzip, sha256 } from '../../loadPinnedAsset';
import type { InstalledPerson } from '../../person';
import { validateReferenceBody } from '../../referenceBody';
import { installS0028Cpu } from './cpu';
import { S0028_BUNDLE as B } from './descriptor';
import { gpuPlan } from './gpu';
/** The pinned manifest fixes provenance, frame and dimensions; self-consistent foreign metadata cannot replace it. */
export async function verifyS0028Manifest(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  if (bytes.length !== B.manifest.bytes || (await sha256(bytes)) !== B.manifest.sha256)
    throw new Error('Paquete s0028: marco, dimensiones o procedencia alterados');
}
/** Carga e instala la persona s0028 en la página; el Worker recibe los mismos bloques al iniciarse. @twin trabajador-corte */
export async function loadPerson(signal: AbortSignal): Promise<InstalledPerson> {
  signal.throwIfAborted();

  const manifest = await fetch(new URL('../../s0028/candidate-manifest.bin?no-inline', import.meta.url), { signal });
  if (!manifest.ok) throw new Error('Paquete s0028: HTTP ' + manifest.status);
  await verifyS0028Manifest(new Uint8Array(await manifest.arrayBuffer()));
  const options = { signal, rawLimit: 139921010, gzipLimit: 19510002 };
  // Serie: no overlap of gzip staging/hash copies from the two atlases.
  const abdomen = await loadPinnedGzip(new URL('../../s0028/abdominal-direct.gzip.bin?no-inline', import.meta.url), B.abdominal, options);
  const thorax = await loadPinnedGzip(new URL('../../s0028/thoracic-direct.gzip.bin?no-inline', import.meta.url), B.thoracic, {
    ...options,
    rawLimit: 60413664,
  });
  const capacity = await loadPinnedGzip(
    new URL('../../s0028/annotation-capacity.gzip.bin?no-inline', import.meta.url),
    B.capacity,
    options,
  );
  const skin = await loadPinnedGzip(new URL('../../s0028/skin-polar.gzip.bin?no-inline', import.meta.url), B.skin, options);
  const bodyResponse = await fetch(new URL('../../abdominal-body.bin?no-inline', import.meta.url), { signal });
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
  const cpu = installS0028Cpu({ abdominal: new Uint16Array(abdomen), thoracic: new Uint16Array(thorax), body: profile, capacity, skin });
  return Object.freeze({ ...cpu, gpu: gpuPlan(cpu), loadSurfaces: async () => (await import('./surfaces')).loadSurfaces(signal) });
}
