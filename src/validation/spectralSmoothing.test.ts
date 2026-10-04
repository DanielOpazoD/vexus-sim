import { describe, expect, it } from 'vitest';
import { captureColumns, WALL_SETTLE_S } from '../doppler/capture';
import { smoothSpectrum } from '../doppler/spectralMeasure';
import type { SpectralColumn } from '../doppler/spectral';

const column = (t: number, db: number, prfHz = 2000, n = 128): SpectralColumn => ({
  t,
  prfHz,
  powerDb: new Float32Array(n).fill(db),
});

describe('promedio espectral en coordenadas físicas compatibles', () => {
  it('promedia potencia lineal, conserva unidades y no modifica la adquisición', () => {
    const cols = [column(0, -40), column(0.008, -20), column(0.016, -40)];
    const before = cols.map((c) => [...c.powerDb]);
    const out = smoothSpectrum(cols);
    expect(out[1].powerDb[64]).toBeCloseTo(10 * Math.log10((0.0001 + 0.01 + 0.0001) / 3), 5);
    expect(cols.map((c) => [...c.powerDb])).toEqual(before);
    expect(out.map((c) => [c.t, c.prfHz])).toEqual(cols.map((c) => [c.t, c.prfHz]));
  });

  it('no mezcla bins que representan distintas frecuencias al cambiar la PRF', () => {
    const a = column(0, 0, 2000);
    const b = column(0.008, -60, 4000);
    const out = smoothSpectrum([a, b]);
    expect([...out[0].powerDb]).toEqual([...a.powerDb]);
    expect([...out[1].powerDb]).toEqual([...b.powerDb]);
  });

  it('cada columna conserva su propia resolución FFT', () => {
    const cols = [column(0, -10, 2000, 64), column(0.008, -60, 2000, 128)];
    const out = smoothSpectrum(cols);
    expect(out.map((c) => c.powerDb.length)).toEqual([64, 128]);
    expect(out.map((c) => [...c.powerDb])).toEqual(cols.map((c) => [...c.powerDb]));
  });

  it.each([0, -0.008, 1])('no inventa señal a través de una discontinuidad temporal de %s s', (t) => {
    const cols = [column(0, 0), column(t, -60)];
    expect(smoothSpectrum(cols).map((c) => [...c.powerDb])).toEqual(cols.map((c) => [...c.powerDb]));
  });

  it('el límite temporal sigue la duración física de la FFT y no un número fijo de milisegundos', () => {
    // 128/1000 = 128 ms: ventanas solapadas a 80 ms. A 4000 Hz duran solo 32 ms.
    const low = smoothSpectrum([column(0, 0, 1000), column(0.08, -60, 1000)]);
    const high = smoothSpectrum([column(0, 0, 4000), column(0.08, -60, 4000)]);
    expect(low[1].powerDb[64]).toBeGreaterThan(-4);
    expect(high[1].powerDb[64]).toBe(-60);
  });

  it('no propaga un pico anterior a una captura posterior de ruido', () => {
    const old = column(0, -60);
    old.powerDb[90] = 10;
    const fresh = column(1, -60);
    expect(smoothSpectrum([old, fresh])[1].powerDb[90]).toBe(-60);
    expect(smoothSpectrum([])).toEqual([]);
  });
});

describe('captura PW de un único tramo continuo', () => {
  it.each(['gap', 'clock', 'fft', 'prf'] as const)('descarta el tramo anterior y deja estabilizar el filtro tras %s', (kind) => {
    const previous = Array.from({ length: 20 }, (_, i) => column(i * 0.008, -30));
    const start = kind === 'gap' ? 1 : kind === 'clock' ? 0 : 0.16;
    const next = Array.from({ length: 30 }, (_, i) =>
      column(start + i * 0.008, -40, kind === 'prf' ? 3000 : 2000, kind === 'fft' ? 64 : 128),
    );
    const out = captureColumns([...previous, ...next], -1);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => next.includes(c))).toBe(true);
    expect(out.every((c) => c.t > start + WALL_SETTLE_S)).toBe(true);
  });

  it('conserva la captura ordinaria completa, salvo su límite temporal explícito', () => {
    const cols = Array.from({ length: 20 }, (_, i) => column(i * 0.008, -30));
    expect(captureColumns(cols, -1)).toEqual(cols);
    expect(captureColumns(cols, 0.08)).toEqual(cols.filter((c) => c.t > 0.08));
    expect(captureColumns([], 0)).toEqual([]);
  });
});
