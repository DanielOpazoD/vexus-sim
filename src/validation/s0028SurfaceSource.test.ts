// @tier slow
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { S0028_SURFACE as M } from '../anatomy/s0028SurfaceData';
import { sourceSurface } from '../anatomy/sourceSurface';
import { S0028_BUNDLE as B } from './support/legacyPerson/anatomyBundle';

it('las 19 mallas offline conservan cada triángulo orientado del extractor fuente', async () => {
  for (const asset of ['abdominal', 'thoracic'] as const) {
    const bytes = new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${asset}-direct.gzip.bin`)));
    const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
    expect(hash(bytes)).toBe(B[asset].sha256Raw);
    const atlas = new Uint16Array(bytes.buffer);
    for (const field of B.fields.filter((f) => f.asset === asset)) {
      const source = await sourceSurface(atlas, field, B[asset].textureDimensions);
      const pinned = M.fields.find((f) => f.name === field.name);
      expect(pinned, field.name).toBeDefined();
      // Byte equality includes vertex order and winding, hence the same flat normal/lighting.
      expect(hash(new Uint8Array(source.positions.buffer)), field.name).toBe(pinned?.expandedSha256);
    }
  }
}, 180_000);
