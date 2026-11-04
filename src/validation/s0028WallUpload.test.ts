import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { installAnatomyBundle, S0028_BUNDLE as B } from '../anatomy/anatomyBundle';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setS0028Wall } from '../anatomy/s0028Wall';
import { createAbdominalTexture } from '../ultrasound/abdominalTexture';

it('sube los 16 tiles RG16F y centros como vistas en el único atlas P1, sin copiar el atlas', () => {
  installAnatomyBundle(B);
  const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
  const data = new Uint16Array(B.abdominal.rawBytes / 2),
    capacity = raw('annotation-capacity');
  setAbdominalAtlas(data);
  setS0028Wall(capacity, raw('skin-polar'));
  const storage = vi.fn(),
    uploads: { x: number; y: number; z: number; w: number; h: number; d: number; input: Uint16Array }[] = [];
  const gl = {
    TEXTURE_3D: 0x806f,
    MAX_3D_TEXTURE_SIZE: 0x8073,
    RG16F: 0x822f,
    RG: 0x8227,
    HALF_FLOAT: 0x140b,
    NO_ERROR: 0,
    createTexture: () => ({}),
    bindTexture: vi.fn(),
    getParameter: () => 2048,
    getError: () => 0,
    texParameteri: vi.fn(),
    texStorage3D: storage,
    deleteTexture: vi.fn(),
    texSubImage3D: (
      _t: number,
      _l: number,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      _f: number,
      _s: number,
      input: Uint16Array,
    ) => uploads.push({ x, y, z, w, h, d, input }),
  };
  createAbdominalTexture(gl as unknown as WebGL2RenderingContext, true);
  expect(storage).toHaveBeenCalledExactlyOnceWith(gl.TEXTURE_3D, 1, gl.RG16F, ...B.abdominal.textureDimensions);
  for (const [tile, offset] of B.wall.placements.entries()) {
    const u = uploads.find((u) => u.x === offset[0] && u.y === offset[1] && u.z === offset[2] && u.w === 65 && u.h === 91 && u.d === 2);
    expect(u, `tile ${tile}`).toBeDefined();
    expect(u?.input.buffer).toBe(capacity);
    expect(u?.input.byteOffset).toBe(4096 + tile * 65 * 91 * 2 * 4);
  }
  const centre = uploads.find((u) => u.x === 48 && u.y === 0 && u.z === 398 && u.w === 1 && u.h === 181);
  expect(centre?.input.buffer).toBe(capacity);
  expect(centre?.input.byteLength).toBe(724);
  expect(data.every((x) => x === 0)).toBe(true);
});
