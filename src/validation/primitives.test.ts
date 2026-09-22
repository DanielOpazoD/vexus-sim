import { describe, expect, it } from 'vitest';
import { kidneyLocal, kidneyQuery, kidneyWorld } from '../anatomy/organs/kidney';
import { smoothMax, smoothMin, tubeQuery, type Tube } from '../anatomy/primitives';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';

/**
 * Primitivas implícitas (`anatomy/primitives.ts`) con valores cerrados: sobre
 * los ejes principales las distancias salen exactas, así que las aserciones son
 * igualdades (± 1e-9), no desigualdades.
 */
describe('tubeQuery', () => {
  const recto: Tube = {
    kind: 'tube',
    nodes: [
      { p: [0, 0, 0], r: 5 },
      { p: [0, 0, 100], r: 5 },
    ],
    apScale: 1,
  };
  const conico: Tube = {
    ...recto,
    nodes: [
      { p: [0, 0, 0], r: 5 },
      { p: [0, 0, 100], r: 15 },
    ],
  };
  const plano: Tube = { ...recto, apScale: 0.5 };

  it('distancia con signo, ρ, radio interpolado y tangente', () => {
    const eje = tubeQuery([0, 0, 50], recto);
    expect(eje.d).toBeCloseTo(-5, 9);
    expect(eje.rho).toBeCloseTo(0, 9);
    expect(eje.r).toBe(5);
    expect(eje.s).toBeCloseTo(0.5, 9);
    expect(eje.tangent).toEqual([0, 0, 1]);
    expect(tubeQuery([3, 0, 50], recto).d).toBeCloseTo(-2, 9);
    expect(tubeQuery([3, 0, 50], recto).rho).toBeCloseTo(0.6, 9);
    expect(tubeQuery([8, 0, 50], recto).d).toBeCloseTo(3, 9);
    // más allá del extremo: distancia al último nodo
    expect(tubeQuery([0, 0, 150], recto).d).toBeCloseTo(45, 9);
    // radio interpolado y escala de calibre
    expect(tubeQuery([0, 0, 50], conico).r).toBeCloseTo(10, 9);
    expect(tubeQuery([0, 0, 50], conico, 2).r).toBeCloseTo(20, 9);
    expect(tubeQuery([0, 0, 50], conico, 2).d).toBeCloseTo(-20, 9);
  });

  it('sección elíptica: escala solo el semieje AP y conserva la tapa del extremo', () => {
    expect(tubeQuery([0, 2, 50], plano).d).toBeCloseTo(-1, 9); // semieje AP = 2,5
    expect(tubeQuery([0, 3, 50], plano).d).toBeCloseTo(1, 9);
    expect(tubeQuery([3, 0, 50], plano).d).toBeCloseTo(-2, 9); // lateral intacto
    // Defecto corregido: 50 mm más allá del extremo NO es el eje del vaso
    expect(tubeQuery([0, 0, 150], plano).d).toBeCloseTo(45, 9);
    expect(tubeQuery([0, 0, 150], plano).rho).toBeGreaterThan(1);
    // Reproducción con la cava real: 15 mm por encima del último nodo no es sangre
    const scene = new AnatomyScene(NORMAL_ADULT);
    const ivc = scene.vesselById.get('ivcSupra')!;
    expect(tubeQuery([-16, 2, 90], ivc.tube).d).toBeGreaterThan(0);
  });
});

describe('smoothMin / smoothMax', () => {
  it('valores cerrados, dualidad y coincidencia con min/max lejos de la mezcla', () => {
    expect(smoothMin(2, 2, 4)).toBeCloseTo(1, 12); // a − k/4
    expect(smoothMax(2, 2, 4)).toBeCloseTo(3, 12); // a + k/4
    expect(smoothMin(0, 1, 4)).toBeCloseTo(-0.5625, 12);
    expect(smoothMax(0, 1, 4)).toBeCloseTo(1.5625, 12);
    expect(smoothMin(0, 10, 4)).toBe(0);
    expect(smoothMax(0, 10, 4)).toBe(10);
    for (const [a, b] of [
      [0.3, -1.2],
      [5, 5.5],
      [-3, 2],
    ]) {
      expect(smoothMin(a, b, 3)).toBeCloseTo(-smoothMax(-a, -b, 3), 12);
    }
  });
});

describe('kidneyQuery', () => {
  const k = new AnatomyScene(NORMAL_ADULT).kidneyRight;

  it('seno, canal del hilio, pirámides fuera del hilio y marco local', () => {
    const centro = kidneyQuery(k.center, k);
    expect(centro.region).toBe('sinus');
    expect(centro.dSinus).toBeCloseTo(-8, 9); // sinusRadii.v 12 − sinusOffset 4
    expect(centro.dOuter).toBeCloseTo(-17, 9); // hasta la escotadura hiliar (10 mm de profundidad en la cara medial)
    // canal del hilio: fuera del elipsoide del seno pero dentro del canal (radio 7)
    const hilio = kidneyQuery(kidneyWorld([0, 14, 0], k), k);
    expect(hilio.region).toBe('sinus');
    expect(hilio.dSinus).toBeCloseTo(-7, 9);
    // escotadura hiliar: en la cara medial el contorno se hunde (forma de judía)
    expect(kidneyQuery(kidneyWorld([0, 24, 0], k), k).dOuter).toBeGreaterThan(0);
    expect(kidneyQuery(kidneyWorld([0, -24, 0], k), k).dOuter).toBeLessThan(0);
    expect(kidneyQuery(kidneyWorld([40, 14, 0], k), k).dOuter).toBeLessThan(0); // los polos conservan el contorno
    // pirámide lateral (θ = π, u = 13) frente al mismo radio hacia el hilio (θ = 0)
    expect(kidneyQuery(kidneyWorld([13, -18, 0], k), k).region).toBe('medulla');
    expect(kidneyQuery(kidneyWorld([13, 18, 0], k), k).region).toBe('cortex');
    // fuera del riñón: dOuter > 0 y la región no es interpretable
    expect(kidneyQuery(kidneyWorld([0, 0, 30], k), k).dOuter).toBeCloseTo(7, 9);
    // ida y vuelta del marco y ortonormalidad
    for (const q of [
      [0, 0, 0],
      [10, -5, 3],
      [-40, 20, -20],
    ] as [number, number, number][]) {
      const back = kidneyLocal(kidneyWorld(q, k), k);
      expect(back[0]).toBeCloseTo(q[0], 9);
      expect(back[1]).toBeCloseTo(q[1], 9);
      expect(back[2]).toBeCloseTo(q[2], 9);
    }
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(k.u, k.u)).toBeCloseTo(1, 12);
    expect(dot(k.v, k.v)).toBeCloseTo(1, 12);
    expect(dot(k.w, k.w)).toBeCloseTo(1, 12);
    expect(dot(k.u, k.v)).toBeCloseTo(0, 12);
    expect(dot(k.u, k.w)).toBeCloseTo(0, 12);
    expect(dot(k.v, k.w)).toBeCloseTo(0, 12);
  });
});
