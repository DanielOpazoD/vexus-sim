import { ABDOMINAL_ATLAS, ABDOMINAL_BODY } from './abdominalAtlasData';
import { setAbdominalAtlas } from './abdominalAtlas';
import { setAbdominalBody, validateReferenceBody } from './referenceBody';

export async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Bounded decompression; fail visibly before a scene exists if the pinned field is corrupt. */
export async function loadPinnedGzip(
  url: URL,
  meta: { rawBytes: number; gzipBytes: number; sha256Gzip: string; sha256Raw: string },
): Promise<ArrayBuffer> {
  if (meta.rawBytes > 96 * 1024 * 1024 || meta.gzipBytes > 8 * 1024 * 1024) throw new Error('Activo abdominal excede su límite');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Atlas abdominal: HTTP ${response.status}`);
  const compressed = new Uint8Array(await response.arrayBuffer());
  if (compressed.length !== meta.gzipBytes || (await sha256(compressed)) !== meta.sha256Gzip)
    throw new Error('Atlas abdominal comprimido alterado');
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const raw = new Uint8Array(meta.rawBytes);
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.length > raw.length) {
      await reader.cancel();
      throw new Error('Atlas abdominal excede su límite');
    }
    raw.set(value, offset);
    offset += value.length;
  }
  if (offset !== raw.length || (await sha256(raw)) !== meta.sha256Raw) throw new Error('Atlas abdominal incompleto o alterado');
  return raw.buffer;
}

export async function loadAbdominalAtlas(): Promise<void> {
  const [raw, response] = await Promise.all([
    loadPinnedGzip(new URL('./abdominal-atlas.gzip.bin?no-inline', import.meta.url), ABDOMINAL_ATLAS),
    fetch(new URL('./abdominal-body.bin?no-inline', import.meta.url)),
  ]);
  if (!response.ok) throw new Error(`Perfil abdominal: HTTP ${response.status}`);
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength !== ABDOMINAL_BODY.bytes || (await sha256(body)) !== ABDOMINAL_BODY.sha256)
    throw new Error('Perfil abdominal alterado');
  const profile = validateReferenceBody(new Float32Array(body.buffer));
  setAbdominalBody(profile);
  setAbdominalAtlas(new Uint16Array(raw));
}
