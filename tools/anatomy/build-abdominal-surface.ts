import { setAbdominalAtlas } from '../../src/anatomy/abdominalAtlas';
import { setAbdominalBody } from '../../src/anatomy/referenceBody';
import { AnatomyScene } from '../../src/anatomy/scene';
import { NORMAL_ADULT } from '../../src/cases';
import { kidneyLocal, perirenalOuterSdf, RENAL_FASCIA_MM } from '../../src/anatomy/organs/kidney';
import { meshFromSdf } from '../../src/ui/navigator3d/organs';
import type { Vec3 } from '../../src/core/vec3';
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
// Offline envelopes use exactly the runtime field, avoiding startup meshing costs.
setAbdominalAtlas(data);
const body = readFileSync('src/anatomy/abdominal-body.bin');
setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
const scene = new AnatomyScene(NORMAL_ADULT),
  envelopes = [];
for (const [side, k] of [scene.kidneyRight, scene.kidneyLeft].entries()) {
  const f = ABDOMINAL_FIELDS[5 + side];
  const lo = f.originMm.map((x) => x - 10) as Vec3;
  const hi = f.originMm.map((x, i) => x + (f.dimensions[i] - 1) * f.pitchMm + 10) as Vec3;
  for (const fascia of [false, true]) {
    const mesh = meshFromSdf(
      (p) => perirenalOuterSdf(kidneyLocal(p, k), k) + (fascia ? 0 : RENAL_FASCIA_MM),
      lo,
      hi,
      96,
      new MeshBasicMaterial(),
    );
    mesh.updateMatrix();
    const a = mesh.geometry.getAttribute('position');
    const positions = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) {
      positions[3 * i] = (a.getX(i) * mesh.scale.x + mesh.position.x) * 10;
      positions[3 * i + 1] = (a.getY(i) * mesh.scale.y + mesh.position.y) * 10;
      positions[3 * i + 2] = (a.getZ(i) * mesh.scale.z + mesh.position.z) * 10;
    }
    arrays.push(positions);
    envelopes.push({
      name: (fascia ? 'Fascia renal ' : 'Grasa perirrenal ') + (side ? 'izquierda' : 'derecha'),
      offset,
      count: a.count,
      side,
      fascia,
    });
    offset += positions.length;
    mesh.geometry.dispose();
    (mesh.material as MeshBasicMaterial).dispose();
    console.log(envelopes.at(-1));
  }
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
  envelopes,
};
const { fields: surfaceFields, envelopes: surfaceEnvelopes, ...header } = meta;
writeFileSync(
  'src/anatomy/abdominalSurfaceData.ts',
  '/** Generated from the acoustic signed-distance field. */\nimport { ABDOMINAL_FIELDS } from "./abdominalAtlasData";\nexport const ABDOMINAL_SURFACE = {' +
    JSON.stringify(header).slice(1, -1) +
    ', fields: (' +
    JSON.stringify(surfaceFields.map((f) => [f.offset, f.count])) +
    ' as const).map(([offset,count],i)=>({name:ABDOMINAL_FIELDS[i].name,offset,count})), envelopes: (' +
    JSON.stringify(surfaceEnvelopes.map((f) => [f.offset, f.count, f.side, f.fascia])) +
    ' as const).map(([offset,count,side,fascia])=>({offset,count,side,fascia,name:(fascia?"Fascia renal ":"Grasa perirrenal ")+(side?"izquierda":"derecha")}))} as const;\n',
);

console.log(meta);
