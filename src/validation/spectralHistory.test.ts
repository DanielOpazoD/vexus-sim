import { describe, expect, it } from 'vitest';
import { SPECTRAL_CAPTURE_SECONDS, SpectralProcessor } from '../doppler/spectral';

function acquire(prf: number, seconds: number, maxColumns?: number) {
  const s = new SpectralProcessor({ maxColumns });
  const n = Math.round(prf * seconds);
  const re = Float32Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 300 * i) / prf));
  const im = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 300 * i) / prf));
  s.sync(0, prf);
  s.push(re, im, n);
  return s.columns;
}

describe('historial PW suficiente para la ventana de captura', () => {
  it.each([6000, 12000])('retiene siete segundos a PRF %i sin cambiar potencia ni tiempos', (prf) => {
    const columns = acquire(prf, 9);
    expect(columns.at(-1)!.t - columns[0].t).toBeGreaterThanOrEqual(SPECTRAL_CAPTURE_SECONDS - 1e-9);
    expect(columns.length).toBeLessThanOrEqual(8192);
    expect(columns.slice(-16)).toEqual(acquire(prf, 9, 10000).slice(-16));
  });
  it('conserva las 2048 columnas de escalas habituales y respeta límites explícitos', () => {
    expect(acquire(2600, 18)).toEqual(acquire(2600, 18, 2048));
    expect(acquire(2600, 1, 3)).toHaveLength(3);
  });
  it('acota memoria incluso fuera del dominio de PRF del equipo', () => {
    expect(acquire(24000, 6)).toHaveLength(8192);
  });
});
