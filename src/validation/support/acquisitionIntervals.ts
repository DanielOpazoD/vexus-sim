/** Independent reception-interval oracle. No closed-form capacities or frame counts.
 * Fractions decode the exact binary string, independently of the runtime dyads.
 * Two frames expose boundary omissions; complete B pulses fill individual gaps.
 */
import type { AcquisitionRequest, AcquisitionSchedule } from '../../ultrasound/acquisitionSchedule';

export class Fraction {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d = 1n) {
    let a = n < 0n ? -n : n,
      b = d;
    while (b) [a, b] = [b, a % b];
    this.n = n / a;
    this.d = d / a;
  }
  static of(this: void, x: number): Fraction {
    const [whole, decimals = ''] = x.toString(2).split('.');
    return new Fraction(BigInt('0b' + whole + decimals), 2n ** BigInt(decimals.length));
  }
  add(b: Fraction): Fraction {
    return new Fraction(this.n * b.d + b.n * this.d, this.d * b.d);
  }
  sub(b: Fraction): Fraction {
    return new Fraction(this.n * b.d - b.n * this.d, this.d * b.d);
  }
  mul(b: Fraction): Fraction {
    return new Fraction(this.n * b.n, this.d * b.d);
  }
  div(b: Fraction): Fraction {
    return new Fraction(this.n * b.d, this.d * b.n);
  }
  cmp(b: Fraction): number {
    const v = this.n * b.d - b.n * this.d;
    return v < 0n ? -1 : v > 0n ? 1 : 0;
  }
  value(): number {
    return Number(this.n) / Number(this.d);
  }
}
const q = Fraction.of,
  zero = q(0),
  one = q(1);
type Pulse = { frame: number; kind: 'B' | 'C' | 'PW'; index: number; start: Fraction; end: Fraction };
export interface Intervals {
  events: Pulse[];
  ends: Fraction[];
  ticks: number[];
  T: Fraction | null;
  delta: Fraction | null;
}

export function intervals(
  p: AcquisitionRequest,
  s: AcquisitionSchedule,
  options: { dropRemainder?: boolean; oneB?: boolean; n?: number } = {},
): Intervals {
  const duration = {
    B: q(2).mul(q(p.depthMm)).div(q(p.cMmS)),
    C: q(2).mul(q(p.colorFarMm)).div(q(p.cMmS)),
    PW: q(2).mul(q(p.gateFarMm)).div(q(p.cMmS)),
  };
  const T = p.pwPrf ? q(s.T!) : null;
  const n = options.n ?? (s.n || 1),
    m = s.m || 1;
  const delta = p.colorPrf ? (T ? T.mul(q(m)).div(q(n)) : q(s.delta!)) : null;
  let count = p.colorPrf ? p.colorLines * p.ensemble : 0;
  if (options.dropRemainder) count -= count % n;
  const result: Intervals = { events: [], ends: [], ticks: [], T, delta };
  let base = zero;
  for (let frame = 0; frame < 2; frame++) {
    let b = 0,
      c = 0,
      tick = 0,
      hold = 0,
      end = zero;
    const append = (kind: Pulse['kind'], index: number, start: Fraction) =>
      result.events.push({ frame, kind, index, start: base.add(start), end: base.add(start).add(duration[kind]) });
    const fill = (start: Fraction, stop: Fraction, used = 0) => {
      while (b < p.bLines && start.add(duration.B).cmp(stop) <= 0 && (!options.oneB || used < 1)) {
        append('B', b++, start);
        start = start.add(duration.B);
        used++;
      }
      return used;
    };
    if (T) {
      while (tick < 100_000) {
        const start = T.mul(q(tick));
        append('PW', tick, start);
        let cursor = start.add(duration.PW),
          used = 0;
        if (c < count && tick % m === 0) {
          for (let j = 0; j < n && c < count; j++) {
            const at = start.add(duration.PW).add(delta!.mul(q(j)));
            used = fill(cursor, at, used);
            append('C', c++, at);
            cursor = at.add(duration.C);
          }
          hold = tick + m;
        }
        end = T.mul(q(++tick));
        fill(cursor, end, used);
        if (b === p.bLines && c === count && tick >= hold) break;
      }
      if (tick === 100_000) throw new Error('Unbounded oracle');
    } else {
      for (; c < count; c++) {
        const at = delta!.mul(q(c));
        append('C', c, at);
        end = delta!.mul(q(c + 1));
        fill(at.add(duration.C), end);
      }
      while (b < p.bLines) {
        append('B', b++, end);
        end = end.add(duration.B);
      }
    }
    base = base.add(end);
    result.ends.push(base);
    result.ticks.push(tick);
  }
  return result;
}

export function intervalIssues(p: AcquisitionRequest, x: Intervals): string[] {
  const issues = new Set<string>();
  const events = [...x.events].sort((a, b) => a.start.cmp(b.start));
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.end.cmp(e.start) <= 0) issues.add('duration');
    if (i && e.start.cmp(events[i - 1].end) < 0) issues.add('collision');
    if (e.start.cmp(e.frame ? x.ends[e.frame - 1] : zero) < 0 || e.end.cmp(x.ends[e.frame]) > 0) issues.add('boundary');
  }
  for (let frame = 0; frame < 2; frame++) {
    const f = events.filter((e) => e.frame === frame);
    for (const [kind, count] of [
      ['B', p.bLines],
      ['C', p.colorPrf ? p.colorLines * p.ensemble : 0],
      ['PW', p.pwPrf ? x.ticks[frame] : 0],
    ] as const) {
      const selected = f.filter((e) => e.kind === kind).sort((a, b) => a.index - b.index);
      if (selected.length !== count || selected.some((e, i) => e.index !== i))
        issues.add(kind === 'PW' ? 'pw-every-tick' : 'complete-counts');
    }
    for (let line = 0; p.colorPrf && line < p.colorLines; line++) {
      const cs = f.filter((e) => e.kind === 'C' && Math.floor(e.index / p.ensemble) === line);
      if (cs.length !== p.ensemble) issues.add('ensemble-count');
      if (cs.some((e, i) => i > 0 && e.start.sub(cs[i - 1].start).cmp(x.delta!) !== 0)) issues.add('uniform-color');
    }
  }
  const pw = events.filter((e) => e.kind === 'PW');
  if (pw.some((e, i) => i > 0 && e.start.sub(pw[i - 1].start).cmp(x.T!) !== 0)) issues.add('uniform-pw');
  if (x.T && one.div(x.T).cmp(q(p.pwPrf)) > 0) issues.add('requested-pw');
  if (x.delta && one.div(x.delta).cmp(q(p.colorPrf)) > 0) issues.add('requested-color');
  return [...issues];
}
