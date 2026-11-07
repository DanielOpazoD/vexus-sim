/**
 * Decisiones 329 y 330: coloca los dos riñones del atlas por defecto bajo el hígado y el bazo, sin otra persona.
 *
 * Movimiento rígido de los bloques `kidneyRight` y `kidneyLeft` del atlas abdominal registrado: giro mínimo que lleva el eje
 * largo de cada marco renal a la inclinación coronal y sagital de su pose, alrededor del centro del marco, y traslación.
 * Remuestreo con la misma interpolación trilineal de los lectores sobre los nodos half float, cuantizado a 1/64 mm, y después
 * se recorta contra los vecinos con la holgura de la decisión 309 (2 mm): donde no cabe, el riñón se aplana contra ellos,
 * como en las impresiones reales. Contra hígado, bazo, páncreas, vesícula y hueso se recorta también el riñón estirado
 * (`ATLAS_KIDNEY_W_SCALE`), que el lector solo recorta contra el tubo digestivo y el psoas. Ningún otro byte del atlas
 * cambia; los bloques se mudan a huecos libres de la textura (relleno de 16 mm), porque girados no caben donde estaban.
 * Entrada fijada por hash (el atlas de main 9e7b8d0, antes de cualquier movimiento): no es acumulativo.
 *
 * Alturas, inclinaciones y posición anteroposterior se miraron en dos TAC de una persona cada uno (s0028, s0440) como
 * órdenes de magnitud, no como metas. No es validación clínica.
 *
 * Uso: `git show 9e7b8d0:src/anatomy/abdominal-atlas.gzip.bin > /tmp/atlas-9e7b8d0.gzip.bin`,
 * `INPUT=/tmp/atlas-9e7b8d0.gzip.bin npx tsx tools/anatomy/move-kidneys.ts` y después
 * `npx tsx tools/anatomy/build-abdominal-surface.ts`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { ATLAS_KIDNEY_CLEARANCE_MM, ATLAS_KIDNEY_W_SCALE } from '../../src/anatomy/organs/kidney';
import { orthonormalBasis } from '../../src/anatomy/primitives';
import type { Vec3 } from '../../src/core/vec3';

const INPUT_RAW_SHA256 = 'b63ae6da6bda7ce4758297037dce45b5cb6fce3dca5ffbe5d88e319257e599e8';
const TEXTURE = [338, 217, 280] as const;
const PITCH = 1.5;

interface KidneyPose {
  /** Inclinación del eje largo (polo superior) en el plano coronal: + hacia la izquierda del paciente (x > 0). */
  coronalDeg: number;
  /** Inclinación del eje largo en el plano sagital: − con el polo superior hacia atrás. */
  sagittalDeg: number;
  translationMm: Vec3;
}
interface KidneySpec {
  name: 'kidneyRight' | 'kidneyLeft';
  field: 5 | 6;
  /** El bloque en el atlas de entrada. */
  brick: { originMm: Vec3; dimensions: Vec3; offset: Vec3 };
  /** El marco renal de la escena sobre ese bloque (centros registrados FJ3147/FJ3145 y ejes de la decisión 309). */
  source: { center: Vec3; long: Vec3; hilumHint: Vec3 };
  pose: KidneyPose;
  /** Destino en la textura y su tamaño libre máximo. */
  offset: Vec3;
  maxDims: Vec3;
}

/**
 * Poses (decisión 330). Los dos suben ~20 mm: el derecho a ~80 mm bajo el centro hepático, bajo su cara visceral, y el
 * izquierdo a ~65 mm, bajo el bazo y la cola del páncreas, ~15 mm más alto que el derecho (s0028 / s0440: 79 / 73 y 64 / 54
 * mm; el izquierdo 15 / 19 mm más alto). El derecho avanza hacia delante de la columna y se inclina más en el plano coronal
 * (s0028 / s0440: 18° / 23°). Ver la decisión para cada cifra.
 */
export const KIDNEYS: Record<'right' | 'left', KidneySpec> = {
  right: {
    name: 'kidneyRight',
    field: 5,
    brick: { originMm: [-97.5, -66.0, -207.0], dimensions: [52, 46, 83], offset: [178, 163, 119] },
    source: { center: [-58.6862655, -32.3988, -145.5475], long: [0.00120157, -0.14708338, 0.98912337], hilumHint: [1, 0.25, 0] },
    pose: { coronalDeg: 17, sagittalDeg: -24, translationMm: [1.5, -12, 20] },
    offset: [243, 145, 119],
    maxDims: [95, 72, 139],
  },
  left: {
    name: 'kidneyLeft',
    field: 6,
    brick: { originMm: [24.0, -70.5, -190.5], dimensions: [52, 41, 85], offset: [231, 163, 119] },
    source: { center: [61.9266845, -40.78815, -127.1065], long: [-0.08034499, -0.15237369, 0.98505175], hilumHint: [-1, 0.25, 0] },
    pose: { coronalDeg: -15, sagittalDeg: -10, translationMm: [-4, -2, 19] },
    offset: [178, 162, 119],
    maxDims: [65, 55, 139],
  },
};
for (const side of ['right', 'left'] as const) {
  const env = process.env[`POSE_${side.toUpperCase()}`];
  if (env) Object.assign(KIDNEYS[side].pose, JSON.parse(env));
}
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
  if (s < 1e-12)
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
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

/** El marco renal tras el movimiento: lo que la escena usa para el interior, los vasos y el estiramiento. */
export function movedKidneyFrame(spec: KidneySpec) {
  const s = orthonormalBasis(spec.source.long, spec.source.hilumHint);
  const target = unit([Math.tan((spec.pose.coronalDeg * Math.PI) / 180), Math.tan((spec.pose.sagittalDeg * Math.PI) / 180), 1]);
  const R = rotationFromTo(s.u, target);
  const center = spec.source.center.map((v, i) => v + spec.pose.translationMm[i]) as Vec3;
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

const at = (x: number, y: number, z: number) => 2 * (z * TEXTURE[0] * TEXTURE[1] + y * TEXTURE[0] + x);
interface Brick {
  originMm: readonly number[];
  dimensions: readonly number[];
  offset: readonly number[];
}
/** Lector trilineal de un bloque, idéntico a `sourceDistance` (16 fuera). */
function read(f: Brick, p: Vec3, src: Uint16Array): number {
  const q = [0, 1, 2].map((i) => (p[i] - f.originMm[i]) / PITCH);
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
}

/**
 * Vecinos contra los que se recorta el riñón: el del lector (tubo digestivo) solo en el nodo; los demás también estirados.
 * El psoas no: cede él, como en la reconstrucción del lecho renal (`carvePsoas`).
 */
const NEIGHBOURS = [
  ['liver', 4, true],
  ['spleen', 3, true],
  ['pancreas', 0, true],
  ['gallbladder', 7, true],
  ['lumbarSacralBone', 8, true],
  ['digestiveTract', 1, false],
] as const;

/**
 * El bloque movido de un riñón: valores half y rótulos en el orden de la textura, con su origen, tamaño y el recuento de
 * nodos que cada vecino recorta. `fields` son los descriptores del atlas (los vecinos no cambian).
 */
export function moveKidney(spec: KidneySpec, before: Uint16Array, fields: readonly Brick[]) {
  const brick = spec.brick;
  const frame = movedKidneyFrame(spec);
  const { R, source: s0 } = frame;
  const c0 = spec.source.center,
    c1 = frame.center;
  const clampIn = (p: Vec3): Vec3 =>
    p.map((v, i) => Math.min(Math.max(v, brick.originMm[i]), brick.originMm[i] + (brick.dimensions[i] - 1) * PITCH)) as Vec3;
  const label = (p: Vec3): number => {
    const q = [0, 1, 2].map((i) => Math.round((p[i] - brick.originMm[i]) / PITCH));
    if (q.some((v, i) => v < 0 || v > brick.dimensions[i] - 1)) return 0;
    return before[at(q[0] + brick.offset[0], q[1] + brick.offset[1], q[2] + brick.offset[2]) + 1];
  };
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
  // caja del bloque nuevo: los nodos fuente dentro del riñón, llevados al mundo nuevo, más el margen del bloque fuente
  const lo: Vec3 = [Infinity, Infinity, Infinity],
    hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  let occupiedBefore = 0;
  for (let z = 0; z < brick.dimensions[2]; z++)
    for (let y = 0; y < brick.dimensions[1]; y++)
      for (let x = 0; x < brick.dimensions[0]; x++) {
        if (half(before[at(x + brick.offset[0], y + brick.offset[1], z + brick.offset[2])]) >= 0) continue;
        occupiedBefore++;
        const p: Vec3 = [brick.originMm[0] + x * PITCH, brick.originMm[1] + y * PITCH, brick.originMm[2] + z * PITCH];
        const r = apply(R, [p[0] - c0[0], p[1] - c0[1], p[2] - c0[2]]);
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i], c1[i] + r[i]);
          hi[i] = Math.max(hi[i], c1[i] + r[i]);
        }
      }
  const origin = lo.map((v) => Math.floor((v - PAD_MM) / PITCH) * PITCH) as Vec3;
  const dims = hi.map((v, i) => Math.ceil((v + PAD_MM - origin[i]) / PITCH) + 1) as Vec3;
  const C = ATLAS_KIDNEY_CLEARANCE_MM;
  const removed: Record<string, number> = Object.fromEntries(NEIGHBOURS.map(([n]) => [n, 0]));
  let occupiedRigid = 0,
    occupiedAfter = 0;
  const n = dims[0] * dims[1] * dims[2];
  const values = new Uint16Array(n),
    labels = new Uint16Array(n);
  const centroid: Vec3 = [0, 0, 0];
  for (let z = 0; z < dims[2]; z++)
    for (let y = 0; y < dims[1]; y++)
      for (let x = 0; x < dims[0]; x++) {
        const p: Vec3 = [origin[0] + x * PITCH, origin[1] + y * PITCH, origin[2] + z * PITCH];
        let d = sourceDistance(p);
        if (d < 0) occupiedRigid++;
        // el punto del mundo cuyo riñón estirado lee este nodo
        const qw = dot([p[0] - c1[0], p[1] - c1[1], p[2] - c1[2]], frame.w);
        const stretched = [0, 1, 2].map((i) => p[i] + (qw / ATLAS_KIDNEY_W_SCALE - qw) * frame.w[i]) as Vec3;
        for (const [name, f, both] of NEIGHBOURS) {
          // el recorte del estirado varía 1/0,8 veces más deprisa en w: escalado por 0,8 (mismo cero) el campo sigue siendo
          // 1-Lipschitz y la distancia a la frontera de la clasificación no se sobreestima
          const clip = Math.max(
            C - read(fields[f], p, before),
            both ? ATLAS_KIDNEY_W_SCALE * (C - read(fields[f], stretched, before)) : -Infinity,
          );
          if (d < 0 && clip >= 0) removed[name]++;
          d = Math.max(d, clip);
        }
        // cuantización de 1/64 mm, la de la reconstrucción del lecho renal (< 1,1 % del paso)
        d = Math.round(Math.min(FIELD_CAP_MM, d) * 64) / 64;
        if (d < 0) {
          occupiedAfter++;
          for (let i = 0; i < 3; i++) centroid[i] += p[i];
        }
        const i = (z * dims[1] + y) * dims[0] + x;
        values[i] = toHalf(d);
        labels[i] = label(toSource(p));
      }
  return {
    frame,
    origin,
    dims,
    values,
    labels,
    centroid: centroid.map((v) => v / occupiedAfter) as Vec3,
    occupiedNodes: { before: occupiedBefore, rigid: occupiedRigid, afterImpressions: occupiedAfter },
    removedNodesBy: removed,
  };
}

/** El contorno renal de la escena con el bloque movido, sin el recorte del psoas: el crudo ∪ el estirado (`atlasKidneyOuter`). */
export function movedKidneyContour(k: ReturnType<typeof moveKidney>) {
  const f = k.frame;
  const raw = (p: Vec3): number => {
    const q = [0, 1, 2].map((i) => (p[i] - k.origin[i]) / PITCH);
    if (q.some((v, i) => v < 0 || v > k.dims[i] - 1)) return FIELD_CAP_MM;
    const a = q.map((v, i) => Math.min(k.dims[i] - 2, Math.floor(v))),
      t = q.map((v, i) => v - a[i]);
    let s = 0;
    for (let n = 0; n < 8; n++) {
      const o = [n & 1, (n >> 1) & 1, (n >> 2) & 1];
      const wgt = o.reduce((acc, bit, i) => acc * (bit ? t[i] : 1 - t[i]), 1);
      s += wgt * half(k.values[((a[2] + o[2]) * k.dims[1] + a[1] + o[1]) * k.dims[0] + a[0] + o[0]]);
    }
    return s;
  };
  return (p: Vec3): number => {
    const qw = dot([p[0] - f.center[0], p[1] - f.center[1], p[2] - f.center[2]], f.w);
    const a = [0, 1, 2].map((i) => p[i] + (qw * ATLAS_KIDNEY_W_SCALE - qw) * f.w[i]) as Vec3;
    return Math.min(raw(p), raw(a));
  };
}

/**
 * El psoas cede a los riñones movidos con la holgura de 2 mm de la reconstrucción del lecho renal: max(psoas, 2 − riñón),
 * contra el contorno de la escena (crudo ∪ estirado), así el recorte del lector contra el psoas no actúa. Conserva la faceta
 * de 2 mm de aquella reconstrucción contra la posición fuente. Escribe en `data` (el bloque del psoas no se mueve).
 */
export function carvePsoas(data: Uint16Array, psoas: Brick, kidneys: ReturnType<typeof moveKidney>[]) {
  const contours = kidneys.map((k) => ({ k, d: movedKidneyContour(k) }));
  const C = ATLAS_KIDNEY_CLEARANCE_MM;
  let changed = 0,
    occupiedBefore = 0,
    occupiedAfter = 0;
  for (let z = 0; z < psoas.dimensions[2]; z++)
    for (let y = 0; y < psoas.dimensions[1]; y++)
      for (let x = 0; x < psoas.dimensions[0]; x++) {
        const i = at(x + psoas.offset[0], y + psoas.offset[1], z + psoas.offset[2]);
        const old = half(data[i]);
        if (old < 0) occupiedBefore++;
        const p: Vec3 = [psoas.originMm[0] + x * PITCH, psoas.originMm[1] + y * PITCH, psoas.originMm[2] + z * PITCH];
        let kc = FIELD_CAP_MM;
        for (const { k, d } of contours)
          if (p.every((v, j) => v > k.origin[j] - 10 && v < k.origin[j] + (k.dims[j] - 1) * PITCH + 10)) kc = Math.min(kc, d(p));
        const carved = Math.round(Math.min(FIELD_CAP_MM, C - kc) * 64) / 64;
        if (carved > old) {
          data[i] = toHalf(carved);
          changed++;
        }
        if (half(data[i]) < 0) occupiedAfter++;
      }
  return { changedNodes: changed, occupiedNodes: { before: occupiedBefore, after: occupiedAfter } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { ABDOMINAL_FIELDS } = await import('../../src/anatomy/abdominalAtlasData');
  const inputPath = process.env.INPUT ?? 'src/anatomy/abdominal-atlas.gzip.bin';
  const raw = gunzipSync(readFileSync(inputPath));
  if (createHash('sha256').update(raw).digest('hex') !== INPUT_RAW_SHA256) throw new Error('Se espera el atlas de main 9e7b8d0');
  const before = new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const data = before.slice();
  const [W, H, D] = TEXTURE;
  const moved = (['right', 'left'] as const).map((side) => ({
    side,
    spec: KIDNEYS[side],
    ...moveKidney(KIDNEYS[side], before, ABDOMINAL_FIELDS),
  }));
  if (process.env.DRY) {
    for (const m of moved)
      console.log(
        JSON.stringify({
          side: m.side,
          pose: m.spec.pose,
          origin: m.origin,
          dims: m.dims,
          centroid: m.centroid,
          occupied: m.occupiedNodes,
          removed: m.removedNodesBy,
        }),
      );
    process.exit(0);
  }
  // los bloques viejos se rellenan; los huecos de destino deben estar libres
  for (const { spec } of moved) {
    const b = spec.brick;
    for (let z = 0; z < b.dimensions[2]; z++)
      for (let y = 0; y < b.dimensions[1]; y++)
        for (let x = 0; x < b.dimensions[0]; x++) {
          const i = at(x + b.offset[0], y + b.offset[1], z + b.offset[2]);
          data[i] = FILLER;
          data[i + 1] = 0;
        }
  }
  for (const { spec, dims, values, labels } of moved) {
    if (dims.some((n, i) => n > spec.maxDims[i])) throw new Error(`${spec.name}: el bloque no cabe en el hueco libre: ${dims.join(',')}`);
    for (let z = 0; z < dims[2]; z++)
      for (let y = 0; y < dims[1]; y++)
        for (let x = 0; x < dims[0]; x++) {
          const i = at(x + spec.offset[0], y + spec.offset[1], z + spec.offset[2]);
          if (data[i] !== FILLER || data[i + 1] !== 0) throw new Error(`${spec.name}: texel ocupado en ${[x, y, z].join(',')}`);
          const j = (z * dims[1] + y) * dims[0] + x;
          data[i] = values[j];
          data[i + 1] = labels[j];
        }
  }
  const psoasBrick = ABDOMINAL_FIELDS[9];
  const psoasCarve = carvePsoas(data, psoasBrick, moved);
  // ningún otro byte cambia
  const inside = (x: number, y: number, z: number, o: readonly number[], n: readonly number[]) =>
    x >= o[0] && y >= o[1] && z >= o[2] && x < o[0] + n[0] && y < o[1] + n[1] && z < o[2] + n[2];
  const touched = (x: number, y: number, z: number) =>
    inside(x, y, z, psoasBrick.offset, psoasBrick.dimensions) ||
    moved.some((m) => inside(x, y, z, m.spec.brick.offset, m.spec.brick.dimensions) || inside(x, y, z, m.spec.offset, m.dims));
  for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (touched(x, y, z)) continue;
        const i = at(x, y, z);
        if (data[i] !== before[i] || data[i + 1] !== before[i + 1]) throw new Error('Cambió un byte ajeno a los riñones y el psoas');
      }
  const out = new Uint8Array(data.buffer),
    compressed = gzipSync(out, { level: 9, mtime: 0 } as Parameters<typeof gzipSync>[1]);
  writeFileSync('src/anatomy/abdominal-atlas.gzip.bin', compressed);
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  const summary = Object.fromEntries(
    moved.map((m) => [
      m.side,
      {
        pose: m.spec.pose,
        sourceFrame: m.spec.source,
        movedCenterMm: m.frame.center,
        movedLong: m.frame.u,
        movedHilumHint: m.frame.v,
        originMm: m.origin,
        dimensions: m.dims,
        offset: m.spec.offset,
        occupiedNodes: m.occupiedNodes,
        removedNodesBy: m.removedNodesBy,
      },
    ]),
  );
  const kidneyPoses = {
    decisions: ['329', '330'],
    inputRawSha256: INPUT_RAW_SHA256,
    clearanceMm: ATLAS_KIDNEY_CLEARANCE_MM,
    ...summary,
    psoasCarve,
    status: 'ESTIMATED / NEEDS_CALIBRATION',
    limitation:
      'Movimiento rígido de la fuente BodyParts3D con impresiones de 2 mm contra hígado, bazo, páncreas, vesícula, hueso y tubo digestivo; el psoas cede 2 mm a los riñones movidos y conserva el recorte de 2 mm contra su posición fuente (reconstrucción del lecho renal).',
  };
  const manifestPath = 'docs/anatomy/abdominal-atlas-manifest.json';
  interface ManifestField {
    name: string;
    originMm: number[];
    dimensions: number[];
    offset: number[];
    representedVolumeMl: number;
  }
  const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as { fields: ManifestField[]; rightKidneyPose?: unknown; kidneyPoses?: unknown };
  for (const k of moved) {
    const f = m.fields.find((x) => x.name === k.spec.name)!;
    f.originMm = k.origin;
    f.dimensions = k.dims;
    f.offset = k.spec.offset;
    f.representedVolumeMl = (k.occupiedNodes.afterImpressions * PITCH ** 3) / 1000;
  }
  m.fields.find((x) => x.name === 'psoas')!.representedVolumeMl = (psoasCarve.occupiedNodes.after * PITCH ** 3) / 1000;
  delete m.rightKidneyPose;
  m.kidneyPoses = kidneyPoses;
  Object.assign(m, { rawBytes: out.length, gzipBytes: compressed.length, sha256Raw: sha(out), sha256Gzip: sha(compressed) });
  writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
  let ts = readFileSync('src/anatomy/abdominalAtlasData.ts', 'utf8');
  ts = ts.replace(/gzipBytes: \d+/, `gzipBytes: ${compressed.length}`);
  ts = ts.replace(/sha256Gzip: '[0-9a-f]+'/, `sha256Gzip: '${sha(compressed)}'`);
  ts = ts.replace(/sha256Raw: '[0-9a-f]+'/, `sha256Raw: '${sha(out)}'`);
  for (const k of moved)
    ts = ts.replace(
      new RegExp(`\\['${k.spec.name}', \\[[^\\]]+\\], \\[[^\\]]+\\], \\[[^\\]]+\\],`),
      `['${k.spec.name}', [${k.origin.map((v) => v.toFixed(1)).join(', ')}], [${k.dims.join(', ')}], [${k.spec.offset.join(', ')}],`,
    );
  writeFileSync('src/anatomy/abdominalAtlasData.ts', ts);
  // huella de los dos bloques movidos: la cadena de derivación que fija `registeredDiaphragmRoof.test.ts`
  const fieldSha256: Record<string, string> = {},
    labelSha256: Record<string, string> = {};
  for (const { name, offset, dims, labelsChange } of [
    ...moved.map((k) => ({ name: k.spec.name, offset: k.spec.offset, dims: k.dims, labelsChange: true })),
    { name: 'psoas', offset: psoasBrick.offset, dims: psoasBrick.dimensions, labelsChange: false },
  ]) {
    const hash = createHash('sha256'),
      labels = Buffer.alloc(dims[0] * dims[1] * dims[2] * 2);
    let lo = 0;
    for (let z = offset[2]; z < offset[2] + dims[2]; z++)
      for (let y = offset[1]; y < offset[1] + dims[1]; y++) {
        const start = 4 * (z * W * H + y * W + offset[0]);
        hash.update(out.subarray(start, start + 4 * dims[0]));
        for (let x = 0; x < dims[0]; x++) {
          labels.writeUInt16LE(out[start + 4 * x + 2] | (out[start + 4 * x + 3] << 8), lo);
          lo += 2;
        }
      }
    fieldSha256[name] = hash.digest('hex');
    // el psoas conserva sus rótulos: los fija la reconstrucción del lecho renal
    if (labelsChange) labelSha256[name] = createHash('sha256').update(labels).digest('hex');
  }
  writeFileSync(
    'src/validation/fixtures/kidney-pose-fields.json',
    JSON.stringify(
      {
        decisions: ['329', '330'],
        tool: 'tools/anatomy/move-kidneys.ts',
        inputRawSha256: INPUT_RAW_SHA256,
        outputRawSha256: sha(out),
        fieldSha256,
        labelSha256,
      },
      null,
      2,
    ) + '\n',
  );
  // los marcos que la persona por defecto da a la escena (`people/default/cpu.ts`)
  const fmt = (a: readonly number[]) => `[${a.map((v) => +v.toFixed(8)).join(', ')}]`;
  writeFileSync(
    'src/anatomy/people/default/kidneyFrames.ts',
    [
      "import type { Vec3 } from '../../../core/vec3';",
      '',
      '/**',
      ' * Marcos de los dos riñones del atlas por defecto (0 derecho, 1 izquierdo), movidos con su campo (decisiones 329 y 330), y',
      ' * el marco fuente de cada uno, el del atlas antes de moverlo. Los genera `tools/anatomy/move-kidneys.ts`: no se editan a mano.',
      ' */',
      'export const KIDNEY_FRAMES: readonly { center: Vec3; long: Vec3; hilumHint: Vec3; source: { center: Vec3; long: Vec3; hilumHint: Vec3 } }[] = [',
      ...moved.flatMap((m) => [
        `  {`,
        `    center: ${fmt(m.frame.center)},`,
        `    long: ${fmt(m.frame.u)},`,
        `    hilumHint: ${fmt(m.frame.v)},`,
        `    source: { center: ${fmt(m.spec.source.center)}, long: ${fmt(m.spec.source.long)}, hilumHint: ${fmt(m.spec.source.hilumHint)} },`,
        `  },`,
      ]),
      '];',
      '',
    ].join('\n'),
  );
  console.log(JSON.stringify(kidneyPoses, null, 2));
}
