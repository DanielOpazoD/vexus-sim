/** Instala sólo el paquete de datos reemplazable; no regenera ni modifica mallas/atlas. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { S0028_BUNDLE as B } from '../../src/anatomy/anatomyBundle';

const folder = process.argv[2];
if (!folder) throw new Error('Indicar el paquete exportado por s0028-wall.py');
const hash = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const manifest = readFileSync(resolve(folder, 'candidate-manifest.bin'));
// El exportador Python valida fuente, unidades, packing, halos y procedencia.
// Este paso exige también los bytes fijados del bundle P1 antes de sustituir sus dos activos.
const m: unknown = JSON.parse(manifest.toString());
if (
  !m ||
  typeof m !== 'object' ||
  !('wallP2Offline' in m) ||
  !('wallP2Derived' in m) ||
  !('capacity' in m) ||
  !('skin' in m) ||
  !('packing' in m)
)
  throw new Error('Paquete de pared incompleto');
const packing = m.packing;
if (
  !object(packing) ||
  packing.revision !== B.revision ||
  packing.sourcePhysicalFrameSha256 !== '2a0bba52e69f9ea82fc66355c3ec6e308f529b541182968f9b67a031872f49d1' ||
  !Array.isArray(packing.assets)
)
  throw new Error('Persona/marco P1 distintos');
const assets: unknown[] = packing.assets;
for (const field of B.fields) {
  const asset = assets.find((a) => object(a) && a.name === field.asset);
  if (!object(asset) || asset.sha256Raw !== B[field.asset].sha256Raw || !Array.isArray(asset.fields)) throw new Error('Atlas P1 distinto');
  const fields: unknown[] = asset.fields;
  const source = fields.find((f) => object(f) && f.name === field.name);
  if (
    !object(source) ||
    ['originMm', 'dimensions', 'offset', 'pitchMm'].some((key) => JSON.stringify(source[key]) !== JSON.stringify(Reflect.get(field, key)))
  )
    throw new Error('Marco físico P1 distinto');
}
const compressed = readFileSync(resolve(folder, 'annotation-capacity.gzip.bin'));
const raw = gunzipSync(compressed);
if (raw.length !== B.capacity.rawBytes || raw.toString('ascii', 0, 4) !== 'S28C') throw new Error('Reserva P1 distinta');
const capacity = { rawBytes: raw.length, gzipBytes: compressed.length, sha256Gzip: hash(compressed), sha256Raw: hash(raw) };
const manifestPin = { bytes: manifest.length, sha256: hash(manifest) };
if (
  !object(m.capacity) ||
  m.capacity.sha256 !== capacity.sha256Raw ||
  m.capacity.sha256Gzip !== capacity.sha256Gzip ||
  !object(m.skin) ||
  m.skin.sha256Raw !== B.skin.sha256Raw
)
  throw new Error('Bytes de reserva/piel distintos del manifiesto');
const descriptor = m.wallP2Offline;
if (
  !object(descriptor) ||
  descriptor.format !== 's0028-wall-regional-v1' ||
  JSON.stringify(descriptor.dimensions) !== '[512,181]' ||
  JSON.stringify(descriptor.zMm) !== '[-210,60]' ||
  descriptor.payloadBytes !== 757844 ||
  descriptor.payloadSha256 !== hash(raw.subarray(4096, 4096 + 757844))
)
  throw new Error('Formato/payload de pared distinto');
// Bloque derivado offline (s0028-wall-derived.py): E por nodo y rampa por fila, tras el payload y del mismo payload.
const derived = m.wallP2Derived;
const derivedStart = 4096 + 757844;
if (
  !object(derived) ||
  derived.format !== 's0028-wall-derived-v1' ||
  derived.provenance !== 'E' ||
  derived.payloadSha256 !== descriptor.payloadSha256 ||
  derived.offsetBytes !== 757844 ||
  derived.bytes !== 512 * 181 * 4 + 181 * 4 ||
  derived.sha256 !== hash(raw.subarray(derivedStart, derivedStart + 371412)) ||
  !object(derived.eMap) ||
  derived.eMap.bytes !== 512 * 181 * 4 ||
  derived.eMap.radiusMm !== 12 ||
  !object(derived.ramps) ||
  derived.ramps.offsetBytes !== 757844 + 512 * 181 * 4 ||
  JSON.stringify(derived.ramps.placement) !== '[0,0,653]' ||
  JSON.stringify(derived.ramps.size) !== '[181,1,1]'
)
  throw new Error('Bloque derivado de pared distinto o de otro payload');
writeFileSync(
  'src/anatomy/s0028WallData.ts',
  '/** Generado por tools/anatomy/install-s0028-wall.ts. Candidato reemplazable; revisión pendiente. */\n' +
    'export const S0028_WALL_PACKAGE = ' +
    JSON.stringify({ capacity, manifest: manifestPin, descriptor: m.wallP2Offline, derived, skin: m.skin }, null, 2) +
    ' as const;\n',
);
copyFileSync(resolve(folder, 'candidate-manifest.bin'), 'src/anatomy/s0028/candidate-manifest.bin');
copyFileSync(resolve(folder, 'annotation-capacity.gzip.bin'), 'src/anatomy/s0028/annotation-capacity.gzip.bin');
// El hash de procedencia fija el bundle completo; los bytes y hashes geométricos no cambian.
const bundle = { ...B, capacity, manifest: manifestPin, wall: m.wallP2Offline, wallDerived: derived };
const path = 'src/anatomy/s0028SurfaceData.ts';
writeFileSync(
  path,
  readFileSync(path, 'utf8').replace(/sourceBundleSha256: '[a-f0-9]+'/u, `sourceBundleSha256: '${hash(JSON.stringify(bundle))}'`),
);
