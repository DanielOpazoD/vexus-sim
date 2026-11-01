/** Generated from the acoustic signed-distance field. */
import { ABDOMINAL_FIELDS } from './abdominalAtlasData';
export const ABDOMINAL_SURFACE = {
  sourceFieldSha256: 'b63ae6da6bda7ce4758297037dce45b5cb6fce3dca5ffbe5d88e319257e599e8',
  rawBytes: 32886144,
  gzipBytes: 5914463,
  sha256Gzip: '21404506e0233adffb2b35cb1b42c517701d4760c8757c5663de4ad0674508c6',
  sha256Raw: '54c8cba6515cb02c94ded59fdbc7ed8112884dcfae53b21dc9101f5f3dc687ae',
  fields: (
    [
      [0, 48924],
      [146772, 1035840],
      [3254292, 37548],
      [3366936, 48132],
      [3511332, 345984],
      [4549284, 61008],
      [4732308, 58128],
      [4906692, 15468],
      [4953096, 433464],
      [6253488, 227832],
      [6936984, 81492],
    ] as const
  ).map(([offset, count], i) => ({ name: ABDOMINAL_FIELDS[i].name, offset, count })),
  envelopes: (
    [
      [7181460, 88200, 0, false],
      [7446060, 91272, 0, true],
      [7719876, 82752, 1, false],
      [7968132, 84468, 1, true],
    ] as const
  ).map(([offset, count, side, fascia]) => ({
    offset,
    count,
    side,
    fascia,
    name: (fascia ? 'Fascia renal ' : 'Grasa perirrenal ') + (side ? 'izquierda' : 'derecha'),
  })),
} as const;
