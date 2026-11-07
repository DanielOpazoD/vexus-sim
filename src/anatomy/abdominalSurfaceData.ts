/** Generated from the acoustic signed-distance field. */
import { ABDOMINAL_FIELDS } from './abdominalAtlasData';
export const ABDOMINAL_SURFACE = {
  sourceFieldSha256: '76035fc4dc973950ecd8df98e76d7e8fcbacd0f5f4dde5ba4719ded514d5b1d4',
  rawBytes: 33308640,
  gzipBytes: 6014991,
  sha256Gzip: '5527723b4a4f4a75901224da4448fde11f963924c8379e3c7bc9080c13a12e7f',
  sha256Raw: 'b549b40dd2e46be2bec201cb8687845c674b43230dd4d41f07f60608eb1ec879',
  fields: (
    [
      [0, 48924],
      [146772, 1035840],
      [3254292, 37548],
      [3366936, 48132],
      [3511332, 345984],
      [4549284, 69852],
      [4758840, 60912],
      [4941576, 15468],
      [4987980, 433464],
      [6288372, 225708],
      [6965496, 81492],
    ] as const
  ).map(([offset, count], i) => ({ name: ABDOMINAL_FIELDS[i].name, offset, count })),
  envelopes: (
    [
      [7209972, 100584, 0, false],
      [7511724, 102300, 0, true],
      [7818624, 83712, 1, false],
      [8069760, 85800, 1, true],
    ] as const
  ).map(([offset, count, side, fascia]) => ({
    offset,
    count,
    side,
    fascia,
    name: (fascia ? 'Fascia renal ' : 'Grasa perirrenal ') + (side ? 'izquierda' : 'derecha'),
  })),
} as const;
