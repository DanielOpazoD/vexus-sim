import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { selectAnatomy, S0028_BUNDLE } from '../anatomy/anatomyBundle';
import { loadS0028, s0028Auxiliary, verifyS0028Manifest } from '../anatomy/loadS0028';
import { s0028SkinPoint, s0028WallSurface } from '../anatomy/s0028Wall';
import { s0028Depth } from '../anatomy/abdominalAtlas';

describe('selección anterior a escena y carga de una persona', () => {
  it('conserva el default y rechaza combinaciones incompatibles', () => {
    expect(selectAnatomy(new URLSearchParams()).person).toBe('current');
    expect(selectAnatomy(new URLSearchParams('abdomen=legacy')).person).toBe('legacy');
    expect(selectAnatomy(new URLSearchParams('abdomen=s0028'))).toBe(S0028_BUNDLE);
    expect(() => selectAnatomy(new URLSearchParams('abdomen=s0028&reference=1'))).toThrow(/incompatible/);
    expect(Object.isFrozen(S0028_BUNDLE.fields[0].offset)).toBe(true);
  });
  it('rechaza bytes de manifiesto cambiados aunque tengan JSON válido', async () => {
    const bytes = new Uint8Array(readFileSync('src/anatomy/s0028/candidate-manifest.bin'));
    await expect(verifyS0028Manifest(bytes)).resolves.toBeUndefined();
    const corrupt = bytes.slice();
    const at = corrupt.findIndex((v) => v === 49);
    corrupt[at] = 50;
    await expect(verifyS0028Manifest(corrupt)).rejects.toThrow(/procedencia/);
  });
  it('abortar antes del fetch no instala un paquete', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadS0028(controller.signal)).rejects.toThrow();
  });
  it('el cargador real instala pared y piel desde los buffers P1 verificados, sin otra descarga', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', (input: URL) => {
      const url = new URL(input);
      url.search = '';
      fetched.push(url.pathname);
      return Promise.resolve(new Response(new Uint8Array(readFileSync(url)).buffer));
    });
    try {
      await loadS0028(new AbortController().signal);
      expect(fetched).toHaveLength(6);
      expect(fetched.filter((p) => p.endsWith('annotation-capacity.gzip.bin'))).toHaveLength(1);
      expect(s0028Auxiliary?.capacity.byteLength).toBe(5_671_296);
      expect(s0028WallSurface(Math.PI / 2, -90)).toMatchObject({ kind: 'known', outerMm: 34.0625, innerMm: 39.9375 });
      expect(Math.abs(s0028Depth(s0028SkinPoint(Math.PI / 2, -90)!)!)).toBeLessThan(0.00001);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
