import type { SpectralColumn } from '../doppler/spectral';

export interface SpectralPresentation {
  gainDb: number;
  dynamicRangeDb: number;
}
export const VENOUS_PW_PRESENTATION: readonly SpectralPresentation[] = [
  { gainDb: 0, dynamicRangeDb: 45 },
  { gainDb: 15, dynamicRangeDb: 25 },
  { gainDb: 15, dynamicRangeDb: 25 },
];
const cache = new WeakMap<SpectralColumn, { before: Float32Array | undefined; after: Float32Array | undefined; db: Float32Array }>();
/** Short symmetric power averaging, not envelope filling. No frequency bins or timestamps move. */
export function presentationPower(columns: readonly SpectralColumn[], index: number): Float32Array {
  const c = columns[index],
    hop = 16 / c.prfHz;
  const adjacent = (n: SpectralColumn | undefined) =>
    n && n.prfHz === c.prfHz && n.powerDb.length === c.powerDb.length && Math.abs(n.t - c.t) <= hop * 1.01 ? n : undefined;
  const before = adjacent(columns[index - 1]),
    after = adjacent(columns[index + 1]);
  const old = cache.get(c);
  if (old && old.before === before?.powerDb && old.after === after?.powerDb) return old.db;
  const db = Float32Array.from(
    c.powerDb,
    (v, k) =>
      10 * Math.log10(0.5 * 10 ** (v / 10) + 0.25 * 10 ** ((before?.powerDb[k] ?? v) / 10) + 0.25 * 10 ** ((after?.powerDb[k] ?? v) / 10)),
  );
  cache.set(c, { before: before?.powerDb, after: after?.powerDb, db });
  return db;
}
/** Digital display gain and logarithmic range; source power and measurements remain unchanged. */
export function spectralGrey(db: number, p: SpectralPresentation): number {
  return Math.round(255 * Math.max(0, Math.min(1, (db + p.gainDb + 7 + p.dynamicRangeDb) / p.dynamicRangeDb)) ** 1.4);
}
