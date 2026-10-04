import { describe, expect, it } from 'vitest';
import { spectralSampling } from '../doppler/spectralSampling';
import { SpectralProcessor, type SpectralColumn } from '../doppler/spectral';
const column = (prfHz = 2500, n = 128): SpectralColumn => ({ t: 2, prfHz, powerDb: new Float32Array(n) });
describe('información de muestreo real, sin promesa de exactitud', () => {
  it('deriva frecuencia, velocidad axial y ventana desde PRF y FFT reales', () => {
    expect(spectralSampling(column(), 2.5e6)).toEqual({ fftSize: 128, binHz: 19.53125, binCms: 0.6015625, windowMs: 51.2 });
  });
  it('más PRF aumenta el paso de velocidad y acorta la ventana sin cambiar FFT', () => {
    const a = spectralSampling(column(), 2.5e6)!;
    const b = spectralSampling(column(5000), 2.5e6)!;
    expect(b.binCms).toBe(a.binCms * 2);
    expect(b.windowMs).toBe(a.windowMs / 2);
    expect(b.fftSize).toBe(a.fftSize);
  });
  it('usa el tamaño recibido y separa frecuencia transmitida de tiempo de adquisición', () => {
    const a = spectralSampling(column(), 2.5e6)!;
    const b = spectralSampling(column(2500, 256), 2.5e6)!;
    expect(b.binCms).toBe(a.binCms / 2);
    expect(b.windowMs).toBe(a.windowMs * 2);
    const c = spectralSampling(column(), 5e6)!;
    expect(c.binCms).toBe(a.binCms / 2);
    expect(c.binHz).toBe(a.binHz);
    expect(c.windowMs).toBe(a.windowMs);
  });
  it('describe columnas del procesador real sin modificar potencia ni tiempos', () => {
    const p = new SpectralProcessor({ fftSize: 64, hop: 8 });
    p.sync(0, 4000);
    p.push(new Float32Array(80), new Float32Array(80), 80);
    const c = p.columns.at(-1)!;
    const before = structuredClone(c);
    expect(spectralSampling(c, 2.5e6)).toEqual({ fftSize: 64, binHz: 62.5, binCms: 1.925, windowMs: 16 });
    expect(c).toEqual(before);
    const other = { ...c, powerDb: Float32Array.from(c.powerDb, (x) => x + 30) };
    expect(spectralSampling(other, 2.5e6)).toEqual(spectralSampling(c, 2.5e6));
  });
  it('no inventa datos sin columnas y hace visibles los metadatos inválidos', () => {
    expect(spectralSampling(undefined, 2.5e6)).toBeNull();
    for (const value of [0, -1, NaN, Infinity]) {
      expect(() => spectralSampling(column(value), 2.5e6)).toThrow(RangeError);
      expect(() => spectralSampling(column(), value)).toThrow(RangeError);
    }
    for (const n of [0, 1]) expect(() => spectralSampling(column(2500, n), 2.5e6)).toThrow(RangeError);
    expect(() => spectralSampling(column(1e308), 1e-300)).toThrow(RangeError);
  });
});
