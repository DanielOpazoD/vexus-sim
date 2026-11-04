import { anatomyBundle, S0028_BUNDLE as B } from './anatomyBundle';
import { s0028Depth, s0028DepthGradient, s0028DepthXyz } from './abdominalAtlas';
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
/** Vistas del payload verificado, para texSubImage sobre los huecos del atlas P1. */
export function s0028WallUploads(): ReadonlyArray<{ offset: readonly number[]; size: readonly number[]; data: Uint16Array }> {
  if (!buffers) throw new Error('Pared s0028 no cargada');
  return [
    ...B.wall.placements.map((offset, tile) => ({
      offset,
      size: B.wall.tileSize,
      data: buffers!.tiles.subarray(tile * TILE_WORDS, (tile + 1) * TILE_WORDS),
    })),
    { offset: B.wall.centerOffset, size: [1, 181, 1], data: buffers.tiles.subarray(16 * TILE_WORDS) },
  ];
}
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

/** Celda bilineal de la carta en (columna, fila): cuatro códigos y lectura de página/canal en una fracción de la celda. */
function chartCell(col: number, row: number) {
  const x = Math.floor(col),
    y = Math.min(179, Math.floor(row));
  const tile = Math.floor(y / 90) * 8 + Math.floor(x / 64),
    xx = x % 64,
    yy = y % 90;
  const at = (dx: number, dy: number, page: number, k: number) =>
    HALF[buffers!.tiles[tile * TILE_WORDS + ((page * 91 + yy + dy) * 65 + xx + dx) * 2 + k]];
  const codes = [at(0, 0, 1, 1), at(1, 0, 1, 1), at(0, 1, 1, 1), at(1, 1, 1, 1)];
  const fx = col - x,
    fy = row - y;
  const mix = (page: number, k: number) => {
    const a = at(0, 0, page, k) + fx * (at(1, 0, page, k) - at(0, 0, page, k));
    const b = at(0, 1, page, k) + fx * (at(1, 1, page, k) - at(0, 1, page, k));
    return a + fy * (b - a);
  };
  /** (∂/∂columna, ∂/∂fila) exacta de la misma bilineal, con sus cuatro esquinas (gemela de `s28Slope`). */
  const slope = (page: number, k: number): [number, number] => {
    const dx0 = at(1, 0, page, k) - at(0, 0, page, k),
      dx1 = at(1, 1, page, k) - at(0, 1, page, k);
    return [dx0 + fy * (dx1 - dx0), at(0, 1, page, k) + fx * dx1 - (at(0, 0, page, k) + fx * dx0)];
  };
  return { codes, known: !codes.some((c) => [8, 32, 128].some((f) => Math.floor(c / f) % 4 === 0)), fx, fy, mix, slope };
}

const columnOf = (phi: number) => ((((phi / (2 * Math.PI)) % 1) + 1) % 1) * 512;

/** Interpolación sólo con cuatro soportes geométricos válidos; región nearest independiente. */
export function s0028WallSurface(phi: number, z: number, depthMm = 0): S0028WallSample {
  if (!buffers) return { kind: 'unknown', reason: 'unloaded', depthMm };
  if (z < -210 || z > 60) return { kind: 'unknown', reason: 'domain', depthMm };
  const cell = chartCell(columnOf(phi), (z + 210) / 1.5);
  if (!cell.known) return { kind: 'unknown', reason: 'coverage', depthMm };
  const code = cell.codes[(cell.fy >= 0.5 ? 2 : 0) + (cell.fx >= 0.5 ? 1 : 0)];
  return {
    kind: 'known',
    depthMm,
    outerMm: cell.mix(0, 0),
    innerMm: cell.mix(0, 1),
    interfaceMm: cell.mix(1, 0),
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

interface DirectProjection {
  /** EDT en p (negativa dentro) y su gradiente central de 1,5 mm. */
  depth: number;
  g: Vec3;
  gg: number;
  /** Superficie proyectada y su vector polar respecto del centro de la fila. */
  surface: Vec3;
  x: number;
  y: number;
}

/** `p − torsoDepth(p)·∇/|∇|²` con semilla polar; fuera del cero, del gradiente o del dominio z no hay carta. */
function directProjection(p: Vec3): DirectProjection | S0028WallSample {
  const depth = s0028Depth(p);
  if (!buffers || depth === undefined) return { kind: 'unknown', reason: 'unloaded', depthMm: -(depth ?? 0) };
  const g = s0028DepthGradient(p)!;
  const gg = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
  if (gg <= 0.000001 || depth > 6) return { kind: 'unknown', reason: 'projection', depthMm: -depth };
  const surface: Vec3 = [p[0] - (depth * g[0]) / gg, p[1] - (depth * g[1]) / gg, p[2] - (depth * g[2]) / gg];
  if (surface[2] < -210 || surface[2] > 60) return { kind: 'unknown', reason: 'domain', depthMm: -depth };
  const row = (surface[2] + 210) / 1.5;
  const lo = Math.floor(row),
    hi = Math.min(180, lo + 1),
    t = row - lo;
  const center = (r: number) => HALF[buffers!.tiles[16 * TILE_WORDS + 2 * r + 1]];
  return { depth, g, gg, surface, x: surface[0], y: surface[1] - (center(lo) * (1 - t) + center(hi) * t) };
}

/**
 * Proyección directa sobre EDT; profundidad positiva hacia el interior. Con la celda D/E la consulta vale a cualquier
 * profundidad (más allá de la cara interna es interior del cuerpo); U sólo por celda U o fuera del dominio.
 */
export function s0028WallAt(p: Vec3): S0028WallSample | undefined {
  if (anatomyBundle.person !== 's0028') return undefined;
  const q = directProjection(p);
  if ('kind' in q) return q;
  return s0028WallSurface(Math.atan2(q.y, q.x), q.surface[2], -q.depth);
}

/** Frontera de la carta: 0 externa (fascia profunda), 1 interna (transversalis), 2 interfaz (peritoneo). */
export type S0028Boundary = 0 | 1 | 2;
const PAGE_CHANNEL = [
  [0, 0],
  [0, 1],
  [1, 0],
] as const;

/**
 * Gradiente analítico de `profundidad − frontera` (gemelo de `s28FaceGradient` en GLSL): −∇τ − P(∂B/∂c·∇c + ∂B/∂f·∇f),
 * P = I − ∇τ∇τᵀ/|∇τ|² (la proyección sin su curvatura; el centro de fila se toma constante en z). La pendiente es la
 * de la celda bilineal, con sus mismas cuatro esquinas: ninguna lectura más. null en U o fuera.
 */
export function s0028WallFaceGradient(p: Vec3, boundary: S0028Boundary): { sd: number; gradient: Vec3 } | null {
  if (anatomyBundle.person !== 's0028') return null;
  const q = directProjection(p);
  if ('kind' in q) return null;
  const cell = chartCell(columnOf(Math.atan2(q.y, q.x)), (q.surface[2] + 210) / 1.5);
  if (!cell.known) return null;
  const [page, k] = PAGE_CHANNEL[boundary];
  const b = cell.mix(page, k),
    [dc, dr] = cell.slope(page, k);
  const a = ((512 / (2 * Math.PI)) * dc) / Math.max(q.x * q.x + q.y * q.y, 0.000001);
  const v: Vec3 = [-q.y * a, q.x * a, dr / 1.5],
    g = q.g;
  const t = (g[0] * v[0] + g[1] * v[1] + g[2] * v[2]) / q.gg;
  return { sd: -q.depth - b, gradient: [-g[0] - v[0] + g[0] * t, -g[1] - v[1] + g[1] * t, -g[2] - v[2] + g[2] * t] };
}

const known = (code: number) => Math.floor(code / 8) % 4 !== 0 && Math.floor(code / 32) % 4 !== 0 && Math.floor(code / 128) % 4 !== 0;

/**
 * null significa que no existe una cara interna demostrada; no es profundidad cero. Gemela exacta de
 * `s0028WallAt(p).depthMm − interfaceMm` (mismas operaciones en el mismo orden) sin objetos intermedios: el 3D la
 * pide una vez por vértice para el peso respiratorio.
 */
export function s0028InsideWall(p: Vec3): number | null {
  if (anatomyBundle.person !== 's0028' || !buffers) return null;
  const [x, y, z] = p;
  const depth = s0028DepthXyz(x, y, z);
  if (depth === undefined) return null;
  const gx = (s0028DepthXyz(x + 1.5, y, z)! - s0028DepthXyz(x - 1.5, y, z)!) / 3,
    gy = (s0028DepthXyz(x, y + 1.5, z)! - s0028DepthXyz(x, y - 1.5, z)!) / 3,
    gz = (s0028DepthXyz(x, y, z + 1.5)! - s0028DepthXyz(x, y, z - 1.5)!) / 3;
  const gg = gx * gx + gy * gy + gz * gz;
  if (gg <= 0.000001 || depth > 6) return null;
  const sx = x - (depth * gx) / gg,
    sy = y - (depth * gy) / gg,
    sz = z - (depth * gz) / gg;
  if (sz < -210 || sz > 60) return null;
  const tiles = buffers.tiles,
    row = (sz + 210) / 1.5,
    lo = Math.floor(row),
    hi = Math.min(180, lo + 1),
    t = row - lo;
  const cy = HALF[tiles[16 * TILE_WORDS + 2 * lo + 1]] * (1 - t) + HALF[tiles[16 * TILE_WORDS + 2 * hi + 1]] * t;
  const col = columnOf(Math.atan2(sy - cy, sx)),
    cx = Math.floor(col),
    ry = Math.min(179, Math.floor(row));
  const base = (Math.floor(ry / 90) * 8 + Math.floor(cx / 64)) * TILE_WORDS + ((91 + (ry % 90)) * 65 + (cx % 64)) * 2;
  if (!known(HALF[tiles[base + 1]]) || !known(HALF[tiles[base + 3]]) || !known(HALF[tiles[base + 131]]) || !known(HALF[tiles[base + 133]]))
    return null;
  const fx = col - cx,
    fy = row - ry;
  const a = HALF[tiles[base]] + fx * (HALF[tiles[base + 2]] - HALF[tiles[base]]);
  const b = HALF[tiles[base + 130]] + fx * (HALF[tiles[base + 132]] - HALF[tiles[base + 130]]);
  return -depth - (a + fy * (b - a));
}
