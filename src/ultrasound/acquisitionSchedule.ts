/**
 * Generic single-beam interleave policy (decision 269). PW is periodic; Color
 * ensembles use a uniform integer subdivision/multiple of its clock. Complete
 * B lines fill individual free reception intervals, never average duty.
 * Ideal flight time only: no calibrated TX/ringdown/recovery overhead. Geometry
 * is still sampled once per image; this does not implement temporal Color IQ.
 * Exact frontier comparisons run only when acquisition settings change.
 */
export interface AcquisitionRequest {
  bLines: number;
  colorLines: number;
  ensemble: number;
  depthMm: number;
  colorFarMm: number;
  gateFarMm: number;
  cMmS: number;
  /** Zero disables the corresponding mode; otherwise requested Hz. */
  pwPrf: number;
  colorPrf: number;
}

export interface AcquisitionSchedule {
  frameS: number;
  pwPrfHz: number;
  colorPrfHz: number;
  pwDuty: number;
  mode: 'B' | 'Color' | 'PW' | 'Triplex';
  tb: number;
  tc: number;
  tp: number;
  /** PW period and complete ticks per frame. */
  T?: number;
  N?: number;
  b0?: number;
  delta?: number;
  bPerGap?: number;
  n?: number;
  m?: number;
  colorTicks?: number;
  colorBCapacity?: number;
  colorClock?: { periodNumeratorS: number; divisor: number; multiplier: number };
}

interface Dyad {
  m: bigint;
  e: number;
}
const bits = new DataView(new ArrayBuffer(8));
const ONE = { m: 1n, e: 0 };
const MAX = Number.MAX_SAFE_INTEGER;
function dyad(x: number): Dyad {
  if (!Number.isFinite(x) || x < 0) throw new Error('Nonnegative finite dyadic required');
  if (x === 0) return { m: 0n, e: 0 };
  bits.setFloat64(0, x);
  const b = bits.getBigUint64(0),
    exponent = Number((b >> 52n) & 2047n);
  return { m: (b & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n), e: exponent ? exponent - 1075 : -1074 };
}
function add(a: Dyad, b: Dyad): Dyad {
  const e = Math.min(a.e, b.e);
  return { m: (a.m << BigInt(a.e - e)) + (b.m << BigInt(b.e - e)), e };
}
const mul = (a: Dyad, b: Dyad): Dyad => ({ m: a.m * b.m, e: a.e + b.e });
const scale = (a: Dyad, n: number): Dyad => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid exact integer weight');
  return { m: a.m * BigInt(n), e: a.e };
};
function cmp(a: Dyad, b: Dyad): number {
  const e = Math.min(a.e, b.e);
  const x = a.m << BigInt(a.e - e),
    y = b.m << BigInt(b.e - e);
  return x < y ? -1 : x > y ? 1 : 0;
}
function adjacent(x: number, direction: number): number {
  if (!(x > 0) || !Number.isFinite(x)) throw new Error('Invalid period');
  bits.setFloat64(0, x);
  bits.setBigUint64(0, bits.getBigUint64(0) + BigInt(direction));
  const next = bits.getFloat64(0);
  if (!(next > 0) || !Number.isFinite(next)) throw new Error('Period representation boundary');
  return next;
}
function safeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Unsafe schedule count');
  return value;
}
const ceilCount = (count: number, per: number): number => {
  safeInteger(count);
  safeInteger(per);
  if (per < 1) throw new Error('Empty B capacity');
  return Number((BigInt(count) + BigInt(per) - 1n) / BigInt(per));
};

export function acquisitionSchedule(input: AcquisitionRequest): AcquisitionSchedule {
  const { bLines, colorLines, ensemble, depthMm, colorFarMm, gateFarMm, cMmS, pwPrf, colorPrf } = input;
  if (![bLines, colorLines, ensemble].every((x) => Number.isInteger(x) && x > 0 && x <= 4096))
    throw new Error('Counts outside declared bounds');
  if (![depthMm, colorFarMm, gateFarMm].every((x) => Number.isFinite(x) && x >= 0.001 && x <= 1000))
    throw new Error('Geometry outside declared bounds');
  if (!(Number.isFinite(cMmS) && cMmS >= 100000 && cMmS <= 10000000)) throw new Error('Speed outside declared bounds');
  if (![pwPrf, colorPrf].every((x) => x === 0 || (Number.isFinite(x) && x >= 1 && x <= 1000000)))
    throw new Error('PRF outside declared bounds');
  const b = dyad(depthMm),
    c = dyad(colorFarMm),
    p = dyad(gateFarMm),
    speed = dyad(cMmS);
  const pPlusB = add(p, b),
    pPlusC = add(p, c);
  const tb = (2 * depthMm) / cMmS,
    tc = (2 * colorFarMm) / cMmS,
    tp = (2 * gateFarMm) / cMmS;
  const C = colorPrf > 0 ? safeInteger(colorLines * ensemble) : 0;
  const ge = (left: Dyad, right: Dyad) => {
    return cmp(left, right) >= 0;
  };
  function leastTime(initial: number, fits: (n: number) => boolean, label: string): number {
    let t = initial;
    // At most two representable neighbours. A larger discrepancy is an error,
    // never an unbounded search or permission to accept an unsafe interval.
    for (let step = 0; step <= 2; step++) {
      if (fits(t) && !fits(adjacent(t, -1))) {
        return t;
      }
      if (step === 2) break;
      const direction = fits(t) ? -1 : 1;
      t = adjacent(t, direction);
    }
    throw new Error(`Period needs more than two neighbouring doubles: ${label}`);
  }
  function floorFit(estimate: number, fits: (n: number) => boolean, label: string): number {
    let q = safeInteger(Math.max(0, Math.floor(estimate)));
    if (!fits(0)) return 0;
    for (let step = 0; step <= 2; step++) {
      if (fits(q) && (q === MAX || !fits(q + 1))) {
        return q;
      }
      if (step === 2) break;
      const direction = fits(q) ? 1 : -1;
      q = safeInteger(q + direction);
    }
    throw new Error(`Count needs more than two integer adjustments: ${label}`);
  }
  function ceilFit(estimate: number, fits: (n: number) => boolean, label: string): number {
    let q = safeInteger(Math.max(1, Math.ceil(estimate)));
    for (let step = 0; step <= 2; step++) {
      if (fits(q) && (q === 1 || !fits(q - 1))) {
        return q;
      }
      if (step === 2) break;
      const direction = fits(q) ? -1 : 1;
      q = safeInteger(q + direction);
    }
    throw new Error(`Divisor needs more than two integer adjustments: ${label}`);
  }
  // Compare 2*(offset + lines*depthB)*denominator <= periodNumerator*c
  // exactly. c is shared; rounded tb/tc/tp are only estimates/public metadata.
  function capacity(estimate: number, clockC: Dyad, offset: Dyad, denominator: number, label: string): number {
    return floorFit(estimate, (lines) => ge(clockC, scale(add(offset, scale(b, lines)), safeInteger(2 * denominator))), label);
  }
  const complete = (out: Omit<AcquisitionSchedule, 'tb' | 'tc' | 'tp'>): AcquisitionSchedule => ({ ...out, tb, tc, tp });
  if (!pwPrf) {
    if (!C) return complete({ frameS: bLines * tb, pwPrfHz: 0, colorPrfHz: 0, pwDuty: 0, mode: 'B' });
    const request = dyad(colorPrf);
    const delta = leastTime(
      Math.max(1 / colorPrf, tc),
      (t) => ge(mul(dyad(t), request), ONE) && ge(mul(dyad(t), speed), scale(c, 2)),
      'Color period',
    );
    const bPerGap = capacity((delta - tc) / tb, mul(dyad(delta), speed), c, 1, 'Color B capacity');
    return complete({
      frameS: C * delta + Math.max(0, bLines - safeInteger(C * bPerGap)) * tb,
      pwPrfHz: 0,
      colorPrfHz: 1 / delta,
      pwDuty: 0,
      mode: 'Color',
      delta,
      bPerGap,
    });
  }
  const pw = dyad(pwPrf);
  const initialT = Math.max(1 / pwPrf, (2 * (gateFarMm + Math.max(depthMm, C ? colorFarMm : 0))) / cMmS);
  const T = leastTime(
    initialT,
    (t) => {
      const td = dyad(t),
        clockC = mul(td, speed);
      return ge(mul(td, pw), ONE) && ge(clockC, scale(pPlusB, 2)) && (!C || ge(clockC, scale(pPlusC, 2)));
    },
    'PW period',
  );
  const td = dyad(T),
    clockC = mul(td, speed);
  const b0 = capacity((T - tp) / tb, clockC, p, 1, 'PW B capacity');
  if (b0 < 1) throw new Error('No complete B line after exact period selection');
  if (!C) {
    const N = ceilCount(bLines, b0);
    return complete({ frameS: N * T, pwPrfHz: 1 / T, colorPrfHz: 0, pwDuty: tp / T, mode: 'PW', T, N, b0 });
  }
  const colorRequest = mul(td, dyad(colorPrf));
  let n = 0,
    m = 0,
    delta,
    colorTicks,
    colorBCapacity;
  if (!ge(colorRequest, ONE)) {
    m = ceilFit(1 / (colorPrf * T), (k) => ge(scale(colorRequest, k), ONE), 'Color divisor');
    delta = m * T;
    const bc = capacity((T - tp - tc) / tb, clockC, pPlusC, 1, 'Slow Color B capacity');
    colorTicks = safeInteger(C * m);
    colorBCapacity = safeInteger(C * safeInteger(bc + safeInteger((m - 1) * b0)));
  } else {
    n = floorFit(
      Math.min(colorPrf * T, T / (tp + tc)),
      (k) => ge(colorRequest, { m: BigInt(k), e: 0 }) && ge(clockC, scale(pPlusC, safeInteger(2 * k))),
      'Color pulses per tick',
    );
    if (n < 1) throw new Error('No complete Color pulse in PW tick');
    delta = T / n;
    const middle = capacity((delta - tc) / tb, clockC, c, n, 'Middle B capacity');
    const end = capacity((delta - tp - tc) / tb, clockC, pPlusC, n, 'End B capacity');
    const q = Math.floor(C / n),
      r = C % n;
    const partial = r
      ? safeInteger(
          (r - 1) * middle + capacity((T - tp - (r - 1) * delta - tc) / tb, scale(clockC, n - r + 1), pPlusC, n, 'Partial B capacity'),
        )
      : 0;
    colorTicks = q + (r ? 1 : 0);
    colorBCapacity = safeInteger(q * safeInteger((n - 1) * middle + end) + partial);
  }
  const N = safeInteger(colorTicks + ceilCount(Math.max(0, bLines - colorBCapacity), b0));
  return complete({
    frameS: N * T,
    pwPrfHz: 1 / T,
    colorPrfHz: n ? n / T : 1 / (m * T),
    pwDuty: tp / T,
    mode: 'Triplex',
    T,
    N,
    b0,
    n,
    m,
    delta,
    colorTicks,
    colorBCapacity,
    colorClock: { periodNumeratorS: T, divisor: n || 1, multiplier: m || 1 },
  });
}
