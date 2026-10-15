/** Offline extraction of the SAME signed distance nodes as CPU/GPU; no source mesh replacement. */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { MeshBasicMaterial } from 'three';
import { ABDOMINAL_ATLAS, ABDOMINAL_FIELDS } from '../../src/anatomy/abdominalAtlasData';
const half = (bits: number) => {
  const sign = bits & 0x8000 ? -1 : 1,
    exp = (bits >>> 10) & 31,
    m = bits & 1023;
  return sign * (exp === 0 ? m * 2 ** -24 : (1 + m / 1024) * 2 ** (exp - 15));
};
const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
if (raw.byteLength !== ABDOMINAL_ATLAS.rawBytes || createHash('sha256').update(raw).digest('hex') !== ABDOMINAL_ATLAS.sha256Raw)
  throw new Error('Surface extraction requires the pinned acoustic field');
const data = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
const [w, h] = ABDOMINAL_ATLAS.textureDimensions;
const arrays: Float32Array[] = [];
const fields = [];
let offset = 0;
for (const f of ABDOMINAL_FIELDS) {
  const n = Math.max(...f.dimensions) + 2;
  const mc = new MarchingCubes(n, new MeshBasicMaterial(), false, false, 600000);
  mc.field.fill(-16);
  for (let z = 0; z < f.dimensions[2]; z++)
    for (let y = 0; y < f.dimensions[1]; y++)
      for (let x = 0; x < f.dimensions[0]; x++) {
        const i = 2 * ((z + f.offset[2]) * w * h + (y + f.offset[1]) * w + x + f.offset[0]);
        mc.field[x + 1 + (y + 1) * n + (z + 1) * n * n] = -half(data[i]);
      }
  mc.isolation = 0;
  mc.update();
  const count = mc.geometry.drawRange.count;
  if (count >= 600000 * 3) throw new Error('Mesh extraction truncated');
  const position = (mc.geometry.getAttribute('position').array as Float32Array).slice(0, count * 3);
  for (let i = 0; i < position.length; i++) position[i] = (((position[i] + 1) * n) / 2 - 1) * f.pitchMm + f.originMm[i % 3];
  arrays.push(position);
  fields.push({ name: f.name, offset, count });
  offset += position.length;
  mc.geometry.dispose();
  (mc.material as MeshBasicMaterial).dispose();
  console.log(f.name, count / 3, 'triangles');
}
const combined = new Float32Array(offset);
let index = 0;
for (const a of arrays) {
  combined.set(a, index);
  index += a.length;
}
const bytes = new Uint8Array(combined.buffer),
  compressed = gzipSync(bytes, { level: 9, mtime: 0 } as Parameters<typeof gzipSync>[1]);
writeFileSync('src/anatomy/abdominal-surface.gzip.bin', compressed);
const meta = {
  sourceFieldSha256: ABDOMINAL_ATLAS.sha256Raw,
  rawBytes: bytes.length,
  gzipBytes: compressed.length,
  sha256Gzip: createHash('sha256').update(compressed).digest('hex'),
  sha256Raw: createHash('sha256').update(bytes).digest('hex'),
  fields,
};
writeFileSync(
  'src/anatomy/abdominalSurfaceData.ts',
  '/** Generated from the acoustic signed-distance field. */\nexport const ABDOMINAL_SURFACE = ' + JSON.stringify(meta) + ' as const;\n',
);
console.log(meta);
