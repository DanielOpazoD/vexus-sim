import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { selectAnatomy, S0028_BUNDLE } from '../anatomy/anatomyBundle';
import { loadS0028, verifyS0028Manifest } from '../anatomy/loadS0028';

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
});
