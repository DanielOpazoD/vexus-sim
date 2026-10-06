import { describe, expect, it } from 'vitest';
import { stepCoupledOutflows, type OutflowBranch } from '../physiology/coupledOutflow';

describe('simultaneous venous outflow', () => {
  it('identical branches reduce to one resistor with twice the common outlet drop', () => {
    const b = { flow: 5, pressure: 12, resistance: 0.3, inertance: 0.004 };
    const [qh, qi] = stepCoupledOutflows(0.01, b, b, 2, 0.1);
    const expected = (b.inertance * b.flow + 0.01 * (12 - 2)) / (b.inertance + 0.01 * (0.3 + 0.2));
    expect(qh).toBeCloseTo(expected, 12);
    expect(qi).toBeCloseTo(expected, 12);
  });
  it('satisfies both momentum equations with the same new junction pressure', () => {
    const h = 0.001;
    const hepatic: OutflowBranch = { flow: -6, pressure: 9, resistance: 0.06, inertance: 0.004 };
    const ivc: OutflowBranch = { flow: 15, pressure: 14, resistance: 0.03, inertance: 0.0015 };
    for (const rj of [0, 0.01, 1, 100, 10000]) {
      const q = stepCoupledOutflows(h, hepatic, ivc, 5, rj);
      const pj = 5 + rj * (q[0] + q[1]);
      [hepatic, ivc].forEach((b, i) => {
        const residual = (b.inertance * (q[i] - b.flow)) / h - (b.pressure - pj - b.resistance * q[i]);
        expect(Math.abs(residual)).toBeLessThan(1e-9);
      });
    }
  });
  it('preserves a static solution and admits reversal without forcing direction', () => {
    const hepatic = { flow: -5, pressure: 2, resistance: 0.2, inertance: 0.004 };
    const ivc = { flow: 15, pressure: 6, resistance: 0.2, inertance: 0.0015 };
    const q = stepCoupledOutflows(0.02, hepatic, ivc, 2, 0.1);
    expect(q[0]).toBeCloseTo(-5, 12);
    expect(q[1]).toBeCloseTo(15, 12);
  });
  it('dissipates stored inertial energy at equal boundary pressures, even for a stiff outlet', () => {
    for (const rj of [0, 0.01, 10000]) {
      let q: [number, number] = [100, -30];
      let energy = Infinity;
      for (let i = 0; i < 40; i++) {
        q = stepCoupledOutflows(
          0.01,
          { flow: q[0], pressure: 5, resistance: 0.06, inertance: 0.004 },
          { flow: q[1], pressure: 5, resistance: 0.03, inertance: 0.0015 },
          5,
          rj,
        );
        const next = 0.5 * (0.004 * q[0] ** 2 + 0.0015 * q[1] ** 2);
        expect(next).toBeLessThan(energy);
        energy = next;
      }
    }
  });
});
