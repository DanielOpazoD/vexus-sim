import { anatomyBundle, S0028_BUNDLE as B } from './anatomyBundle';
import { abdominalAtlas, s0028Depth } from './abdominalAtlas';
import { HALF } from './halfFloat';
import { S0028_WALL_PACKAGE as P } from './s0028WallData';
import type { Vec3 } from '../core/vec3';

type Provenance = 'U' | 'O' | 'D' | 'E';
const PROVENANCE: readonly Provenance[] = ['U', 'O', 'D', 'E'];
export type S0028WallSample =
  | { kind: 'unknown'; reason: 'coverage' | 'projection' | 'domain' | 'unloaded'; depthMm: number }
  | {
      kind: 'known';
      depthMm: number;
      outerMm: number;
      innerMm: number;
      interfaceMm: number;
      provenance: readonly [Provenance, Provenance, Provenance, Provenance];
      region: number;
      phi: number;
      z: number;
    };

let buffers: { tiles: Uint16Array; skin: Uint16Array } | undefined;
let chart:
  | {
      skin: ArrayBufferLike;
      atlas: Uint16Array;
      tiles: Uint16Array;
      nodes: Float32Array;
      seeds: Float32Array;
      order: Uint32Array;
      middle: Uint32Array;
      skinOrder: Uint32Array;
    }
  | undefined;
/** S y N derivados: 2.224.128 B CPU; no copia de atlas, reserva o mallas. */
export const S0028_WALL_CHART_BYTES = 512 * 181 * 6 * Float32Array.BYTES_PER_ELEMENT;
const TILE_WORDS = 65 * 91 * 2 * 2;

/** Vistas sobre la reserva y piel P1: ningún atlas o buffer completo adicional. */
export function setS0028Wall(capacity: ArrayBuffer, skin: ArrayBuffer): void {
  if (capacity.byteLength !== B.capacity.rawBytes || skin.byteLength !== B.skin.rawBytes) throw new Error('Pared s0028 incompleta');
  const tiles = new Uint16Array(capacity, 4096, B.wall.payloadBytes / 2);
  const read = (tile: number, page: number, x: number, y: number, channel: number) =>
    tiles[tile * TILE_WORDS + ((page * 91 + y) * 65 + x) * 2 + channel];
  for (let tile = 0; tile < 16; tile++)
    for (let y = 0; y < 91; y++)
      for (let x = 0; x < 65; x++) {
        const code = HALF[read(tile, 1, x, y, 1)];
        if (!Number.isInteger(code) || code < 0 || code > 2047 || code % 8 > 4) throw new Error('Procedencia de pared corrupta');
        const a = HALF[read(tile, 0, x, y, 0)],
          b = HALF[read(tile, 0, x, y, 1)],
          c = HALF[read(tile, 1, x, y, 0)];
        for (const [value, factor] of [
          [a, 8],
          [b, 32],
          [c, 128],
        ])
          if (Number.isNaN(value) !== (Math.floor(code / factor) % 4 === 0)) throw new Error('U de pared convertida en cero');
        if (![a, b, c].some(Number.isNaN) && !(a > 1.5 && a < b && b <= c && c <= 80)) throw new Error('Fronteras de pared cruzadas');
        for (let page = 0; page < 2; page++)
          for (let channel = 0; channel < 2; channel++) {
            if (x === 64 && read(tile, page, x, y, channel) !== read(Math.floor(tile / 8) * 8 + ((tile + 1) % 8), page, 0, y, channel))
              throw new Error('Halo angular de pared corrupto');
            if (tile < 8 && y === 90 && read(tile, page, x, y, channel) !== read(tile + 8, page, x, 0, channel))
              throw new Error('Halo Z de pared corrupto');
          }
      }
  buffers = { tiles, skin: new Uint16Array(skin) };
}

/** Perfil polar nativo de la misma persona; fuera de su Z se prolonga, sin certificar anatomía. */
function skinSeed(phi: number, z: number): Vec3 | undefined {
  if (!buffers || anatomyBundle.person !== 's0028') return undefined;
  const col = ((((phi / (2 * Math.PI)) % 1) + 1) % 1) * 1024;
  const row = Math.max(0, Math.min(686, (z - P.skin.originZMm) / P.skin.pitchZMm));
  const x = Math.floor(col),
    y = Math.min(685, Math.floor(row)),
    fx = col - x,
    fy = row - y;
  const value = (r: number, c: number, k: number) => HALF[buffers!.skin[2 * (r * 1024 + (c % 1024)) + k]];
  const component = (k: number) => {
    const a = value(y, x, k) + fx * (value(y, x + 1, k) - value(y, x, k));
    const b = value(y + 1, x, k) + fx * (value(y + 1, x + 1, k) - value(y + 1, x, k));
    return a + fy * (b - a);
  };
  return [component(0), component(1), z];
}

/** φ y z fijos: sólo se corrige el radio. Fuera del soporte EDT queda perfil aproximado. */
export function s0028SkinPoint(phi: number, z: number): Vec3 | undefined {
  const seed = skinSeed(phi, z);
  if (!seed) return undefined;
  const at = (r: number): Vec3 => [seed[0] + r * Math.cos(phi), seed[1] + r * Math.sin(phi), z];
  let lo = -3,
    hi = 3;
  const a = s0028Depth(at(lo)),
    b = s0028Depth(at(hi));
  if (a === undefined || b === undefined || a > 0 || b < 0) return seed;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (s0028Depth(at(mid))! < 0) lo = mid;
    else hi = mid;
  }
  return at((lo + hi) / 2);
}

/** Interpolación sólo con cuatro soportes geométricos válidos; región nearest independiente. */
export function s0028WallSurface(phi: number, z: number, depthMm = 0): S0028WallSample {
  if (!buffers) return { kind: 'unknown', reason: 'unloaded', depthMm };
  if (z < -210 || z > 60) return { kind: 'unknown', reason: 'domain', depthMm };
  const col = ((((phi / (2 * Math.PI)) % 1) + 1) % 1) * 512;
  const row = (z + 210) / 1.5,
    x = Math.floor(col),
    y = Math.min(179, Math.floor(row));
  const tile = Math.floor(y / 90) * 8 + Math.floor(x / 64),
    xx = x % 64,
    yy = y % 90;
  const fx = col - x,
    fy = row - y;
  const at = (dx: number, dy: number, page: number, k: number) =>
    HALF[buffers!.tiles[tile * TILE_WORDS + ((page * 91 + yy + dy) * 65 + xx + dx) * 2 + k]];
  const codes = [at(0, 0, 1, 1), at(1, 0, 1, 1), at(0, 1, 1, 1), at(1, 1, 1, 1)];
  if (codes.some((c) => [8, 32, 128].some((f) => Math.floor(c / f) % 4 === 0))) return { kind: 'unknown', reason: 'coverage', depthMm };
  const mix = (page: number, k: number) => {
    const a = at(0, 0, page, k) + fx * (at(1, 0, page, k) - at(0, 0, page, k));
    const b = at(0, 1, page, k) + fx * (at(1, 1, page, k) - at(0, 1, page, k));
    return a + fy * (b - a);
  };
  const code = codes[(fy >= 0.5 ? 2 : 0) + (fx >= 0.5 ? 1 : 0)];
  return {
    kind: 'known',
    depthMm,
    outerMm: mix(0, 0),
    innerMm: mix(0, 1),
    interfaceMm: mix(1, 0),
    provenance: [
      PROVENANCE[Math.floor(code / 8) % 4],
      PROVENANCE[Math.floor(code / 32) % 4],
      PROVENANCE[Math.floor(code / 128) % 4],
      PROVENANCE[Math.floor(code / 512) % 4],
    ],
    region: code % 8,
    phi,
    z,
  };
}

/** Carta del cero común y normales con el soporte declarado por el paquete. */
function chartNodes(): Float32Array {
  if (chart?.skin === buffers!.skin.buffer && chart.atlas === abdominalAtlas && chart.tiles === buffers!.tiles) return chart.nodes;
  const nodes = new Float32Array(512 * 181 * 6);
  const h = B.wall.surfaceGeometry.normal.includes('13 mm') ? 6.5 : 1.5;
  for (let r = 0; r < 181; r++)
    for (let c = 0; c < 512; c++) {
      const s = s0028SkinPoint((c * 2 * Math.PI) / 512, r * 1.5 - 210)!;
      const g: Vec3 = [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) {
        const a: Vec3 = [...s],
          b: Vec3 = [...s];
        a[axis] += h;
        b[axis] -= h;
        g[axis] = (s0028Depth(a)! - s0028Depth(b)!) / (2 * h);
      }
      const n = Math.hypot(...g) || 1,
        k = (r * 512 + c) * 6;
      nodes.set(s, k);
      nodes.set([g[0] / n, g[1] / n, g[2] / n], k + 3);
    }
  const midpoints: number[] = [];
  for (let r = 0; r < 181; r++)
    for (let c = 0; c < 512; c++) {
      const tile = Math.min(1, Math.floor(r / 90)) * 8 + Math.floor(c / 64);
      const at = tile * TILE_WORDS + ((r - Math.min(1, Math.floor(r / 90)) * 90) * 65 + (c % 64)) * 2;
      const depth = (HALF[buffers!.tiles[at]] + HALF[buffers!.tiles[at + 1]]) / 2;
      if (!Number.isFinite(depth)) continue;
      const index = r * 512 + c,
        k = index * 6;
      midpoints.push(nodes[k] - depth * nodes[k + 3], nodes[k + 1] - depth * nodes[k + 4], nodes[k + 2] - depth * nodes[k + 5], index);
    }
  const seeds = new Float32Array(midpoints);
  const coordinate = (index: number, axis: number, depth: number) => nodes[index * 6 + axis] - depth * nodes[index * 6 + axis + 3];
  const order = spatialOrder(seeds.length / 4, (i, axis) => seeds[i * 4 + axis]);
  const middle = spatialOrder(512 * 181, (i, axis) => coordinate(i, axis, 25));
  const skinOrder = spatialOrder(512 * 181, (i, axis) => coordinate(i, axis, 0));
  chart = { skin: buffers!.skin.buffer, atlas: abdominalAtlas!, tiles: buffers!.tiles, nodes, seeds, order, middle, skinOrder };
  return nodes;
}

function spatialOrder(count: number, at: (i: number, axis: number) => number): Uint32Array {
  const order = Uint32Array.from({ length: count }, (_, i) => i);
  const sort = (lo: number, hi: number, axis: number): void => {
    if (hi - lo < 2) return;
    order.subarray(lo, hi).sort((a, b) => at(a, axis) - at(b, axis));
    const mid = (lo + hi) >>> 1;
    sort(lo, mid, (axis + 1) % 3);
    sort(mid + 1, hi, (axis + 1) % 3);
  };
  sort(0, count, 0);
  return order;
}

/** Sólo busca semillas espaciales; el residual de S−dN y los tiles deciden la geometría. */
function nearestSeed(p: Vec3, order: Uint32Array, at: (i: number, axis: number) => number): number {
  let best = Infinity,
    index = 0;
  const visit = (lo: number, hi: number, axis: number): void => {
    if (lo >= hi) return;
    const mid = (lo + hi) >>> 1,
      i = order[mid];
    const d = (p[0] - at(i, 0)) ** 2 + (p[1] - at(i, 1)) ** 2 + (p[2] - at(i, 2)) ** 2;
    if (d < best) {
      best = d;
      index = i;
    }
    const delta = p[axis] - at(i, axis),
      next = (axis + 1) % 3;
    if (delta < 0) {
      visit(lo, mid, next);
      if (delta * delta < best) visit(mid + 1, hi, next);
    } else {
      visit(mid + 1, hi, next);
      if (delta * delta < best) visit(lo, mid, next);
    }
  };
  visit(0, order.length, 0);
  return index;
}

/** [S,N,∂rS,∂cS,∂rN,∂cN]; N normaliza la interpolación bilineal de nodos. */
function chartSample(nodes: Float32Array, r: number, c: number, out: Float64Array): void {
  const row = Math.max(0, Math.min(180, r)),
    col = ((c % 512) + 512) % 512;
  const ri = Math.min(179, Math.floor(row)),
    ci = Math.floor(col),
    u = row - ri,
    v = col - ci;
  const a = (ri * 512 + ci) * 6,
    b = (ri * 512 + ((ci + 1) % 512)) * 6;
  for (let k = 0; k < 6; k++) {
    const f0 = nodes[a + k],
      f1 = nodes[b + k],
      f2 = nodes[a + 512 * 6 + k],
      f3 = nodes[b + 512 * 6 + k];
    out[k] = (1 - u) * ((1 - v) * f0 + v * f1) + u * ((1 - v) * f2 + v * f3);
    out[6 + k] = (1 - v) * (f2 - f0) + v * (f3 - f1);
    out[12 + k] = (1 - u) * (f1 - f0) + u * (f3 - f2);
  }
  const length = Math.hypot(out[3], out[4], out[5]) || 1;
  for (let k = 3; k < 6; k++) out[k] /= length;
  const dr = out[3] * out[9] + out[4] * out[10] + out[5] * out[11];
  const dc = out[3] * out[15] + out[4] * out[16] + out[5] * out[17];
  for (let k = 0; k < 3; k++) {
    const nr = (out[9 + k] - out[3 + k] * dr) / length,
      nc = (out[15 + k] - out[3 + k] * dc) / length;
    out[9 + k] = out[12 + k];
    out[12 + k] = nr;
    out[15 + k] = nc;
  }
}

function solveChart(p: Vec3, row: number, col: number, nodes: Float32Array): { row: number; col: number; depth: number; error: number } {
  let r = row,
    c = col;
  const f = new Float64Array(18),
    clip = (v: number, max: number) => Math.max(-max, Math.min(max, v));
  chartSample(nodes, r, c, f);
  let d = (f[0] - p[0]) * f[3] + (f[1] - p[1]) * f[4] + (f[2] - p[2]) * f[5];
  for (let i = 0; i < 12; i++) {
    chartSample(nodes, r, c, f);
    const x = p[0] - f[0] + d * f[3],
      y = p[1] - f[1] + d * f[4],
      z = p[2] - f[2] + d * f[5];
    if (Math.hypot(x, y, z) < 1e-6) break;
    const a0 = f[6] - d * f[12],
      a1 = f[7] - d * f[13],
      a2 = f[8] - d * f[14];
    const b0 = f[9] - d * f[15],
      b1 = f[10] - d * f[16],
      b2 = f[11] - d * f[17];
    const c0 = -f[3],
      c1 = -f[4],
      c2 = -f[5];
    const bc0 = b1 * c2 - b2 * c1,
      bc1 = b2 * c0 - b0 * c2,
      bc2 = b0 * c1 - b1 * c0;
    const det = a0 * bc0 + a1 * bc1 + a2 * bc2;
    if (Math.abs(det) < 1e-7) break;
    r = Math.max(-0.5, Math.min(180.5, r + clip((x * bc0 + y * bc1 + z * bc2) / det, 4)));
    c += clip((x * (c1 * a2 - c2 * a1) + y * (c2 * a0 - c0 * a2) + z * (c0 * a1 - c1 * a0)) / det, 4);
    d += clip((x * (a1 * b2 - a2 * b1) + y * (a2 * b0 - a0 * b2) + z * (a0 * b1 - a1 * b0)) / det, 10);
  }
  chartSample(nodes, r, c, f);
  return { row: r, col: c, depth: d, error: Math.hypot(p[0] - f[0] + d * f[3], p[1] - f[1] + d * f[4], p[2] - f[2] + d * f[5]) };
}

/** Newton sobre S−dN. La EDT profunda sólo da la semilla; nunca decide la pared. */
export function s0028WallAt(p: Vec3): S0028WallSample | undefined {
  if (anatomyBundle.person !== 's0028') return undefined;
  if (!buffers || !abdominalAtlas) return { kind: 'unknown', reason: 'unloaded', depthMm: -(s0028Depth(p) ?? 0) };
  const nodes = chartNodes(),
    { seeds, order, middle, skinOrder } = chart!;
  if (order.length === 0) return { kind: 'unknown', reason: 'coverage', depthMm: -s0028Depth(p)! };
  const index = seeds[nearestSeed(p, order, (i, axis) => seeds[i * 4 + axis]) * 4 + 3];
  let q = solveChart(p, Math.floor(index / 512), index % 512, nodes);
  if (q.error > 0.001) {
    for (const [tree, depth] of [
      [middle, 25],
      [skinOrder, 0],
    ] as const) {
      const seed = nearestSeed(p, tree, (i, axis) => nodes[i * 6 + axis] - depth * nodes[i * 6 + axis + 3]);
      const other = solveChart(p, Math.floor(seed / 512), seed % 512, nodes);
      if (other.error < q.error) q = other;
    }
  }
  if (q.error > 0.1 || q.depth < -6) return { kind: 'unknown', reason: 'projection', depthMm: q.depth };
  return s0028WallSurface((q.col * 2 * Math.PI) / 512, q.row * 1.5 - 210, q.depth);
}

/** null significa que no existe una cara interna demostrada; no es profundidad cero. */
export function s0028InsideWall(p: Vec3): number | null {
  const q = s0028WallAt(p);
  return q?.kind === 'known' ? q.depthMm - q.interfaceMm : null;
}
