import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { installAnatomyBundle, S0028_BUNDLE as B } from '../anatomy/anatomyBundle';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setS0028Wall, s0028WallChart } from '../anatomy/s0028Wall';
import { HALF } from '../anatomy/halfFloat';
import { s0028ChartUploads, S0028_CHART_BYTES } from '../anatomy/gpu/s0028WallChart';

it('el auxiliar de carta conserva rejilla y geometría a <0,1 mm, dentro de la reserva y sin solapar campos', () => {
  installAnatomyBundle(B);
  const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
  setAbdominalAtlas(new Uint16Array(raw('abdominal-direct')));
  setS0028Wall(raw('annotation-capacity'), raw('skin-polar'));
  const uploads = s0028ChartUploads(),
    nodes = s0028WallChart(),
    page = 65 * 91 * 2;
  let maxPosition = 0,
    maxAt80 = 0;
  for (const [tile, upload] of uploads.entries()) {
    for (const f of [
      ...B.fields.filter((f) => f.asset === 'abdominal'),
      B.depth,
      ...B.wall.placements.map((offset) => ({ offset, dimensions: B.wall.tileSize })),
      { offset: B.wall.centerOffset, dimensions: [1, 181, 1] },
    ])
      expect(
        upload.offset.some((v, axis) => v + upload.size[axis] <= f.offset[axis] || f.offset[axis] + f.dimensions[axis] <= v),
        `tile ${tile}`,
      ).toBe(true);
    for (let row = 0; row < 91; row++)
      for (let col = 0; col < 65; col++) {
        const k = ((Math.floor(tile / 8) * 90 + row) * 512 + (((tile % 8) * 64 + col) % 512)) * 6,
          at = (row * 65 + col) * 2;
        const s = [
          HALF[upload.data[at]] + HALF[upload.data[at + page]],
          HALF[upload.data[at + 1]] + HALF[upload.data[at + page + 1]],
          nodes[k + 2],
        ];
        let x = HALF[upload.data[at + 2 * page]],
          y = HALF[upload.data[at + 2 * page + 1]];
        const z = 1 - Math.abs(x) - Math.abs(y),
          t = Math.max(0, Math.min(1, -z));
        x -= (x >= 0 ? 1 : -1) * t;
        y -= (y >= 0 ? 1 : -1) * t;
        const length = Math.hypot(x, y, z),
          normal = [x / length, y / length, z / length];
        maxPosition = Math.max(maxPosition, Math.hypot(...s.map((v, axis) => v - nodes[k + axis])));
        maxAt80 = Math.max(maxAt80, Math.hypot(...s.map((v, axis) => v - nodes[k + axis] - 80 * (normal[axis] - nodes[k + 3 + axis]))));
      }
  }
  expect(nodes.length).toBe(512 * 181 * 6);
  expect(maxPosition).toBeLessThan(0.0001);
  expect(maxAt80).toBeLessThan(0.1);
  expect(B.wall.payloadBytes + S0028_CHART_BYTES).toBeLessThanOrEqual(2_113_536);
  expect(uploads.reduce((n, u) => n + u.data.byteLength, 0)).toBe(S0028_CHART_BYTES);
});
