import { describe, expect, it } from 'vitest';
import type { Torso } from '../anatomy/primitives';
import { wallArc, wallDepths } from '../anatomy/organs/wall';
import type { Vec3 } from '../core/vec3';
import { fatSeptum, laminaDistance, muscleStriation } from '../ultrasound/wallTexture';

// Fantoma de textura, no persona: compartimentos largos para resolver líneas espectrales.
// Muestrea las funciones de producto, no una reconstrucción de sus techos.
const torso: Torso = { a: 400, b: 400, zMin: -500, zMax: 500, skinMm: 2, fatMm: 120, muscleMm: 120, preperitonealMm: 2 };
const step = 0.025;
const count = 4096;
const sd = (x: number[]) => {
  const mean = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / x.length);
};
function profile(kind: 'fat' | 'muscle', angle: number, z: number) {
  const point = (d: number): Vec3 => [(400 - d) * Math.sin(angle), (400 - d) * Math.cos(angle), z];
  const w = wallDepths(torso, wallArc(point(0), torso), z);
  const start = (kind === 'fat' ? w.skin : w.fascia) + 3;
  const sample = kind === 'fat' ? fatSeptum : muscleStriation;
  return Array.from({ length: count }, (_, i) => sample(point(start + i * step), torso)[3]);
}
function peaks(x: number[]) {
  const indices: number[] = [];
  for (let i = 10; i < x.length - 10; i++) {
    const background = Math.max(Math.min(...x.slice(i - 10, i)), Math.min(...x.slice(i + 1, i + 11)));
    // Prominencia 0,05 en ±0,25 mm: excluye oscilaciones de redondeo sobre un septo
    // vertical casi constante, sin exigir que el máximo coincida con una fase esperada.
    if (x[i] > x[i - 1] && x[i] >= x[i + 1] && x[i] - background > 0.05) indices.push(i * step);
  }
  return indices;
}
// DFT en la banda 0,15–3 ciclos/mm. Tres bins adyacentes recogen la fuga de Hann.
// El 20 % es un detector sintético de peine, no un criterio clínico de textura.
function dominantFraction(x: number[]) {
  const mean = x.reduce((a, b) => a + b, 0) / x.length;
  const window = x.map((v, i) => (v - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1))));
  const power: number[] = [];
  for (let k = Math.ceil(0.15 * count * step); k <= Math.floor(3 * count * step); k++) {
    let re = 0,
      im = 0;
    for (let i = 0; i < count; i++) {
      const a = (2 * Math.PI * k * i) / count;
      re += window[i] * Math.cos(a);
      im -= window[i] * Math.sin(a);
    }
    power.push(re * re + im * im);
  }
  const total = power.reduce((a, b) => a + b, 0);
  return Math.max(...power.slice(1, -1).map((v, i) => power[i] + v + power[i + 2])) / total;
}

describe('la pared no repite un peine axial', () => {
  it('no salta al cambiar de celda axial, incluso si el techo anterior es el más cercano', () => {
    const h = 1e-5;
    for (const [u, v] of [
      [-13, 7],
      [2, -9],
      [71.3, 83.7],
    ])
      for (let k = -20; k < 80; k++) {
        // Distancia al conjunto fijo de techos: Lipschitz 1, incluso en sus bisectrices.
        expect(Math.abs(laminaDistance(k + h, u, v) - laminaDistance(k - h, u, v))).toBeLessThanOrEqual(2 * h + 1e-12);
      }
  });
  for (const kind of ['fat', 'muscle'] as const) {
    for (const [angle, z] of [
      [0.16, -83],
      [0.42, -31],
      [0.83, -117],
    ]) {
      it(`${kind}, ${angle}/${z}: separaciones irregulares y sin línea espectral dominante`, () => {
        // Una línea dentro de un septo vertical es casi constante y no mide techos.
        // Buscar la primera columna vecina con contraste resuelto evita contar ruido
        // de redondeo como picos; no selecciona por separación ni por espectro.
        const x = [0, 0.005, 0.01, 0.015]
          .map((offset) => profile(kind, angle + offset, z))
          .find((values) => Math.max(...values) - Math.min(...values) > 0.2);
        expect(x, 'columna con techos resolubles').toBeDefined();
        const p = peaks(x!);
        expect(p.length).toBeGreaterThan(20);
        const gaps = p.slice(1).map((v, i) => v - p[i]);
        expect(sd(gaps)).toBeGreaterThan(0.3);
        expect(dominantFraction(x!)).toBeLessThan(0.2);
      });
    }
  }
  it('el detector rechaza un peine aun con amplitudes y fase no constantes', () => {
    const x = Array.from({ length: count }, (_, i) => {
      const s = (i * step) / 2.4 + 0.17;
      return (0.6 + 0.4 * Math.sin((i * step) / 9) ** 2) * Math.exp(-0.5 * (((s - Math.round(s)) * 2.4) / 0.15) ** 2);
    });
    expect(dominantFraction(x)).toBeGreaterThan(0.2);
  });
});
