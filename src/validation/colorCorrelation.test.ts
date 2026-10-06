import { describe, expect, it } from 'vitest';
import { decodeColorCorrelation, smoothColorCorrelation } from '../ultrasound/colorCorrelation';

describe('color: suavizar correlación compleja conserva Nyquist y dirección', () => {
  it('une ±Nyquist por su fase sin inventar velocidad cero', () => {
    const phasor = (hz: number): readonly [number, number] => [Math.cos((2 * Math.PI * hz) / 1000), Math.sin((2 * Math.PI * hz) / 1000)];
    const samples = Array.from({ length: 9 }, (_, i) => phasor(i % 2 ? 490 : -490));
    const v = decodeColorCorrelation(...smoothColorCorrelation(samples), 1000);
    expect(Math.abs(v.frequencyHz)).toBeGreaterThan(490);
    expect(v.power).toBeGreaterThan(0.99);
    // El promedio incorrecto de frecuencias plegadas daría ~0 Hz con pesos equilibrados.
    expect(decodeColorCorrelation(-1, 0, 1000).frequencyHz).toBeCloseTo(500, 10);
  });
  it('reduce ruido incoherente, conserva señal uniforme y no crea potencia', () => {
    const equal = Array.from({ length: 9 }, () => [0.3, 0.4] as const);
    expect(smoothColorCorrelation(equal)).toEqual([0.3, 0.4]);
    expect(decodeColorCorrelation(0.3, 0.4, 1000).power).toBe(0.5);
    const cancellation = Array.from({ length: 9 }, (_, i) => [i % 2 ? -1 : 1, 0] as const);
    expect(decodeColorCorrelation(...smoothColorCorrelation(cancellation), 1000).power).toBe(0);
    expect(smoothColorCorrelation(Array.from({ length: 9 }, () => [0, 0] as const))).toEqual([0, 0]);
    expect(() => smoothColorCorrelation([])).toThrow(RangeError);
  });
});
