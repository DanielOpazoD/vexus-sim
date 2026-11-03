import { afterEach, expect, it, vi } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { ABDOMINAL_ATLAS } from '../anatomy/abdominalAtlasData';
import { createAbdominalTexture } from '../ultrasound/abdominalTexture';

afterEach(() => setAbdominalAtlas());

it('sube todos los texeles en orden sin reservar una transferencia del tamaño del atlas completo', () => {
  const data = new Uint16Array(ABDOMINAL_ATLAS.rawBytes / 2);
  setAbdominalAtlas(data);
  const uploads: Uint16Array[] = [];
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
    texStorage3D: vi.fn(),
    deleteTexture: vi.fn(),
    texImage3D: (
      _t: number,
      _l: number,
      _i: number,
      _w: number,
      _h: number,
      _d: number,
      _b: number,
      _f: number,
      _s: number,
      input: Uint16Array,
    ) => uploads.push(input),
    texSubImage3D: (
      _t: number,
      _l: number,
      _x: number,
      _y: number,
      _z: number,
      _w: number,
      _h: number,
      _d: number,
      _f: number,
      _s: number,
      input: Uint16Array,
    ) => uploads.push(input),
  };
  createAbdominalTexture(gl as unknown as WebGL2RenderingContext, true);
  expect(uploads.length).toBeGreaterThan(1);
  let offset = 0;
  for (const input of uploads) {
    // 4 MiB es el máximo de transferencia, no un cambio de resolución/almacenamiento.
    expect(input.byteLength).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(input.buffer).toBe(data.buffer);
    expect(input.byteOffset).toBe(offset);
    offset += input.byteLength;
  }
  expect(offset).toBe(data.byteLength);
});
