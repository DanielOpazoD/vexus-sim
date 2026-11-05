import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { installAnatomyBundle, S0028_BUNDLE as B } from '../anatomy/anatomyBundle';
import { HALF } from '../anatomy/halfFloat';
import { setS0028Solids, s0028CompatibleFat } from '../anatomy/s0028Solids';
import type { Vec3 } from '../core/vec3';
import fixture from './fixtures/s0028-fat-r1.json';

const gz = readFileSync('src/anatomy/s0028/annotation-capacity.gzip.bin');
const raw = () => new Uint8Array(gunzipSync(gz)).buffer;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
beforeAll(() => {
  installAnatomyBundle(B);
  setS0028Solids(raw());
});

it('el bloque P3 va tras el derivado P2 final, sin tocar su payload ni su bloque E', () => {
  const S = B.solids,
    r = new Uint8Array(raw());
  // r1 escribía en 4096 + 757.844: el sitio del bloque derivado E+rampas de P2 final.
  expect(S.offsetBytes).toBe(B.wallDerived.offsetBytes + B.wallDerived.bytes);
  expect(S.offsetBytes + S.encodedBytes + S.pageTableBytes).toBeLessThanOrEqual(344 * 256 * 8 * 3);
  expect(sha(r.subarray(4096, 4096 + B.wall.payloadBytes))).toBe(B.wall.payloadSha256);
  expect(sha(r.subarray(4096 + B.wallDerived.offsetBytes, 4096 + S.offsetBytes))).toBe(B.wallDerived.sha256);
  expect(sha(r.subarray(4096 + S.offsetBytes, 4096 + S.offsetBytes + S.encodedBytes))).toBe(S.sha256);
  const header = JSON.parse(new TextDecoder().decode(r.subarray(8, 8 + new DataView(r.buffer).getUint32(4, true)))) as {
    parts: { name: string; payloadBytes?: number; derivedBytes?: number; p3Bytes?: number }[];
  };
  const wall = header.parts.find((p) => p.name === 'wall');
  expect([wall?.payloadBytes, wall?.derivedBytes, wall?.p3Bytes]).toEqual([757844, 371412, S.encodedBytes + S.pageTableBytes]);
});

it('reproduce los recuentos D de r1 y su fixture fuente bit a bit (grasa, no grasa y envolvente renal U)', () => {
  const words = new Uint16Array(raw(), 4096 + B.solids.offsetBytes, B.solids.byteCount);
  const counts = B.solids.boxes.map((b) => {
    let n = 0;
    for (let i = b.byteOffset; i < b.byteOffset + b.byteLength; i++) for (let k = HALF[words[i]]; k; k >>= 1) n += k & 1;
    return n;
  });
  expect(counts).toEqual([fixture.counts.right, fixture.counts.left]);
  expect(counts).toEqual([106839, 122583]);
  // Centro del vóxel en el marco de su caja (el punto redondeado a 1e-6 mm del fixture podría caer fuera de una cara).
  for (const row of fixture.rows) {
    const box = B.solids.boxes.find((b) => b.side === row.side)!;
    const p = box.originMm.map((o, k) => o + 1.5 * row.index[k]) as Vec3;
    expect(Math.max(...p.map((v, k) => Math.abs(v - row.pointLASmm[k])))).toBeLessThan(1e-5);
    expect(s0028CompatibleFat(p), JSON.stringify(row)).toBe(row.fat);
  }
  // Fuera de ambas cajas la grasa no está evaluada: null, no «sin grasa».
  expect(s0028CompatibleFat([0, 120, 40])).toBeNull();
});

it('rechaza un byte no entero, fuera de 0…255, relleno no nulo o una reserva de otro tamaño', () => {
  const at = 4096 + B.solids.offsetBytes;
  const corrupt = (word: number, value: number) => {
    const r = raw();
    new Uint16Array(r, at, B.solids.encodedBytes / 2)[word] = value;
    return r;
  };
  expect(() => setS0028Solids(corrupt(17, 0x3c01))).toThrow(/corrupta/); // 1,0009765625
  expect(() => setS0028Solids(corrupt(17, 0x5c00))).toThrow(/corrupta/); // 256
  expect(() => setS0028Solids(corrupt(17, 0xbc00))).toThrow(/corrupta/); // −1
  expect(() => setS0028Solids(corrupt(B.solids.byteCount + 3, 0x3c00))).toThrow(/corrupta/);
  expect(() => setS0028Solids(new ArrayBuffer(B.capacity.rawBytes - 2))).toThrow(/incompleto/);
  setS0028Solids(raw());
});
