import { describe, expect, it } from 'vitest';
import { presentationPower, spectralGrey } from '../ui/spectralPresentation';
import type { SpectralColumn } from '../doppler/spectral';
const col = (t: number, db: number, prfHz = 2000): SpectralColumn => ({ t, powerDb: new Float32Array([db, db - 10]), prfHz });
describe('presentación PW de potencia observada', () => {
  it('promedia potencia lineal y conserva una entrada constante, con sus unidades', () => {
    const same = [col(0, -30), col(0.008, -30), col(0.016, -30)];
    expect([...presentationPower(same, 1)]).toEqual([-30, -40]);
    const varying = [col(0, -40), col(0.008, -20), col(0.016, -40)];
    expect(presentationPower(varying, 1)[0]).toBeCloseTo(10 * Math.log10(0.25 * 0.0001 + 0.5 * 0.01 + 0.25 * 0.0001), 5);
  });
  it('no conecta huecos temporales ni mezcla PRF distintas', () => {
    const current = col(0.008, -30);
    expect([...presentationPower([col(-1, 0), current, col(0.016, 0, 3000)], 1)]).toEqual([-30, -40]);
  });
  it('conserva bins, tiempos y señal de entrada; actualiza el extremo al llegar una columna', () => {
    const columns = [col(0, -40), col(0.008, -20)];
    const before = JSON.stringify(columns);
    const first = presentationPower(columns, 1);
    expect(presentationPower(columns, 1)).toBe(first);
    expect(JSON.stringify(columns)).toBe(before);
    columns.push(col(0.016, -40));
    const next = presentationPower(columns, 1);
    expect(next).not.toBe(first);
    expect(next).toHaveLength(2);
    expect(columns[1].t).toBe(0.008);
    expect([...columns[1].powerDb]).toEqual([-20, -30]);
  });
  it('la compresión es monótona y recorta solamente brillo, no frecuencia ni velocidad', () => {
    for (const gainDb of [-6, 0, 15, 24])
      for (const dynamicRangeDb of [20, 25, 45, 60]) {
        const p = { gainDb, dynamicRangeDb };
        const values = Array.from({ length: 151 }, (_, i) => spectralGrey(i - 100, p));
        expect(values).toEqual([...values].sort((a, b) => a - b));
        expect(values.every((v) => v >= 0 && v <= 255)).toBe(true);
        expect(spectralGrey(-200, p)).toBe(0);
        expect(spectralGrey(100, p)).toBe(255);
      }
  });
});
