/**
 * Decisión 329: inclina el riñón derecho del atlas y lo acerca al hígado, sin otra persona.
 *
 * Movimiento rígido del bloque `kidneyRight` del atlas abdominal registrado: giro mínimo que lleva el eje largo del marco
 * renal a una inclinación coronal de 12° (polo superior medial) y sagital de −29,5° (polo superior posterior), alrededor del
 * centro del marco, y traslación de [−7,5, −18, +7] mm. La subida se limita a 7 mm para que el riñón izquierdo siga ≥ 10 mm
 * más alto que el derecho, como en los dos TAC (15 y 19 mm); con 24 mm el derecho quedaba por encima. Girado, el polo
 * inferior avanza hacia el colon: los 18 mm posteriores y 7,5 laterales lo dejan fuera del colon y del psoas salvo
 * impresiones de < 1 cm³, sin adelgazar la corteza (los dedos del seno siguen a ≥ 5 mm de la cápsula). Remuestreo con la misma interpolación trilineal de los
 * lectores sobre los nodos half float, cuantizado a 1/64 mm, y después se recorta contra hígado, tubo digestivo y psoas con la holgura de la decisión 309 (2 mm): donde no
 * cabe, el riñón se aplana contra ellos, como en las impresiones reales. Contra el hígado se recorta también el riñón
 * estirado (`ATLAS_KIDNEY_W_SCALE`), que el lector no recorta contra él. Ningún otro byte del atlas cambia; el bloque
 * se muda a un hueco libre de la textura (relleno de 16 mm), porque girado no cabe donde estaba. Entrada fijada por hash: no es acumulativo.
 *
 * Inclinación y altura se miraron en dos TAC de una persona cada uno (s0028, s0440: 32,5° y 33,1°; 79 y 73 mm del
 * centro hepático al renal en altura) como órdenes de magnitud, no como metas. No es validación clínica.
 *
 * Uso: `npx tsx tools/anatomy/move-right-kidney.ts` y después `npx tsx tools/anatomy/build-abdominal-surface.ts`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { ATLAS_KIDNEY_CLEARANCE_MM, ATLAS_KIDNEY_W_SCALE } from '../../src/anatomy/organs/kidney';
import { orthonormalBasis } from '../../src/anatomy/primitives';
import type { Vec3 } from '../../src/core/vec3';

const INPUT_RAW_SHA256 = 'b63ae6da6bda7ce4758297037dce45b5cb6fce3dca5ffbe5d88e319257e599e8';
/** Marco renal derecho de la escena antes del movimiento (centro registrado FJ3147 y eje de la decisión 309). */
export const RIGHT_KIDNEY_SOURCE = {
  center: [-58.6862655, -32.3988, -145.5475] as Vec3,
  long: [0.00120157, -0.14708338, 0.98912337] as Vec3,
  hilumHint: [1, 0.25, 0] as Vec3,
};
export const RIGHT_KIDNEY_POSE = { coronalDeg: 12, sagittalDeg: -29.5, translationMm: [-7.5, -18, 7] as Vec3 };
if (process.env.POSE) Object.assign(RIGHT_KIDNEY_POSE, JSON.parse(process.env.POSE));
/**
 * El bloque se muda al hueco libre de la textura junto al riñón izquierdo y el páncreas (x 283–337, y 145–216, z 119–257,
 * todo relleno de 16 mm): girado no cabe donde estaba. El relleno de los huecos es el de los bloques: distancia 16, rótulo 0.
 */
const NEW_OFFSET = [283, 145, 119];
const MAX_DIMS = [55, 72, 139];
const FILLER = 0x4c00;
const PAD_MM = Number(process.env.PAD ?? 9.75);
const FIELD_CAP_MM = 16;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Giro mínimo (Rodrigues) que lleva el unitario a sobre el unitario b, como matriz por filas. */
function rotationFromTo(a: Vec3, b: Vec3): number[][] {
  const k = cross(a, b),
    s = Math.hypot(...k),
    c = dot(a, b);
  const n = unit(k),
    K = [
      [0, -n[2], n[1]],
      [n[2], 0, -n[0]],
      [-n[1], n[0], 0],
    ];
  return [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => (i === j ? 1 : 0) + s * K[i][j] + (1 - c) * [0, 1, 2].reduce((t, m) => t + K[i][m] * K[m][j], 0)),
  );
}
const apply = (M: number[][], a: Vec3): Vec3 => [0, 1, 2].map((i) => M[i][0] * a[0] + M[i][1] * a[1] + M[i][2] * a[2]) as Vec3;

/** El marco renal derecho tras el movimiento: lo que la escena usa para el interior, los vasos y el estiramiento. */
export function movedRightKidneyFrame() {
  const s = orthonormalBasis(RIGHT_KIDNEY_SOURCE.long, RIGHT_KIDNEY_SOURCE.hilumHint);
  const target = unit([
    Math.tan((RIGHT_KIDNEY_POSE.coronalDeg * Math.PI) / 180),
    Math.tan((RIGHT_KIDNEY_POSE.sagittalDeg * Math.PI) / 180),
    1,
  ]);
  const R = rotationFromTo(s.u, target);
  const center = RIGHT_KIDNEY_SOURCE.center.map((v, i) => v + RIGHT_KIDNEY_POSE.translationMm[i]) as Vec3;
  return { R, source: s, center, u: apply(R, s.u), v: apply(R, s.v), w: apply(R, s.w) };
}

function half(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1,
    e = (bits >>> 10) & 31,
    m = bits & 1023;
  return sign * (e === 0 ? m * 2 ** -24 : (1 + m / 1024) * 2 ** (e - 15));
}
/** float → half, redondeo al par más cercano (los valores del campo son normales y finitos). */
function toHalf(v: number): number {
  const f = new Float32Array([v]),
    x = new Uint32Array(f.buffer)[0];
  const sign = (x >>> 16) & 0x8000,
    e = ((x >>> 23) & 0xff) - 127 + 15,
    m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) throw new Error('fuera del rango half');
  let h = (e << 10) | (m >>> 13);
  const rest = m & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && h & 1)) h++;
  return sign | h;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fields = (await import('../../src/anatomy/abdominalAtlasData')).ABDOMINAL_FIELDS;
  const { ABDOMINAL_ATLAS } = await import('../../src/anatomy/abdominalAtlasData');
  const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
  if (createHash('sha256').update(raw).digest('hex') !== INPUT_RAW_SHA256) throw new Error('Se espera el atlas de main 6fcdfd6');
  const before = new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const data = before.slice();
  const [W, H, D] = ABDOMINAL_ATLAS.textureDimensions;
  const at = (x: number, y: number, z: number) => 2 * (z * W * H + y * W + x);
  const brick = fields[5];
  const pitch = brick.pitchMm;
  // lector trilineal de un bloque, idéntico a sourceDistance (16 fuera)
  const read = (f: (typeof fields)[number], p: Vec3, src: Uint16Array): number => {
    const q = [0, 1, 2].map((i) => (p[i] - f.originMm[i]) / f.pitchMm);
    if (q.some((v, i) => v < 0 || v > f.dimensions[i] - 1)) return FIELD_CAP_MM;
    const a = q.map((v, i) => Math.min(f.dimensions[i] - 2, Math.floor(v))),
      t = q.map((v, i) => v - a[i]);
    let s = 0;
    for (let k = 0; k < 8; k++) {
      const o = [k & 1, (k >> 1) & 1, (k >> 2) & 1];
      const wgt = o.reduce((acc, bit, i) => acc * (bit ? t[i] : 1 - t[i]), 1);
      s += wgt * half(src[at(a[0] + o[0] + f.offset[0], a[1] + o[1] + f.offset[1], a[2] + o[2] + f.offset[2])]);
    }
    return s;
  };
  const clampIn = (p: Vec3): Vec3 =>
    p.map((v, i) => Math.min(Math.max(v, brick.originMm[i]), brick.originMm[i] + (brick.dimensions[i] - 1) * pitch)) as Vec3;
  const label = (p: Vec3): number => {
    const q = [0, 1, 2].map((i) => Math.round((p[i] - brick.originMm[i]) / pitch));
    if (q.some((v, i) => v < 0 || v > brick.dimensions[i] - 1)) return 0;
    return before[at(q[0] + brick.offset[0], q[1] + brick.offset[1], q[2] + brick.offset[2]) + 1];
  };
  const frame = movedRightKidneyFrame();
  const { R, source: s0 } = frame;
  const c0 = RIGHT_KIDNEY_SOURCE.center,
    c1 = frame.center;
  // del mundo nuevo al punto del campo fuente: local en el marco nuevo, mundo en el marco viejo
  const toSource = (p: Vec3): Vec3 => {
    const d: Vec3 = [p[0] - c1[0], p[1] - c1[1], p[2] - c1[2]];
    const q: Vec3 = [dot(d, frame.u), dot(d, frame.v), dot(d, frame.w)];
    return [0, 1, 2].map((i) => c0[i] + q[0] * s0.u[i] + q[1] * s0.v[i] + q[2] * s0.w[i]) as Vec3;
  };
  const sourceDistance = (p: Vec3): number => {
    const q = toSource(p),
      c = clampIn(q),
      out = Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]);
    return Math.min(FIELD_CAP_MM, read(brick, c, before) + out);
  };
  // caja del bloque nuevo: los nodos fuente dentro del riñón, llevados al mundo nuevo, más 10,5 mm (el margen del bloque fuente)
  const lo: Vec3 = [Infinity, Infinity, Infinity],
    hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let z = 0; z < brick.dimensions[2]; z++)
    for (let y = 0; y < brick.dimensions[1]; y++)
      for (let x = 0; x < brick.dimensions[0]; x++) {
        if (half(before[at(x + brick.offset[0], y + brick.offset[1], z + brick.offset[2])]) >= 0) continue;
        const p: Vec3 = [brick.originMm[0] + x * pitch, brick.originMm[1] + y * pitch, brick.originMm[2] + z * pitch];
        const d: Vec3 = [p[0] - c0[0], p[1] - c0[1], p[2] - c0[2]];
        const r = apply(R, d);
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i], c1[i] + r[i]);
          hi[i] = Math.max(hi[i], c1[i] + r[i]);
        }
      }
  const origin = lo.map((v) => Math.floor((v - PAD_MM) / pitch) * pitch) as Vec3;
  const dims = hi.map((v, i) => Math.ceil((v + PAD_MM - origin[i]) / pitch) + 1);
  if (process.env.DRY) {
    console.log(JSON.stringify({ pose: RIGHT_KIDNEY_POSE, origin, dims }));
    process.exit(0);
  }
  if (dims.some((n, i) => n > MAX_DIMS[i])) throw new Error(`El bloque no cabe en el hueco libre: ${dims.join(',')}`);
  // el hueco de destino debe estar libre (relleno) y el bloque viejo se rellena
  for (let z = 0; z < dims[2]; z++)
    for (let y = 0; y < dims[1]; y++)
      for (let x = 0; x < dims[0]; x++) {
        const i = at(x + NEW_OFFSET[0], y + NEW_OFFSET[1], z + NEW_OFFSET[2]);
        if (data[i] !== FILLER || data[i + 1] !== 0) throw new Error(`Texel ocupado en ${[x, y, z].join(',')}`);
      }
  for (let z = 0; z < brick.dimensions[2]; z++)
    for (let y = 0; y < brick.dimensions[1]; y++)
      for (let x = 0; x < brick.dimensions[0]; x++) {
        const i = at(x + brick.offset[0], y + brick.offset[1], z + brick.offset[2]);
        data[i] = FILLER;
        data[i + 1] = 0;
      }
  const liver = fields[4],
    gut = fields[1],
    psoas = fields[9];
  const C = ATLAS_KIDNEY_CLEARANCE_MM;
  const removed = [0, 0, 0, 0];
  let occupiedBefore = 0,
    occupiedRigid = 0,
    occupiedAfter = 0;
  for (let z = 0; z < brick.dimensions[2]; z++)
    for (let y = 0; y < brick.dimensions[1]; y++)
      for (let x = 0; x < brick.dimensions[0]; x++)
        if (half(before[at(x + brick.offset[0], y + brick.offset[1], z + brick.offset[2])]) < 0) occupiedBefore++;
  for (let z = 0; z < dims[2]; z++)
    for (let y = 0; y < dims[1]; y++)
      for (let x = 0; x < dims[0]; x++) {
        const p: Vec3 = [origin[0] + x * pitch, origin[1] + y * pitch, origin[2] + z * pitch];
        let d = sourceDistance(p);
        if (d < 0) occupiedRigid++;
        // el punto del mundo cuyo riñón estirado lee este nodo
        const dl: Vec3 = [p[0] - c1[0], p[1] - c1[1], p[2] - c1[2]];
        const qw = dot(dl, frame.w);
        const stretched: Vec3 = [0, 1, 2].map((i) => p[i] + (qw / ATLAS_KIDNEY_W_SCALE - qw) * frame.w[i]) as Vec3;
        const clips = [
          C - read(liver, p, before),
          C - read(liver, stretched, before),
          C - read(gut, p, before),
          C - read(psoas, p, before),
        ];
        if (d < 0) clips.forEach((c, k) => c >= 0 && removed[k]++);
        d = Math.max(d, ...clips);
        // cuantización de 1/64 mm, la de la reconstrucción del lecho renal (< 1,1 % del paso)
        d = Math.round(Math.min(FIELD_CAP_MM, d) * 64) / 64;
        if (d < 0) occupiedAfter++;
        const i = at(x + NEW_OFFSET[0], y + NEW_OFFSET[1], z + NEW_OFFSET[2]);
        data[i] = toHalf(d);
        data[i + 1] = label(toSource(p));
      }
  // ningún otro byte cambia
  const inside = (x: number, y: number, z: number, o: readonly number[], n: readonly number[]) =>
    x >= o[0] && y >= o[1] && z >= o[2] && x < o[0] + n[0] && y < o[1] + n[1] && z < o[2] + n[2];
  const touched = (x: number, y: number, z: number) => inside(x, y, z, brick.offset, brick.dimensions) || inside(x, y, z, NEW_OFFSET, dims);
  for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (touched(x, y, z)) continue;
        const i = at(x, y, z);
        if (data[i] !== before[i] || data[i + 1] !== before[i + 1]) throw new Error('Cambió un byte ajeno al riñón derecho');
      }
  const out = new Uint8Array(data.buffer),
    compressed = gzipSync(out, { level: 9, mtime: 0 } as Parameters<typeof gzipSync>[1]);
  writeFileSync('src/anatomy/abdominal-atlas.gzip.bin', compressed);
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  const summary = {
    inputRawSha256: INPUT_RAW_SHA256,
    pose: RIGHT_KIDNEY_POSE,
    sourceFrame: RIGHT_KIDNEY_SOURCE,
    movedCenterMm: c1,
    movedLong: frame.u,
    movedHilumHint: frame.v,
    originMm: origin,
    dimensions: dims,
    offset: NEW_OFFSET,
    clearanceMm: C,
    occupiedNodes: { before: occupiedBefore, rigid: occupiedRigid, afterImpressions: occupiedAfter },
    removedNodesBy: { liver: removed[0], liverStretched: removed[1], digestiveTract: removed[2], psoas: removed[3] },
    status: 'ESTIMATED / NEEDS_CALIBRATION',
    limitation:
      'Movimiento rígido de la fuente BodyParts3D con impresiones de 2 mm contra hígado, tubo digestivo y psoas; el psoas conserva el recorte de 2 mm contra la posición anterior del riñón (reconstrucción del lecho renal).',
  };
  const manifestPath = 'docs/anatomy/abdominal-atlas-manifest.json';
  interface ManifestField {
    name: string;
    originMm: number[];
    dimensions: number[];
    offset: number[];
    representedVolumeMl: number;
  }
  const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as { fields: ManifestField[]; rightKidneyPose?: typeof summary };
  const f = m.fields.find((x) => x.name === 'kidneyRight')!;
  f.originMm = origin;
  f.dimensions = dims;
  f.offset = NEW_OFFSET;
  f.representedVolumeMl = (occupiedAfter * pitch ** 3) / 1000;
  m.rightKidneyPose = summary;
  Object.assign(m, { rawBytes: out.length, gzipBytes: compressed.length, sha256Raw: sha(out), sha256Gzip: sha(compressed) });
  writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
  let ts = readFileSync('src/anatomy/abdominalAtlasData.ts', 'utf8');
  ts = ts.replace(/gzipBytes: \d+/, `gzipBytes: ${compressed.length}`);
  ts = ts.replace(/sha256Gzip: '[0-9a-f]+'/, `sha256Gzip: '${sha(compressed)}'`);
  ts = ts.replace(/sha256Raw: '[0-9a-f]+'/, `sha256Raw: '${sha(out)}'`);
  ts = ts.replace(
    /\['kidneyRight', \[[^\]]+\], \[[^\]]+\], \[[^\]]+\],/,
    `['kidneyRight', [${origin.map((v) => v.toFixed(1)).join(', ')}], [${dims.join(', ')}], [${NEW_OFFSET.join(', ')}],`,
  );
  writeFileSync('src/anatomy/abdominalAtlasData.ts', ts);
  console.log(JSON.stringify(summary, null, 2));
}
