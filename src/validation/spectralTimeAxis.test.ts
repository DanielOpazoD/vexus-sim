import { describe, expect, it } from 'vitest';
import { spectralTimeAxis } from '../ui/spectralTimeAxis';
describe('barrido temporal PW y ECG compartido', () => {
  it('muestra los mismos instantes con más espacio horizontal sin cambiar el tiempo', () => {
    const six = spectralTimeAxis(30.88, 6),
      three = spectralTimeAxis(30.88, 3);
    expect(six.start).toBeCloseTo(24.88, 10);
    expect(three.start).toBeCloseTo(27.88, 10);
    for (const t of [28, 29, 30, 30.88]) {
      expect(three.fractionOf(t)).toBeCloseTo(2 * six.fractionOf(t) - 1, 12);
      expect(three.start + three.fractionOf(t) * three.span).toBeCloseTo(t, 12);
    }
    expect(three.fractionOf(30.88)).toBe(1);
  });
  it('un historial corto no inventa segundos anteriores al inicio', () => {
    const a = spectralTimeAxis(1.5, 6);
    expect(a.start).toBe(0);
    expect(a.span).toBe(1.5);
    expect(a.fractionOf(1.5)).toBe(1);
    expect(spectralTimeAxis(0, 3).fractionOf(0)).toBe(0);
  });
  it('rechaza datos temporales no representables', () => {
    for (const end of [-1, NaN, Infinity]) expect(() => spectralTimeAxis(end, 6)).toThrow(RangeError);
    for (const seconds of [-1, 0, 0.001, NaN, Infinity]) expect(() => spectralTimeAxis(30, seconds)).toThrow(RangeError);
  });
});
