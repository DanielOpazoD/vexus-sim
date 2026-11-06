/**
 * Instala el paquete P3 (grasa compatible D de r1) en la reserva de pared, TRAS el bloque derivado P2 final.
 * No regenera atlas, mallas ni la carta P2: exige sus bytes y hashes intactos, re-fija capacidad y manifiesto y
 * escribe el descriptor `S0028_SOLIDS_PACKAGE`. Uso: node --import tsx tools/anatomy/install-s0028-solids.ts <paquete>
 */
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { S0028_BUNDLE as B } from '../../src/anatomy/anatomyBundle';
import { HALF } from '../../src/anatomy/halfFloat';

const folder = process.argv[2];
if (!folder) throw new Error('Indicar el paquete P3 reexportado');
const hash = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const manifest = readFileSync(resolve(folder, 'candidate-manifest.bin'));
const compressed = readFileSync(resolve(folder, 'annotation-capacity.gzip.bin'));
const raw = gunzipSync(compressed);
const m: unknown = JSON.parse(manifest.toString());
if (!object(m) || !object(m.p3Solids) || !object(m.capacity) || !object(m.wallP2Offline) || !object(m.wallP2Derived))
  throw new Error('Paquete P3 incompleto');
if (raw.length !== B.capacity.rawBytes || raw.toString('ascii', 0, 4) !== 'S28C') throw new Error('Reserva distinta');
const capacity = { rawBytes: raw.length, gzipBytes: compressed.length, sha256Gzip: hash(compressed), sha256Raw: hash(raw) };
if (m.capacity.sha256 !== capacity.sha256Raw || m.capacity.sha256Gzip !== capacity.sha256Gzip)
  throw new Error('Capacidad distinta del manifiesto');
// La carta P2 y su bloque derivado no cambian: mismos descriptores y mismos bytes en su sitio.
if (JSON.stringify(m.wallP2Offline) !== JSON.stringify(B.wall) || JSON.stringify(m.wallP2Derived) !== JSON.stringify(B.wallDerived))
  throw new Error('Descriptores P2 distintos');
const wall0 = 4096,
  derivedEnd = B.wallDerived.offsetBytes + B.wallDerived.bytes;
if (
  hash(raw.subarray(wall0, wall0 + B.wall.payloadBytes)) !== B.wall.payloadSha256 ||
  hash(raw.subarray(wall0 + B.wallDerived.offsetBytes, wall0 + derivedEnd)) !== B.wallDerived.sha256
)
  throw new Error('Payload o derivado P2 alterados');
const p = m.p3Solids;
const boxes = p.boxes as { side: string; originMm: number[]; dimensions: number[]; byteOffset: number; byteLength: number }[];
const byteCount = boxes.reduce((n, b) => n + b.byteLength, 0);
const pages = Math.ceil((2 * byteCount) / 4096);
if (
  p.format !== 's0028-p3-fat-pages-v1' ||
  p.provenance !== 'D' ||
  p.compartments !== 'U' ||
  p.clinicalValidation !== false ||
  p.offsetBytes !== derivedEnd ||
  p.p2DerivedSha256 !== B.wallDerived.sha256 ||
  p.pageCount !== pages ||
  p.encodedBytes !== pages * 4096 ||
  p.pageTableBytes !== pages * 6 ||
  p.pitchMm !== 1.5 ||
  boxes.length !== 2 ||
  boxes.some(
    (b, i) =>
      b.side !== ['right', 'left'][i] ||
      b.byteOffset !== (i ? boxes[0].byteLength : 0) ||
      b.byteLength !== Math.ceil((b.dimensions[0] * b.dimensions[1] * b.dimensions[2]) / 8),
  )
)
  throw new Error('Descriptor P3 inválido o fuera de su sitio');
const start = wall0 + derivedEnd,
  table = start + pages * 4096;
const encoded = new Uint16Array(raw.buffer, raw.byteOffset + start, pages * 2048);
if (hash(raw.subarray(start, table)) !== p.sha256) throw new Error('Payload P3 distinto');
for (let i = 0; i < encoded.length; i++) {
  const v = HALF[encoded[i]];
  if (i < byteCount ? !(Number.isInteger(v) && v >= 0 && v <= 255) : encoded[i] !== 0) throw new Error('Byte P3 o relleno corrupto');
}
// Tabla de páginas xyz: dentro del atlas abdominal y sin solape con campos P1, EDT, teselas, centros ni rampas P2.
const [W, H, D] = B.abdominal.textureDimensions;
const used = new Uint8Array(W * H * D);
const occupy = (o: readonly number[], s: readonly number[], what: string) => {
  if (o.some((v) => v < 0) || o[0] + s[0] > W || o[1] + s[1] > H || o[2] + s[2] > D) throw new Error('Fuera del atlas: ' + what);
  for (let z = o[2]; z < o[2] + s[2]; z++)
    for (let y = o[1]; y < o[1] + s[1]; y++)
      for (let x = o[0]; x < o[0] + s[0]; x++) {
        if (used[(z * H + y) * W + x]) throw new Error('Solape en el atlas: ' + what);
        used[(z * H + y) * W + x] = 1;
      }
};
for (const f of B.fields) if (f.asset === 'abdominal') occupy(f.offset, f.dimensions, f.name);
occupy(B.depth.offset, B.depth.dimensions, 'depth');
B.wall.placements.forEach((o, i) => occupy(o, B.wall.tileSize, 'tesela ' + i));
occupy(B.wall.centerOffset, [1, 181, 1], 'centros');
occupy(B.wallDerived.ramps.placement, B.wallDerived.ramps.size, 'rampas');
const placements = new Uint16Array(raw.buffer, raw.byteOffset + table, pages * 3);
for (let i = 0; i < pages; i++) occupy([placements[3 * i], placements[3 * i + 1], placements[3 * i + 2]], [32, 32, 1], 'página ' + i);
// Cabecera: la parte de pared declara el bloque P3 tras el derivado.
const header = JSON.parse(raw.toString('utf8', 8, 8 + raw.readUInt32LE(4))) as { parts: Record<string, unknown>[] };
const part = header.parts.find((x) => x.name === 'wall');
if (!part || part.derivedBytes !== B.wallDerived.bytes || part.p3Bytes !== pages * 4096 + pages * 6)
  throw new Error('Cabecera P3 distinta');

// La GPU (r3) lleva la tabla como constante GLSL: x/32 + 6·y/32 + 48·z en tres cifras base 36 por página.
const code = (i: number) => {
  const [x, y, z] = [placements[3 * i], placements[3 * i + 1], placements[3 * i + 2]];
  if (x % 32 || y % 32 || x + 32 > W || y / 32 >= 8) throw new Error('Página P3 fuera de la rejilla de 32');
  return (x / 32 + (6 * y) / 32 + 48 * z).toString(36).padStart(3, '0');
};
const solids = {
  format: p.format,
  provenance: 'D',
  boxes,
  offsetBytes: derivedEnd,
  encodedBytes: pages * 4096,
  pageTableBytes: pages * 6,
  byteCount,
  sha256: p.sha256,
  pages: Array.from({ length: pages }, (_, i) => code(i)).join(''),
};
const manifestPin = { bytes: manifest.length, sha256: hash(manifest) };
const dataPath = 'src/anatomy/s0028WallData.ts';
const data = readFileSync(dataPath, 'utf8');
const pin = (text: string, key: string, value: object) => {
  const re = new RegExp(`  ${key}: \\{[^}]*\\},\\n`, 'u');
  if (!re.test(text)) throw new Error('Sin bloque ' + key);
  return text.replace(
    re,
    `  ${key}: {\n${Object.entries(value)
      .map(([k, v]) => `    ${k}: ${typeof v === 'string' ? `'${v}'` : v},`)
      .join('\n')}\n  },\n`,
  );
};
writeFileSync(dataPath, pin(pin(data, 'capacity', capacity), 'manifest', manifestPin));
writeFileSync(
  'src/anatomy/s0028SolidsData.ts',
  '/** Generado por tools/anatomy/install-s0028-solids.ts. Grasa compatible D (P3 r1); compartimentos U; revisión pendiente. */\n' +
    'export const S0028_SOLIDS_PACKAGE = ' +
    JSON.stringify(solids, null, 2) +
    ' as const;\n',
);
copyFileSync(resolve(folder, 'candidate-manifest.bin'), 'src/anatomy/s0028/candidate-manifest.bin');
copyFileSync(resolve(folder, 'annotation-capacity.gzip.bin'), 'src/anatomy/s0028/annotation-capacity.gzip.bin');
// El hash de procedencia de las mallas fija el bundle completo, ahora con su bloque P3 al final.
const bundle = { ...B, capacity, manifest: manifestPin, solids };
const path = 'src/anatomy/s0028SurfaceData.ts';
writeFileSync(
  path,
  readFileSync(path, 'utf8').replace(/sourceBundleSha256: '[a-f0-9]+'/u, `sourceBundleSha256: '${hash(JSON.stringify(bundle))}'`),
);
console.log(JSON.stringify({ capacity, manifest: manifestPin, solids: { ...solids, boxes: boxes.length } }));
