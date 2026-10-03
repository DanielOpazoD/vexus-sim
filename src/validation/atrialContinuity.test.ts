import { describe, expect, it } from 'vitest';
import { CASES } from '../cases';
import { RhythmGenerator } from '../physiology/rhythm';
import { RightAtriumModel, atrialBaselineWeight } from '../physiology/rightAtrium';
describe('continuidad de presión auricular en límites RR', () => {
  it('el peso conserva el área RR con intervalos cortos y largos, sin valores negativos', () => {
    for (const rr of [0.3, 0.43, 0.8, 1.7, 2.5]) {
      const start = 3.127,
        from = start - 0.02,
        to = start + rr + 0.02,
        n = 4000,
        dt = (to - from) / n;
      let integral = 0,
        min = Infinity,
        max = -Infinity;
      for (let i = 0; i < n; i++) {
        const w = atrialBaselineWeight(from + (i + 0.5) * dt, start, rr);
        min = Math.min(min, w);
        max = Math.max(max, w);
        integral += w * dt;
      }
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeLessThanOrEqual(1);
      expect(integral).toBeCloseTo(rr, 7);
      expect(atrialBaselineWeight(start - 0.021, start, rr)).toBe(0);
      expect(atrialBaselineWeight(start + rr + 0.021, start, rr)).toBe(0);
      expect(atrialBaselineWeight(start + rr / 2, start, rr)).toBe(1);
    }
  });
  it('las ventanas adyacentes suman uno, incluso con RR distintos', () => {
    const intervals = [0.3, 1.17, 0.43, 0.79, 2.1];
    let t = 0;
    const beats = intervals.map((rr) => {
      const b = { t, rr };
      t += rr;
      return b;
    });
    for (let x = 0.021; x < t - 0.021; x += 0.0037) {
      expect(beats.reduce((sum, b) => sum + atrialBaselineWeight(x, b.t, b.rr), 0)).toBeCloseTo(1, 12);
    }
  });
  it('el valor y la derivada son continuos en ambos bordes de cada transición', () => {
    const h = 1e-7,
      start = 1,
      rr = 0.8;
    const f = (t: number) => atrialBaselineWeight(t, start, rr);
    for (const t of [start - 0.02, start + 0.02, start + rr - 0.02, start + rr + 0.02]) {
      expect(Math.abs(f(t + h) - f(t - h))).toBeLessThan(1e-8);
      expect(Math.abs((f(t + h) - f(t)) / h - (f(t) - f(t - h)) / h)).toBeLessThan(0.001);
    }
  });

  it('no introduce un escalón de centrado al cambiar de latido, incluidos FA y los casos trampa', () => {
    for (const patient of CASES) {
      const rhythm = new RhythmGenerator(patient, patient.seed);
      const ra = new RightAtriumModel(patient, rhythm);
      for (const b of rhythm.beatsBetween(2, 20)) {
        const delta = Math.abs(ra.cardiacComponent(b.tR + 1e-7) - ra.cardiacComponent(b.tR - 1e-7));
        expect(delta, `${patient.id}, R=${b.tR}`).toBeLessThan(0.001);
      }
    }
  });
});
