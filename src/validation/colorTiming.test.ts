import { describe, expect, it } from 'vitest';
import { acquisitionSchedule, type AcquisitionRequest } from '../ultrasound/acquisitionSchedule';
import { COLOR_LINE_SPACING_RAD, colorLineCount } from '../ultrasound/colorTiming';
import fixture from './support/acquisitionCases.json';
import { Fraction, intervals, intervalIssues } from './support/acquisitionIntervals';

const q = Fraction.of;
const get = (id: string) => fixture.cases.find((c) => c.id === id)!;
const tau = (depth: number, p: AcquisitionRequest) => q(2).mul(q(depth)).div(q(p.cMmS));
const previous = (x: number) => {
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, x);
  bits.setBigUint64(0, bits.getBigUint64(0) - 1n);
  return bits.getFloat64(0);
};

/** Replaces mean-duty/strict-depth monotonicity with whole nonoverlapping intervals. */
describe('calendario de recepción completo', () => {
  for (const p of fixture.cases)
    it(p.id, () => {
      const s = acquisitionSchedule(p),
        x = intervals(p, s);
      expect(intervalIssues(p, x)).toEqual([]);
      expect(s.frameS).toBeCloseTo(x.ends[0].value(), 14);
      if (p.pwPrf) {
        const minimum = [q(1).div(q(p.pwPrf)), tau(p.gateFarMm, p).add(tau(p.depthMm, p))];
        if (p.colorPrf) minimum.push(tau(p.gateFarMm, p).add(tau(p.colorFarMm, p)));
        expect(minimum.every((v) => q(s.T!).cmp(v) >= 0)).toBe(true);
        expect(minimum.some((v) => q(previous(s.T!)).cmp(v) < 0)).toBe(true);
        expect(s.N).toBe(x.ticks[0]);
        expect(s.pwPrfHz).toBeCloseTo(q(1).div(x.T!).value(), 10);
        // Enumerate the policy independently, without capacities or floor estimates.
        if (p.colorPrf) {
          let n = 1,
            m = 1;
          if (q(1).div(x.T!).cmp(q(p.colorPrf)) > 0) {
            while (
              q(1)
                .div(x.T!.mul(q(m)))
                .cmp(q(p.colorPrf)) > 0
            )
              m++;
          } else {
            while (
              q(n + 1)
                .div(x.T!)
                .cmp(q(p.colorPrf)) <= 0 &&
              x.T!.div(q(n + 1)).cmp(tau(p.gateFarMm, p).add(tau(p.colorFarMm, p))) >= 0
            )
              n++;
          }
          expect(s.n || 1).toBe(n);
          expect(s.m || 1).toBe(m);
        }
      } else if (p.colorPrf) {
        const minima = [q(1).div(q(p.colorPrf)), tau(p.colorFarMm, p)];
        expect(minima.every((v) => q(s.delta!).cmp(v) >= 0)).toBe(true);
        expect(minima.some((v) => q(previous(s.delta!)).cmp(v) < 0)).toBe(true);
      }
      if (p.colorPrf) expect(s.colorPrfHz).toBeCloseTo(q(1).div(x.delta!).value(), 10);
    });

  for (const id of ['color-only-2000', 'pw-only-4000', 'triplex-4000', 'triplex-color-remainder'])
    it(`dos disparos por línea THI: ${id}`, () => {
      const p = { ...get(id), bLines: get(id).bLines * 2 },
        s = acquisitionSchedule(p),
        x = intervals(p, s);
      expect(intervalIssues(p, x)).toEqual([]);
      expect(s.frameS).toBeCloseTo(x.ends[0].value(), 14);
      if (p.pwPrf) expect(s.N).toBe(x.ticks[0]);
    });

  it('detecta duty medio, huecos agrupados, pérdida de resto Color, PW omitido y empaquetado incompleto', () => {
    const p = get('triplex-4000'),
      s = acquisitionSchedule(p);
    const bad = intervals(p, s),
      T = q(1).div(q(p.pwPrf)),
      tp = tau(p.gateFarMm, p);
    bad.events = Array.from({ length: 3 }, (_, index) => ({
      frame: 0,
      kind: 'PW' as const,
      index,
      start: T.mul(q(index)),
      end: T.mul(q(index)).add(tp),
    }));
    bad.events.push({ frame: 0, kind: 'B', index: 0, start: tp, end: tp.add(tau(p.depthMm, p)) });
    expect(intervalIssues(p, bad)).toContain('collision');
    const fast = get('triplex-fast-color-n'),
      sf = acquisitionSchedule(fast);
    const averageN = Math.floor((sf.T! - sf.tp) / sf.tc);
    expect(intervalIssues(fast, intervals(fast, sf, { n: averageN }))).toContain('collision');
    const remainder = get('triplex-color-remainder');
    expect(intervalIssues(remainder, intervals(remainder, acquisitionSchedule(remainder), { dropRemainder: true }))).toContain(
      'complete-counts',
    );
    const slow = get('triplex-500'),
      xs = intervals(slow, acquisitionSchedule(slow));
    xs.events = xs.events.filter((e) => !(e.frame === 0 && e.kind === 'PW' && e.index === 1));
    expect(intervalIssues(slow, xs)).toContain('pw-every-tick');
    const only = get('pw-only-500'),
      so = acquisitionSchedule(only);
    expect(intervals(only, so, { oneB: true }).ticks[0]).toBeGreaterThan(so.N!);
  });

  it('el oráculo rechaza incluso un solapamiento inferior a la precisión double', () => {
    const p = get('b-only-180'),
      x = intervals(p, acquisitionSchedule(p));
    x.events[1].start = x.events[1].start.sub(new Fraction(1n, 2n ** 100n));
    expect(intervalIssues(p, x)).toContain('collision');
  });

  it('preserva líneas, penalizaciones de caja/ensemble y la meseta física al caber B en los huecos', () => {
    expect(colorLineCount(0, 0.001)).toBe(4);
    expect(colorLineCount(-0.25, 0.25)).toBe(Math.ceil(0.5 / COLOR_LINE_SPACING_RAD));
    const p = get('color-only-2000'),
      base = acquisitionSchedule(p);
    for (const patch of [{ colorLines: 2 * p.colorLines }, { ensemble: 2 * p.ensemble }, { colorPrf: p.colorPrf / 2 }])
      expect(acquisitionSchedule({ ...p, ...patch }).frameS).toBeGreaterThan(base.frameS);
    expect(acquisitionSchedule({ ...p, depthMm: 80 }).frameS).toBe(base.frameS);
    expect(acquisitionSchedule({ ...p, depthMm: 300 }).frameS).toBeGreaterThan(base.frameS);
    for (const patch of [{ colorPrf: NaN }, { bLines: 0 }, { depthMm: Infinity }, { cMmS: 0 }])
      expect(() => acquisitionSchedule({ ...p, ...patch })).toThrow();
  });
});
