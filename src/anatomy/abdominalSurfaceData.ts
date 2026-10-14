/** Generated from the acoustic signed-distance field. */
import { ABDOMINAL_FIELDS } from './abdominalAtlasData';
export const ABDOMINAL_SURFACE = {
  sourceFieldSha256: 'b63ae6da6bda7ce4758297037dce45b5cb6fce3dca5ffbe5d88e319257e599e8',
  rawBytes: 32102928,
  gzipBytes: 5475809,
  sha256Gzip: '006b54d49c4141bf4ba43ce077a369383bccf408b63507e2051a4742ddfaa9d6',
  sha256Raw: 'fa03af07b192d93eb53d150e46ea59e19291b9064e951edbf31a29b0ad96e80d',
  fields: (
    [
      [0, 48924],
      [146772, 1035840],
      [3254292, 37548],
      [3366936, 48132],
      [3511332, 345984],
      [4549284, 54420],
      [4712544, 53700],
      [4873644, 15468],
      [4920048, 433464],
      [6220440, 227832],
      [6903936, 81492],
    ] as const
  ).map(([offset, count], i) => ({ name: ABDOMINAL_FIELDS[i].name, offset, count })),
  envelopes: (
    [
      [7148412, 73824, 0, false],
      [7369884, 75528, 0, true],
      [7596468, 70716, 1, false],
      [7808616, 72372, 1, true],
    ] as const
  ).map(([offset, count, side, fascia]) => ({
    offset,
    count,
    side,
    fascia,
    name: (fascia ? 'Fascia renal ' : 'Grasa perirrenal ') + (side ? 'izquierda' : 'derecha'),
  })),
} as const;
