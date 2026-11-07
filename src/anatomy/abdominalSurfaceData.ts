/** Generated from the acoustic signed-distance field. */
import { ABDOMINAL_FIELDS } from './abdominalAtlasData';
export const ABDOMINAL_SURFACE = {
  sourceFieldSha256: 'a6c8166310cbc6423467479f73ca78262a67169899f71e6700161c0137433875',
  rawBytes: 33277104,
  gzipBytes: 6006243,
  sha256Gzip: 'db2384367fb72109850286a7daad798d99c558208d216c5d85dece00568c5787',
  sha256Raw: 'd7e033781ae700dbe5640c5c4a2b75e7ed0b25e5ee3d14183453db6eff6ff52d',
  fields: (
    [
      [0, 48924],
      [146772, 1035840],
      [3254292, 37548],
      [3366936, 48132],
      [3511332, 345984],
      [4549284, 71628],
      [4764168, 58128],
      [4938552, 15468],
      [4984956, 433464],
      [6285348, 227832],
      [6968844, 81492],
    ] as const
  ).map(([offset, count], i) => ({ name: ABDOMINAL_FIELDS[i].name, offset, count })),
  envelopes: (
    [
      [7213320, 99660, 0, false],
      [7512300, 101772, 0, true],
      [7817616, 82752, 1, false],
      [8065872, 84468, 1, true],
    ] as const
  ).map(([offset, count, side, fascia]) => ({
    offset,
    count,
    side,
    fascia,
    name: (fascia ? 'Fascia renal ' : 'Grasa perirrenal ') + (side ? 'izquierda' : 'derecha'),
  })),
} as const;
