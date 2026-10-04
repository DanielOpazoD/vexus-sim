import { describe, expect, it } from 'vitest';
import { spectralAxis, spectralBinAt } from '../ui/spectralAxis';
describe('línea de base PW: presentación con banda de muestreo intacta', () => {
  it('conserva el ancho equivalente a una PRF y coloca exactamente el cero', () => {
    for (const scale of [10, 20, 30, 40])
      for (const shift of [-0.4, -0.2, 0, 0.2, 0.4]) {
        const a = spectralAxis(scale, shift);
        expect(a.maxCms - a.minCms).toBeCloseTo(2 * scale, 12);
        expect(a.fractionOf(0)).toBe(a.zeroFraction);
        expect(a.fractionOf(a.maxCms)).toBeCloseTo(0, 12);
        expect(a.fractionOf(a.minCms)).toBeCloseTo(1, 12);
        expect(spectralBinAt(a.zeroFraction, 128, shift)).toBe(64);
      }
  });
  it('el desplazamiento de la base corresponde a los mismos bins físicos', () => {
    for (const velocity of [-8, -4, 0, 4, 8]) {
      const a = spectralAxis(20, 0),
        b = spectralAxis(20, 0.3);
      expect(spectralBinAt(a.fractionOf(velocity), 128, 0)).toBe(spectralBinAt(b.fractionOf(velocity), 128, 0.3));
    }
  });
  it('los centros de los 128 bins conservan identidad al desplazar el cero', () => {
    for (const shift of [-0.4, -0.15, 0, 0.2, 0.4])
      for (let k = 0; k < 128; k++) expect(spectralBinAt(1 - k / 128 + shift, 128, shift)).toBe(k);
  });
  it('no permite escalas no finitas ni un cero fuera de la pantalla', () => {
    for (const [scale, shift] of [
      [0, 0],
      [-1, 0],
      [NaN, 0],
      [20, NaN],
      [20, 0.5],
    ])
      expect(() => spectralAxis(scale, shift)).toThrow();
  });
});
