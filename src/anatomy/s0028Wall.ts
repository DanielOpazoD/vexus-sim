import { anatomyBundle, S0028_BUNDLE as B } from './anatomyBundle';
import { abdominalAtlas, s0028Depth, s0028DepthGradient } from './abdominalAtlas';
import { HALF } from './halfFloat';
import { S0028_WALL_PACKAGE as P } from './s0028WallData';
import { dot, sub, type Vec3 } from '../core/vec3';

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
const TILE_WORDS = 65 * 91 * 2 * 2;
const CENTER_WORD = 16 * TILE_WORDS;

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

function centerY(z: number): number {
  const row = Math.max(0, Math.min(180, (z + 210) / 1.5));
  const a = Math.min(179, Math.floor(row)),
    t = row - a;
  return HALF[buffers!.tiles[CENTER_WORD + 2 * a + 1]] * (1 - t) + HALF[buffers!.tiles[CENTER_WORD + 2 * (a + 1) + 1]] * t;
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

/** Invierte el prisma de la normal CUTÁNEA, nunca la EDT saturada profunda. Sin ajuste visceral. */
export function s0028WallAt(p: Vec3): S0028WallSample | undefined {
  if (anatomyBundle.person !== 's0028') return undefined;
  if (!buffers || !abdominalAtlas) return { kind: 'unknown', reason: 'unloaded', depthMm: -(s0028Depth(p) ?? 0) };
  let z = p[2],
    phi = Math.atan2(p[1] - centerY(z), p[0]),
    depth = 0,
    error = Infinity;
  for (let i = 0; i < 10; i++) {
    const s = s0028SkinPoint(phi, z)!;
    const g = s0028DepthGradient(s)!;
    const norm = Math.hypot(...g) || 1;
    const n: Vec3 = [g[0] / norm, g[1] / norm, g[2] / norm];
    depth = dot(sub(s, p), n);
    const projected: Vec3 = [p[0] + depth * n[0], p[1] + depth * n[1], p[2] + depth * n[2]];
    error = Math.hypot(...sub(s, projected));
    if (error < 0.01) break;
    const nextZ = projected[2],
      nextPhi = Math.atan2(projected[1] - centerY(nextZ), projected[0]);
    // Relajación del inverso normal; los puntos sin solución no se rellenan como pared.
    const delta = Math.atan2(Math.sin(nextPhi - phi), Math.cos(nextPhi - phi));
    phi += 0.65 * delta;
    z += 0.65 * (nextZ - z);
  }
  if (error > B.wall.surfaceGeometry.prismResidualMaxMm || depth < -6) return { kind: 'unknown', reason: 'projection', depthMm: depth };
  return s0028WallSurface(phi, z, depth);
}

/** null significa que no existe una cara interna demostrada; no es profundidad cero. */
export function s0028InsideWall(p: Vec3): number | null {
  const q = s0028WallAt(p);
  return q?.kind === 'known' ? q.depthMm - q.interfaceMm : null;
}
