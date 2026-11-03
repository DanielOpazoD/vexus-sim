import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { S0028_SURFACE as M } from '../anatomy/s0028SurfaceData';
import { S0028_BUNDLE as B } from '../anatomy/anatomyBundle';
import { indexedSurfaces, verifySurfaceProvenance } from '../anatomy/s0028Surface';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('libera al menos 4 MB de descarga sin cambiar el formato residente Float32/Uint32', () => {
  expect(M.gzipBytes).toBeLessThanOrEqual(9_672_026 - 4_000_000);
  expect(M.format).toBe('indexed-delta32-v1');
  const raw = new Uint8Array(gunzipSync(readFileSync('src/anatomy/s0028/surfaces.gzip.bin'))).buffer;
  const surfaces = indexedSurfaces(raw);
  // Sin otra copia residente: la descodificación reutiliza el buffer descomprimido.
  expect(M.rawBytes).toBe(32_071_200);
  for (const f of surfaces) {
    expect(f.positions).toBeInstanceOf(Float32Array);
    expect(f.indices).toBeInstanceOf(Uint32Array);
    expect(f.positions.buffer).toBe(raw);
    expect(f.indices.buffer).toBe(raw);
  }
  // La descodificación es in situ: una segunda pasada corrompería las vistas ya entregadas.
  expect(createHash('sha256').update(new Uint8Array(raw)).digest('hex')).toBe(M.sha256DecodedRaw);
  expect(() => indexedSurfaces(raw)).toThrow(/ya descodificadas/);
  expect(createHash('sha256').update(new Uint8Array(raw)).digest('hex')).toBe(M.sha256DecodedRaw);
});
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
    { ...M, format: 'indexed-f32-u32-v1' },
    { ...M, units: 'cm' },
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
  expect(hash(new Uint8Array(raw))).toBe(M.sha256DecodedRaw);
  // Huella P1 anterior al cambio de codificación: conserva los bits, el orden y las aristas.
  expect(M.sha256DecodedRaw).toBe('a9b82a42b4e7eeac653b4ddd5459828e60508fd69fb925630a0dca20bbae5642');
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
  const invalidIndex = new Uint8Array(bytes).buffer;
  // Primer delta zigzag 1 => índice -1; jamás se instala una malla inválida.
  new Uint32Array(invalidIndex, M.fields[0].indexOffset, 1)[0] = 1;
  expect(() => indexedSurfaces(invalidIndex)).toThrow(/índice fuera/);
  const total =
    B.abdominal.gzipBytes + B.thoracic.gzipBytes + B.skin.gzipBytes + B.capacity.gzipBytes + B.manifest.bytes + 3640 + M.gzipBytes;
  expect(total).toBeLessThanOrEqual(25_000_000);
});
