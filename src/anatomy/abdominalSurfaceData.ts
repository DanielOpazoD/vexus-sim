/** Generated from the acoustic signed-distance field. */
import { ABDOMINAL_FIELDS } from './abdominalAtlasData';
export const ABDOMINAL_SURFACE = {
  sourceFieldSha256: '880f9434fb0d56b9229995525797de402b99386f3ac7b0361e4868487a7c8a19',
  rawBytes: 32291712,
  gzipBytes: 5323542,
  sha256Gzip: 'c07a115f1a21c133a638cdc20b4f9aa9f492cee58cfe927575128f3df8017024',
  sha256Raw: '8149389afe04a58ac0b787d473fa2c75335039899e1d76d161db413b47f71a3f',
  fields: (
    [
      [0, 48924],
      [146772, 1035840],
      [3254292, 37548],
      [3366936, 48132],
      [3511332, 345984],
      [4549284, 54936],
      [4714092, 54144],
      [4876524, 15468],
      [4922928, 433464],
      [6223320, 239112],
      [6940656, 81492],
    ] as const
  ).map(([offset, count], i) => ({ name: ABDOMINAL_FIELDS[i].name, offset, count })),
  envelopes: (
    [
      [7185132, 74340, 0, false],
      [7408152, 76272, 0, true],
      [7636968, 71988, 1, false],
      [7852932, 73332, 1, true],
    ] as const
  ).map(([offset, count, side, fascia]) => ({
    offset,
    count,
    side,
    fascia,
    name: (fascia ? 'Fascia renal ' : 'Grasa perirrenal ') + (side ? 'izquierda' : 'derecha'),
  })),
} as const;
