import { deepStrictEqual, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFiles, buildSource, provenanceFile, type BuildProvenance } from '../build/provenance';

/** Verifica fuente + bytes locales, antes de ocupar GPU. No certifica resultados de pruebas. */
export function verifyLocalBuild(root: string, output: string) {
  const out = join(root, 'dist');
  const bytes = readFileSync(join(out, provenanceFile));
  const receipt = JSON.parse(bytes.toString()) as BuildProvenance;
  strictEqual(receipt.schema, 1, 'Recibo de build no compatible');
  deepStrictEqual(
    receipt.source,
    buildSource(root, [out, output]),
    'Build de otra fuente o anterior a la última edición; ejecuta npm run build',
  );
  deepStrictEqual(receipt.files, buildFiles(out), 'Los recursos de dist cambiaron desde el build; ejecuta npm run build');
  if (!receipt.files.some((file) => file.path === 'index.html')) throw new Error('Recibo de build incompleto');
  return { receipt, bytes };
}

/** Comparación byte a byte de todos los recursos, incluidos mapas de fuente y workers. */
export async function verifyPreviewBuild(root: string, origin: string, output: string) {
  const { receipt, bytes } = verifyLocalBuild(root, output);
  const fetchBytes = async (path: string) => {
    const url = new URL(path.split('/').map(encodeURIComponent).join('/'), origin + '/');
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    if (!response.ok) throw new Error(`Preview: ${response.status} en ${path}`);
    return Buffer.from(await response.arrayBuffer());
  };
  if (!(await fetchBytes(provenanceFile)).equals(bytes)) throw new Error('La preview sirve otro build; revisa su puerto y checkout');
  for (const file of receipt.files) {
    const served = await fetchBytes(file.path);
    if (served.length !== file.bytes || createHash('sha256').update(served).digest('hex') !== file.sha256)
      throw new Error(`La preview sirve un recurso distinto: ${file.path}`);
  }
  // Una edición durante el sondeo tampoco permite atribuir la adquisición a esa fuente.
  verifyLocalBuild(root, output);
  return {
    verifiedAt: new Date().toISOString(),
    source: receipt.source,
    receiptSha256: createHash('sha256').update(bytes).digest('hex'),
    files: receipt.files.length,
    bytes: receipt.files.reduce((total, file) => total + file.bytes, 0),
  };
}
