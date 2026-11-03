import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { S0028_SURFACE as M } from '../anatomy/s0028SurfaceData';
import { S0028_BUNDLE as B } from '../anatomy/anatomyBundle';
import { indexedSurfaces, verifySurfaceProvenance } from '../anatomy/s0028Surface';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('el primer cuadro s0028 carga superficies offline sin extracción Worker', () => {
  const loader = readFileSync('src/ui/s0028Surfaces.ts', 'utf8');
  const worker = readFileSync('src/ui/cutMapWorker.ts', 'utf8');
  expect(loader).not.toMatch(/new Worker|type: 'surfaces'/);
  expect(worker).not.toMatch(/sourceSurface|type: 'surfaces'/);
  expect(loader).toContain('loadPinnedGzip');
});

it('fija hashes, procedencia, marco, inventario y cada triángulo expandido', async () => {
  await expect(verifySurfaceProvenance()).resolves.toBeUndefined();
  for (const meta of [
    { ...M, frameId: 'foreign' },
    { ...M, sourceBundleSha256: '0'.repeat(64) },
    { ...M, fields: M.fields.slice(1) },
  ])
    await expect(verifySurfaceProvenance(meta)).rejects.toThrow(/procedencia/);
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const gzip = readFileSync('src/anatomy/s0028/surfaces.gzip.bin');
  expect(gzip.length).toBe(M.gzipBytes);
  expect(hash(gzip)).toBe(M.sha256Gzip);
  const bytes = gunzipSync(gzip);
  expect(hash(bytes)).toBe(M.sha256Raw);
  const raw = new Uint8Array(bytes).buffer;
  const surfaces = indexedSurfaces(raw);
  expect(surfaces.map((f) => f.name)).toEqual(B.fields.map((f) => f.name));
  for (const [i, f] of surfaces.entries()) {
    const bits = new Uint32Array(f.positions.buffer, f.positions.byteOffset, f.positions.length);
    const expanded = new Uint32Array(f.indices.length * 3);
    for (let v = 0; v < f.indices.length; v++) {
      if (f.indices[v] >= f.positions.length / 3) throw new Error('Índice fuera de malla');
      for (let a = 0; a < 3; a++) expanded[3 * v + a] = bits[3 * f.indices[v] + a];
    }
    expect(hash(new Uint8Array(expanded.buffer))).toBe(M.fields[i].expandedSha256);
    expect(f.indices.length % 3).toBe(0);
  }
  const corrupt = gzip.slice();
  corrupt[20] ^= 1;
  expect(hash(corrupt)).not.toBe(M.sha256Gzip);
  expect(() => indexedSurfaces(raw.slice(4))).toThrow(/incompletas/);
  const total =
    B.abdominal.gzipBytes + B.thoracic.gzipBytes + B.skin.gzipBytes + B.capacity.gzipBytes + B.manifest.bytes + 3640 + M.gzipBytes;
  expect(total).toBeLessThanOrEqual(25_000_000);
});
