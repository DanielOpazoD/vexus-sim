import { describe, expect, it } from 'vitest';
import { C_RECONSTRUCTION_MM_S } from '../core/units';
import { SpectralProcessor } from '../doppler/spectral';
import { measureObservedRenal, renalFloorCms } from '../doppler/spectralMeasure';
import { WallFilter } from '../doppler/wallFilter';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient } from '../physiology/patientState';
import { RENAL_GAP_MIN_S, beatWindows, resolvableMinimum } from '../vexus/measurements';

/**
 * Interrupción del flujo interlobar sobre la cadena REAL (filtro de pared → espectro →
 * `measureObservedRenal`) con IQ sintética: dispersores que cruzan el haz con la velocidad de la
 * vena, clutter de tejido 40 dB por encima y ruido. Un revisor adversarial mostró que el cuantil
 * robusto del mínimo escondía pausas reales de 20–40 ms (continuo con la vena parada dos veces por
 * latido) y que el suelo de 2 cm/s, al estar en velocidad corregida, cambiaba el patrón con el
 * ángulo. Ahora el mínimo es exacto sobre la traza y el suelo es el borde de la banda de flujo en Hz.
 */
const F0 = 2.5e6;

// Latidos reales del sano en apnea (ritmo sinusal con su variabilidad), como en una captura
const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-expiratory' as const };
const engine = new PhysiologyEngine(patient, new AnatomyScene(patient).vesselAreas(), { historySeconds: 16 });
for (let i = 0; i < Math.round(14 / engine.clock.dt); i++) engine.step();
const T_NOW = engine.clock.t;
const ALL_BEATS = engine.rhythm.beatsBetween(T_NOW - 12, T_NOW + 2);
const CAPTURE = engine.rhythm.beatsBetween(T_NOW - 7, T_NOW).slice(-4);

const raisedCos = (t: number, a: number, b: number): number =>
  t <= a || t >= b ? 0 : 0.5 - 0.5 * Math.cos((2 * Math.PI * (t - a)) / (b - a));
const hump = (u: number): number => Math.sqrt(Math.max(0, Math.sin(Math.PI * u)));

/**
 * Vena con S y D que se detiene `gapMs` dos veces por latido: entre S y D (a mitad de camino entre
 * sus ventanas) y en la contracción auricular. Sin `gapMs`, S y D en coseno alzado sobre `base`.
 */
function vein(t: number, s: number, d: number, gapMs: number | null, base = 0): number {
  if (gapMs === null) {
    let v = base;
    for (const b of ALL_BEATS) {
      const w = beatWindows(b);
      v += s * raisedCos(t, w.sWindow[0], w.sWindow[1]) + d * raisedCos(t, w.dWindow[0], w.dWindow[1]);
    }
    return v;
  }
  const g = gapMs / 1000;
  for (let i = 0; i + 1 < ALL_BEATS.length; i++) {
    const b = ALL_BEATS[i];
    const w = beatWindows(b);
    const z1 = 0.5 * (w.sWindow[1] + w.dWindow[0]);
    const sa = b.tAtrialContraction + g / 2;
    const sb = z1 - g / 2;
    const da = z1 + g / 2;
    const db = ALL_BEATS[i + 1].tAtrialContraction - g / 2;
    if (t >= sa && t < sb) return s * hump((t - sa) / (sb - sa));
    if (t >= da && t < db) return d * hump((t - da) / (db - da));
    if (t >= b.tAtrialContraction - g / 2 && t < db + g) return 0;
  }
  return 0;
}

function rng(seed: number): () => number {
  let st = seed >>> 0;
  return () => {
    st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
    return st / 4294967296;
  };
}

/**
 * Espectro de la vena `v(t)` (cm/s, hacia la sonda) adquirido a `prf`: dispersores que cruzan el haz
 * con la velocidad de la vena (decorrelación por tránsito), clutter de tejido 40 dB por encima con
 * un bamboleo lento y ruido del receptor `snrDb` bajo la sangre; filtro de pared y espectro reales.
 */
function acquire(v: (t: number) => number, prf: number, snrDb = 20, wallHz = 25) {
  const rnd = rng(12345);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const hzPerCms = (2 * F0 * 10) / C_RECONSTRUCTION_MM_S;
  const K = 160;
  const mk = () => ({
    u: rnd(),
    ph: 2 * Math.PI * rnd(),
    amp: Math.sqrt(-Math.log(Math.max(1e-9, rnd()))),
    age: 0,
    life: 1.5 + 2 * rnd(),
    br: 1 + 0.05 * gauss(),
  });
  const sc = Array.from({ length: K }, () => {
    const s = mk();
    s.age = rnd() * s.life;
    return s;
  });
  const tStart = T_NOW - 9.5;
  const n = Math.round(9.5 * prf);
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const noise = Math.sqrt(K) * Math.pow(10, -snrDb / 20);
  let clPh = 0;
  for (let i = 0; i < n; i++) {
    const t = tStart + i / prf;
    const vv = v(t);
    let r = 0;
    let q = 0;
    for (const s of sc) {
      s.age += (Math.abs(vv * s.u) * 10) / prf;
      if (s.age >= s.life) Object.assign(s, mk());
      s.ph += (2 * Math.PI * vv * s.u * s.br * hzPerCms) / prf;
      const a = s.amp * Math.sin((Math.PI * s.age) / s.life);
      r += a * Math.cos(s.ph);
      q += a * Math.sin(s.ph);
    }
    clPh += (2 * Math.PI * 2 * Math.sin(2 * Math.PI * 0.8 * t)) / prf;
    r += 50 * Math.sqrt(K) * Math.cos(clPh) + noise * gauss();
    q += 50 * Math.sqrt(K) * Math.sin(clPh) + noise * gauss();
    re[i] = r;
    im[i] = q;
  }
  new WallFilter(wallHz, prf).process(re, im, n);
  const sp = new SpectralProcessor({ fftSize: 128, hop: 16 });
  sp.sync(tStart, prf);
  sp.push(re, im, n);
  return { columns: sp.columns.filter((c) => c.t > T_NOW - 7), beats: CAPTURE };
}

const measure = (a: ReturnType<typeof acquire>, angleDeg = 0, wallHz = 25) =>
  measureObservedRenal(a.columns, a.beats, {
    f0Hz: F0,
    angleCorrectionRad: (angleDeg * Math.PI) / 180,
    invert: false,
    fftSize: 128,
    wallFilterHz: wallHz,
  })!;

describe('interrupción del flujo renal medida sobre el espectro', () => {
  it('una vena que se para 20–30 ms dos veces por latido no es continua (antes el cuantil robusto la ocultaba)', () => {
    for (const [prf, gap, s, d] of [
      [6000, 20, 20, 25],
      [3000, 30, 15, 20],
    ] as const) {
      const m = measure(acquire((t) => vein(t, s, d, gap), prf));
      const tag = `${prf} Hz, pausa ${gap} ms: ${JSON.stringify({ s: m.sPeak, d: m.dPeak, min: m.vMin, p: m.pattern, q: m.quality.issue })}`;
      expect(m.quality.issue, tag).toBeNull();
      expect(m.pattern, tag).toBe('biphasic');
      expect(m.marks.some((p) => p.label === 'S')).toBe(true);
      expect(m.marks.some((p) => p.label === 'D')).toBe(true);
    }
  });

  it('con S pequeña y la vena parada en sístole, monofásica: el grado no baja', () => {
    const a = acquire((t) => vein(t, 5, 25, 20), 6000);
    const m = measure(a);
    expect(m.pattern, JSON.stringify(m.vMin)).toBe('monophasic');
    expect(m.sPeak).toBeGreaterThan(0); // Measured residual velocity is retained, not clamped away.
    expect(m.marks.some((p) => p.label === 'S')).toBe(false);
    expect(m.marks.filter((p) => p.label === 'D')).toHaveLength(m.measuredBeats.length);
    const inverted = measureObservedRenal(a.columns, a.beats, {
      f0Hz: F0,
      angleCorrectionRad: 0,
      invert: true,
      fftSize: 128,
      wallFilterHz: 25,
    })!;
    expect(inverted.sPeak).toBe(m.sPeak);
    expect(inverted.dPeak).toBe(m.dPeak);
    expect(inverted.pattern).toBe(m.pattern);
    expect(inverted.marks).toEqual(m.marks.map((p) => ({ ...p, vScreen: -p.vScreen })));
  });

  it('una vena que late sin detenerse (mínimo 4 cm/s) sigue siendo continua a 2,6 y 6 kHz', () => {
    for (const prf of [2600, 6000]) {
      const m = measure(acquire((t) => vein(t, 12, 12, null, 4), prf));
      expect(m.pattern, `${prf} Hz: mín ${m.vMin}`).toBe('continuous');
    }
  });

  it('la corrección angular no cambia el patrón: el suelo es el borde de la banda de flujo en Hz', () => {
    // vena lenta que no se detiene (mín 1,2 cm/s, máx 8,2): su valle cae en la banda del filtro
    // de pared, así que se ve interrumpida con cualquier corrección (antes: bifásica a 0° y
    // continua a 45° con el mismo espectro)
    const a = acquire((t) => vein(t, 7, 7, null, 1.2), 2000, 30);
    const patterns = [0, 30, 45, 60].map((deg) => measure(a, deg).pattern);
    expect(new Set(patterns).size, patterns.join(' ')).toBe(1);
    // y el suelo escala con 1/cos θ como la velocidad rotulada
    const floor0 = renalFloorCms(a.columns, { f0Hz: F0, angleCorrectionRad: 0, invert: false, fftSize: 128, wallFilterHz: 25 });
    const floor60 = renalFloorCms(a.columns, { f0Hz: F0, angleCorrectionRad: Math.PI / 3, invert: false, fftSize: 128, wallFilterHz: 25 });
    expect(floor60 / floor0).toBeCloseTo(2, 6);
    expect(floor0).toBeCloseTo(1.925, 2); // (25 + 37,5) Hz a 2,5 MHz
  });
});

describe('mínimo resoluble de la verdad fisiológica', () => {
  const series = (gapMs: number) => {
    const out: { t: number; v: number }[] = [];
    for (let t = 0; t < 1; t += 0.001) out.push({ t, v: t >= 0.5 && t < 0.5 + gapMs / 1000 ? 0 : 10 });
    return out;
  };
  it(`una pausa de ${RENAL_GAP_MIN_S * 1000} ms o más llega a cero; una más breve no`, () => {
    const min = (gapMs: number) => resolvableMinimum(series(gapMs), [0, 1], (p) => p.v, RENAL_GAP_MIN_S);
    expect(min(25)).toBe(0);
    expect(min(RENAL_GAP_MIN_S * 1000 + 1)).toBe(0);
    expect(min(10)).toBe(10);
  });
});
