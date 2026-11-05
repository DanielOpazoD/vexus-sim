import { anatomyBundle, S0028_BUNDLE as B } from './anatomyBundle';
import { s0028Depth, s0028DepthGradient, s0028DepthXyz } from './abdominalAtlas';
import { HALF } from './halfFloat';
import { S0028_WALL_PACKAGE as P } from './s0028WallData';
import { smoothstep, type Vec3 } from '../core/vec3';

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

let buffers: { tiles: Uint16Array; skin: Uint16Array; nearest: Uint16Array; ramps: Uint16Array } | undefined;
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
    // Rampa U por fila del bloque derivado E: la GPU la lee con el filtro lineal a lo largo de x, en un hueco libre.
    { offset: B.wallDerived.ramps.placement, size: B.wallDerived.ramps.size, data: buffers.ramps },
  ];
}
const TILE_WORDS = 65 * 91 * 2 * 2;
/** Mapa E por nodo (512×181 RG16F) del bloque derivado offline y su código del propio nodo conocido, (0+8)·32+(0+16). */
const E_WORDS = 512 * 181 * 2;
const E_SELF = 272;

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
  // Bloque derivado offline (tools/anatomy/s0028-wall-derived.py), tras el payload y del mismo payload: un nodo conocido
  // lleva su propia cara interna; un nodo U, NaN o la cara de un nodo conocido a su desplazamiento (≤12 mm, medido offline).
  // Nunca convierte un U en cara sin fuente. La rampa por fila es p10 < p90 de la cara interna conocida.
  const derived = new Uint16Array(capacity, 4096 + B.wall.payloadBytes, B.wallDerived.bytes / 2);
  const nearest = derived.subarray(0, E_WORDS),
    ramps = derived.subarray(E_WORDS, E_WORDS + 2 * 181);
  const nodeWord = (row: number, col: number, k: number) => {
    const band = row < 90 ? 0 : 1;
    return tiles[(band * 8 + (col >> 6)) * TILE_WORDS + ((91 + row - 90 * band) * 65 + (col & 63)) * 2 + k];
  };
  for (let row = 0; row < 181; row++)
    for (let col = 0; col < 512; col++) {
      const e = nearest[(row * 512 + col) * 2],
        code = HALF[nearest[(row * 512 + col) * 2 + 1]];
      if (known(HALF[nodeWord(row, col, 1)])) {
        if (e !== nodeWord(row, col, 0) || code !== E_SELF) throw new Error('Mapa E sin la cara de su nodo conocido');
        continue;
      }
      if (Number.isNaN(code)) {
        if (!Number.isNaN(HALF[e])) throw new Error('Mapa E con cara sin fuente');
        continue;
      }
      const r = row + Math.floor(code / 32) - 8,
        c = (col + (code % 32) - 16 + 512) % 512;
      if (!Number.isInteger(code) || code < 0 || code > 543 || code === E_SELF || r < 0 || r > 180 || !known(HALF[nodeWord(r, c, 1)]))
        throw new Error('Mapa E apunta a un nodo U');
      if (e !== nodeWord(r, c, 0)) throw new Error('Mapa E con otra cara');
    }
  for (let row = 0; row < 181; row++)
    if (!(HALF[ramps[2 * row]] > 1.5 && HALF[ramps[2 * row + 1]] > HALF[ramps[2 * row]] && HALF[ramps[2 * row + 1]] <= 80))
      throw new Error('Rampa respiratoria por fila inválida');
  buffers = { tiles, skin: new Uint16Array(skin), nearest, ramps };
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
  /** (∂/∂columna, ∂/∂fila) exacta de la misma bilineal, con sus cuatro esquinas (gemela de `s28Slope`). @twin s0028-pared */
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
 * @twin s0028-pared
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
 * @twin s0028-pared
 */
export function s0028InsideWall(p: Vec3): number | null {
  if (anatomyBundle.person !== 's0028' || !buffers) return null;
  return insideCore(p[0], p[1], p[2], null, false);
}

/** Profundidad y fila de carta (sin recortar el dominio, como `rc.y` en GLSL) de la última consulta U con salida. */
const U_QUERY = new Float64Array(2);
const rowOf = (sz: number) => Math.min(180, Math.max(0, (sz + 210) / 1.5));

/**
 * Núcleo sin objetos de `s0028InsideWall`. Con `u`, una consulta U deja en él profundidad y fila (la de la proyección con
 * max(|∇τ|², 1e-6), como GLSL). Con `contact`, la cara es la del mapa E en las cuatro esquinas (igual a la carta en una
 * celda D/E, bit a bit; en U la E del conocido más cercano a ≤12 mm) y null sólo si a una esquina le falta E.
 */
function insideCore(x: number, y: number, z: number, u: Float64Array | null, contact: boolean): number | null {
  const depth = s0028DepthXyz(x, y, z);
  if (depth === undefined || !buffers) return null;
  const gx = (s0028DepthXyz(x + 1.5, y, z)! - s0028DepthXyz(x - 1.5, y, z)!) / 3,
    gy = (s0028DepthXyz(x, y + 1.5, z)! - s0028DepthXyz(x, y - 1.5, z)!) / 3,
    gz = (s0028DepthXyz(x, y, z + 1.5)! - s0028DepthXyz(x, y, z - 1.5)!) / 3;
  const gg = gx * gx + gy * gy + gz * gz;
  if (gg <= 0.000001 || depth > 6) {
    if (u) {
      u[0] = depth;
      u[1] = rowOf(z - (depth * gz) / Math.max(gg, 0.000001));
    }
    return null;
  }
  const sx = x - (depth * gx) / gg,
    sy = y - (depth * gy) / gg,
    sz = z - (depth * gz) / gg;
  if (sz < -210 || sz > 60) {
    if (u) {
      u[0] = depth;
      u[1] = rowOf(sz);
    }
    return null;
  }
  const tiles = buffers.tiles,
    row = (sz + 210) / 1.5,
    lo = Math.floor(row),
    hi = Math.min(180, lo + 1),
    t = row - lo;
  const cy = HALF[tiles[16 * TILE_WORDS + 2 * lo + 1]] * (1 - t) + HALF[tiles[16 * TILE_WORDS + 2 * hi + 1]] * t;
  const col = columnOf(Math.atan2(sy - cy, sx)),
    cx = Math.floor(col),
    ry = Math.min(179, Math.floor(row));
  const fx = col - cx,
    fy = row - ry;
  if (contact) {
    const e = buffers.nearest,
      i0 = (ry * 512 + cx) * 2,
      i1 = (ry * 512 + ((cx + 1) % 512)) * 2;
    const a0 = HALF[e[i0]],
      a1 = HALF[e[i1]],
      b0 = HALF[e[i0 + 1024]],
      b1 = HALF[e[i1 + 1024]];
    if (Number.isNaN(a0) || Number.isNaN(a1) || Number.isNaN(b0) || Number.isNaN(b1)) return null;
    const a = a0 + fx * (a1 - a0);
    const b = b0 + fx * (b1 - b0);
    return -depth - (a + fy * (b - a));
  }
  const base = (Math.floor(ry / 90) * 8 + Math.floor(cx / 64)) * TILE_WORDS + ((91 + (ry % 90)) * 65 + (cx % 64)) * 2;
  if (
    !known(HALF[tiles[base + 1]]) ||
    !known(HALF[tiles[base + 3]]) ||
    !known(HALF[tiles[base + 131]]) ||
    !known(HALF[tiles[base + 133]])
  ) {
    if (u) {
      u[0] = depth;
      u[1] = row;
    }
    return null;
  }
  const a = HALF[tiles[base]] + fx * (HALF[tiles[base + 2]] - HALF[tiles[base]]);
  const b = HALF[tiles[base + 130]] + fx * (HALF[tiles[base + 132]] - HALF[tiles[base + 130]]);
  return -depth - (a + fy * (b - a));
}

/**
 * Profundidad (mm) bajo la cara interna del CONTACTO, no de la clasificación: la de la carta en una celda D/E (bit a bit
 * `s0028InsideWall`) y, en una celda U, la E bilineal del mapa derivado (cada esquina U toma la cara del nodo conocido más
 * cercano a ≤12 mm). null si a una esquina le falta E: allí la sonda acopla sólo por la piel, sin resistencia de pared.
 */
export function s0028ContactInside(p: Vec3): number | null {
  if (anatomyBundle.person !== 's0028' || !buffers) return null;
  return insideCore(p[0], p[1], p[2], null, true);
}

/** Cara interna del contacto en p y su procedencia rotulada: 'D/E' si la celda es de la carta, 'E' si es U con E. */
export function s0028ContactFace(p: Vec3): { insideMm: number; interfaceMm: number; source: 'D/E' | 'E' } | null {
  const inside = s0028ContactInside(p);
  if (inside === null) return null;
  return { insideMm: inside, interfaceMm: -torsoDepthOf(p) - inside, source: s0028InsideWall(p) === null ? 'E' : 'D/E' };
}
const torsoDepthOf = (p: Vec3) => s0028DepthXyz(p[0], p[1], p[2])!;

/** p10/p90 (mm) de la cara interna conocida en la fila `row`, interpolados entre lo/hi como la lectura filtrada GPU. */
function rampAt(row: number): [number, number] {
  const r = buffers!.ramps,
    lo = Math.floor(row),
    hi = Math.min(180, lo + 1),
    t = row - lo;
  return [HALF[r[2 * lo]] * (1 - t) + HALF[r[2 * hi]] * t, HALF[r[2 * lo + 1]] * (1 - t) + HALF[r[2 * hi + 1]] * t];
}

/**
 * Peso de pared del enlace respiratorio, sin el factor de columna (gemelo de `s28RespWall`). Celda D/E: smoothstep(0, 25,
 * profundidad bajo su cara interna), como siempre. Celda U, o fuera de la carta: rampa por profundidad smoothstep(p10,
 * p90, −τ) con la cara interna conocida de su fila (bloque derivado E). Sin objetos: el 3D lo pide una vez por vértice.
 * @twin s0028-pared
 */
export function s0028RespiratoryWall(p: Vec3): number {
  if (anatomyBundle.person !== 's0028' || !buffers) return 0;
  const inside = insideCore(p[0], p[1], p[2], U_QUERY, false);
  if (inside !== null) return smoothstep(0, 25, inside);
  const r = buffers.ramps,
    row = U_QUERY[1],
    lo = Math.floor(row),
    hi = Math.min(180, lo + 1),
    t = row - lo;
  return smoothstep(HALF[r[2 * lo]] * (1 - t) + HALF[r[2 * hi]] * t, HALF[r[2 * lo + 1]] * (1 - t) + HALF[r[2 * hi + 1]] * t, -U_QUERY[0]);
}

/** La rampa U en p (−τ y p10/p90 de su fila) para el gradiente respiratorio; null en una celda D/E. */
export function s0028RespiratoryRamp(p: Vec3): { x: number; d0: number; d1: number } | null {
  if (anatomyBundle.person !== 's0028' || !buffers) return null;
  if (insideCore(p[0], p[1], p[2], U_QUERY, false) !== null) return null;
  const [d0, d1] = rampAt(U_QUERY[1]);
  return { x: -U_QUERY[0], d0, d1 };
}
