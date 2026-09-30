import { describe, expect, it } from 'vitest';
import { captureColumns, captureProtocolVessel, WALL_SETTLE_S } from '../doppler/capture';
import { assessQuality, outerBandExcessDb, qualityText } from '../doppler/measureQuality';
import { receiverNoiseDb } from '../doppler/sampleVolume';
import { halfPlaneEnvelopeHz, type SpectralColumn } from '../doppler/spectral';
import { measureObservedPortal } from '../doppler/spectralMeasure';
import { dominantGateSystem, wrongGateVessel, type GateVesselSample } from '../doppler/vesselIdentity';
import type { Beat } from '../physiology/rhythm';
import { captureOverlay, spectrumRowOf } from '../ui/captureOverlay';

/**
 * Medición de la porta y captura (decisión 94) con espectros sintéticos: ruido del receptor (periodograma exponencial)
 * y una banda portal débil (+15 dB) que late, con lo que la hundía en la cadena del alumno: clutter simétrico junto a la
 * línea de base, un bin de ruido suelto junto a ella y columnas sin banda (caída de señal).
 */
const N = 128;
const PRF = 2600;
const DT = 16 / PRF;
const DF = PRF / N;
const NOISE_DB = -48;
const beats: Beat[] = Array.from({ length: 6 }, (_, i) => ({ tR: 0.4 + i * 0.8, rr: 0.8 }) as Beat);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** Potencia de ruido de un bin: exponencial (periodograma) alrededor de NOISE_DB. */
const noise = (r: () => number, db = NOISE_DB) => db + 10 * Math.log10(-Math.log(Math.max(1e-9, r())));

interface Synth {
  /**
   * Bin más alto de la banda en t, hacia la sonda si `sign` = 1. La banda ocupa los 10 bins de debajo: el tronco portal
   * muestreado en su centro no llega a la línea de base (flujo casi en pistón, 5–20 cm/s).
   */
  top: (t: number) => number;
  sign?: 1 | -1;
  snrDb?: number;
  clutter?: boolean;
  dropouts?: boolean;
  nearBaselineNoise?: boolean;
  noiseDb?: number;
}

function portalColumns(o: Synth, seed = 3): SpectralColumn[] {
  const r = rng(seed);
  const out: SpectralColumn[] = [];
  const half = N / 2;
  for (let t = 0; t < 5.4; t += DT) {
    const p = new Float32Array(N);
    for (let k = 0; k < N; k++) p[k] = noise(r, o.noiseDb);
    const drop = o.dropouts && r() < 0.12;
    if (!drop) {
      const top = Math.round(o.top(t));
      for (let j = Math.max(3, top - 10); j <= top; j++) {
        const k = half + (o.sign ?? 1) * j;
        p[k] = 10 * Math.log10(Math.pow(10, p[k] / 10) + Math.pow(10, (NOISE_DB + (o.snrDb ?? 15)) / 10) * -Math.log(Math.max(1e-9, r())));
      }
    }
    // clutter simétrico junto a la base (tejido que late, transitorio del filtro de pared) en un 30 % de las columnas
    if (o.clutter && r() < 0.3) for (let j = 2; j <= 5; j++) p[half + j] = p[half - j] = NOISE_DB + 25;
    if (o.nearBaselineNoise) p[half + 3] = NOISE_DB + 14;
    out.push({ t, prfHz: PRF, powerDb: p });
  }
  return out;
}

/** La porta del caso: envolvente 13 → 20 bins (PF de la envolvente 35 %) con un latido de 0,8 s. */
const pulsatile = (t: number) => 16.5 + 3.5 * Math.sin((2 * Math.PI * (t - 0.4)) / 0.8);
const opts = { f0Hz: 2.5e6, angleCorrectionRad: 0, invert: false, fftSize: N, wallFilterHz: 25 };

describe('Envolvente de semiplano fijo (decisión 94)', () => {
  it('ignora el clutter simétrico y el bin suelto junto a la línea de base', () => {
    const col = portalColumns({ top: () => 20, clutter: true, nearBaselineNoise: true, snrDb: 25 }, 7)[5];
    col.powerDb.set([NOISE_DB + 25, NOISE_DB + 25], N / 2 - 3); // clutter también al otro lado
    const f = halfPlaneEnvelopeHz(col, N, NOISE_DB, 1, 62.5);
    expect(f / DF).toBeGreaterThan(16);
    expect(f / DF).toBeLessThanOrEqual(21);
  });

  it('una columna solo de clutter simétrico no tiene flujo en ningún semiplano', () => {
    const p = new Float32Array(N).fill(NOISE_DB);
    for (let j = 2; j <= 6; j++) p[N / 2 + j] = p[N / 2 - j] = NOISE_DB + 30;
    const col = { t: 0, prfHz: PRF, powerDb: p };
    expect(halfPlaneEnvelopeHz(col, N, NOISE_DB, 1, 62.5)).toBeNaN();
    expect(halfPlaneEnvelopeHz(col, N, NOISE_DB, -1, 62.5)).toBeNaN();
  });
});

describe('PF portal sobre un espectro débil (decisión 94)', () => {
  const clean = measureObservedPortal(portalColumns({ top: pulsatile, snrDb: 40 }), beats, opts)!;

  it('la referencia limpia da la PF de la envolvente', () => {
    expect(clean.quality.issue).toBeNull();
    expect(clean.pulsatilityFraction).toBeGreaterThan(28);
    expect(clean.pulsatilityFraction).toBeLessThan(40);
  });

  it('con clutter, un bin de ruido junto a la base y caídas de señal, la PF sigue a la limpia', () => {
    const m = measureObservedPortal(
      portalColumns({ top: pulsatile, clutter: true, dropouts: true, nearBaselineNoise: true }),
      beats,
      opts,
    )!;
    expect(m.quality.issue).toBeNull();
    // antes (semiplano dominante por columna, hueco = 0): Vmín 0 o negativa y PF ≥ 100 %
    expect(m.vMin).toBeGreaterThan(0.5 * clean.vMin);
    expect(Math.abs(m.pulsatilityFraction - clean.pulsatilityFraction)).toBeLessThan(8);
    // el trazado a la vista: una Vmáx y una Vmín por latido medido, dentro de su latido
    expect(m.marks.filter((k) => k.label === 'Vmáx')).toHaveLength(m.measuredBeats.length);
    for (const k of m.marks) expect(m.measuredBeats.some((b) => k.t >= b.tR && k.t <= b.tR + b.rr)).toBe(true);
  });

  it('el mismo flujo alejándose de la sonda (o invertido en pantalla) da la misma PF', () => {
    const away = measureObservedPortal(portalColumns({ top: pulsatile, sign: -1, clutter: true }), beats, opts)!;
    const inv = measureObservedPortal(portalColumns({ top: pulsatile, clutter: true }), beats, { ...opts, invert: true })!;
    const ref = measureObservedPortal(portalColumns({ top: pulsatile, clutter: true }), beats, opts)!;
    expect(away.anterogradeSign).toBe(-1);
    expect(inv.anterogradeSign).toBe(-1);
    expect(Math.abs(away.pulsatilityFraction - ref.pulsatilityFraction)).toBeLessThan(6);
    expect(inv.pulsatilityFraction).toBeCloseTo(ref.pulsatilityFraction, 6);
  });

  it('una porta que se invierte parte del ciclo se lee negativa ahí: PF > 100 %', () => {
    // hepatófuga 0,25 s de cada latido: la envolvente pasa al otro semiplano
    const r = rng(11);
    const cols = portalColumns({ top: () => 16 }).map((c) => {
      const ph = (((c.t - 0.4) % 0.8) + 0.8) % 0.8;
      if (ph < 0.25) {
        const p = new Float32Array(N);
        for (let k = 0; k < N; k++) p[k] = noise(r);
        for (let j = 3; j <= 9; j++) p[N / 2 - j] = NOISE_DB + 15;
        return { ...c, powerDb: p };
      }
      return c;
    });
    const m = measureObservedPortal(cols, beats, opts)!;
    expect(m.vMin).toBeLessThan(0);
    expect(m.pulsatilityFraction).toBeGreaterThan(100);
    expect(m.quality.issue).toBeNull();
  });
});

describe('La porta que la escala o el filtro de pared no dejan medir (revisión de la decisión 94)', () => {
  it('el pico que llega al Nyquist se recorta: aliasing, no una PF baja', () => {
    // envolvente hasta 58 de 64 bins (0,9 del Nyquist) en el pico del latido
    const m = measureObservedPortal(
      portalColumns({ top: (t) => 50 + 8 * Math.sin((2 * Math.PI * (t - 0.4)) / 0.8), snrDb: 25 }),
      beats,
      opts,
    )!;
    expect(m.quality.issue).toBe('aliasing');
  });

  it('el pico plegado al otro lado no es una porta hepatófuga: aliasing', () => {
    const r = rng(13);
    const cols = portalColumns({ top: pulsatile, snrDb: 25 }).map((c) => {
      const ph = (((c.t - 0.4) % 0.8) + 0.8) % 0.8;
      if (ph > 0.15) return c;
      // en el pico, la banda aparece junto a −Nyquist (bins 52–62 del lado contrario) y deja el suyo vacío
      const p = new Float32Array(N);
      for (let k = 0; k < N; k++) p[k] = noise(r);
      for (let j = 52; j <= 62; j++) p[N / 2 - j] = NOISE_DB + 25;
      return { ...c, powerDb: p };
    });
    expect(measureObservedPortal(cols, beats, opts)!.quality.issue).toBe('aliasing');
  });

  it('con el filtro de pared alto el valle cae en su banda: no medible, no una PF menor', () => {
    // valle a 9 bins (≈ 180 Hz) con el filtro a 150 Hz: la transición del filtro (×1,5) llega a 225 Hz
    const cols = portalColumns({ top: (t) => 14 + 5 * Math.sin((2 * Math.PI * (t - 0.4)) / 0.8), snrDb: 25 });
    expect(measureObservedPortal(cols, beats, { ...opts, wallFilterHz: 150 })!.quality.issue).toBe('wall-filter');
    expect(measureObservedPortal(cols, beats, opts)!.quality.issue).toBeNull();
  });

  it('el sentido del flujo se toma de los latidos medidos, no de lo que vio antes la puerta', () => {
    // los primeros 1,5 s la puerta veía un flujo fuerte alejándose (otro vaso); después, la porta hacia la sonda
    const other = portalColumns({ top: () => 30, sign: -1, snrDb: 35 }, 21);
    const portal = portalColumns({ top: pulsatile, snrDb: 25 }, 22);
    const cols = portal.map((c, i) => (c.t < 1.5 ? other[i] : c));
    const late = beats.filter((b) => b.tR > 1.5);
    const m = measureObservedPortal(cols, late, opts)!;
    expect(m.anterogradeSign).toBe(1);
    expect(m.vMax).toBeGreaterThan(0);
    expect(Number.isFinite(m.pulsatilityFraction)).toBe(true);
  });
});

describe('Aliasing fuerte (decisión 94)', () => {
  const rx = receiverNoiseDb(0, N);
  it('el ruido del receptor de la cadena es el del espectrograma sin señal', () => {
    // 2σ²·Σw² con σ = 4·10⁻⁴ y la ventana de Hann de 128: −48,1 dB (el suelo de las capturas sin vaso: medido −48 ± 0,3)
    expect(rx).toBeCloseTo(-48.1, 1);
    expect(receiverNoiseDb(10, N) - rx).toBeCloseTo(10, 6);
  });

  it('la sangre plegada que llena la banda es aliasing, no «sin flujo»; el ruido solo sigue siendo «sin flujo»', () => {
    const r = rng(5);
    const filled: SpectralColumn[] = [];
    const empty: SpectralColumn[] = [];
    for (let t = 0; t < 5.4; t += DT) {
      filled.push({ t, prfHz: PRF, powerDb: Float32Array.from({ length: N }, () => noise(r, rx + 8)) });
      empty.push({ t, prfHz: PRF, powerDb: Float32Array.from({ length: N }, () => noise(r, rx)) });
    }
    const q = { wallFilterHz: 25, receiverNoiseDb: rx };
    expect(outerBandExcessDb(filled, rx)).toBeGreaterThan(5);
    expect(assessQuality(filled, beats, q).issue).toBe('aliasing');
    expect(assessQuality(filled, beats, { wallFilterHz: 25 }).issue).toBe('no-signal');
    expect(Math.abs(outerBandExcessDb(empty, rx))).toBeLessThan(1.5);
    expect(assessQuality(empty, beats, q).issue).toBe('no-signal');
  });
});

describe('Identidad del vaso de la puerta (decisión 94)', () => {
  const track = (vessels: GateVesselSample['vessels'], n = 50): GateVesselSample[] =>
    Array.from({ length: n }, (_, i) => ({ t: i * 0.1, vessels }));

  it('la sangre que domina la puerta decide el vaso; sin sangre no hay veredicto', () => {
    expect(dominantGateSystem(track({ pvTrunk: 0.3, hepaticArtery: 0.05 }), 0, 5)).toBe('portal');
    expect(dominantGateSystem(track({}), 0, 5)).toBeNull();
    expect(dominantGateSystem(track({ hvRight: 0.004 }), 0, 5)).toBeNull();
  });

  it('otra fila que la del vaso es «vaso equivocado»; la interlobar admite su arteria', () => {
    expect(wrongGateVessel('hepatic', track({ pvTrunk: 0.3 }), 0, 5)).toBe('portal');
    expect(wrongGateVessel('portal', track({ hvMiddle: 0.3 }), 0, 5)).toBe('hepaticVein');
    expect(wrongGateVessel('renal', track({ hvMiddle: 0.3 }), 0, 5)).toBe('hepaticVein');
    expect(wrongGateVessel('portal', track({ pvTrunk: 0.3 }), 0, 5)).toBeNull();
    expect(wrongGateVessel('renal', track({ interlobarArtery2: 0.2, interlobarVein2: 0.1 }), 0, 5)).toBeNull();
    // solo cuenta la ventana de la captura
    const moved = [...track({ hvRight: 0.3 }, 30), ...track({ pvTrunk: 0.3 }, 80).map((s) => ({ ...s, t: s.t + 3 }))];
    expect(wrongGateVessel('portal', moved, 3, 11)).toBeNull();
  });

  it('la captura sobre otro vaso se rechaza con un mensaje que dice dónde está la puerta', () => {
    const cols = portalColumns({ top: pulsatile, snrDb: 30 });
    const rhythm = { beatsBetween: (a: number, b: number) => beats.filter((x) => x.tR >= a && x.tR + x.rr <= b) };
    const tNow = cols[cols.length - 1].t;
    const hv = Array.from({ length: 200 }, (_, i) => ({ t: tNow - 6.9 + i * 0.03, vessels: { hvRight: 0.3 } }));
    const pv = hv.map((s) => ({ ...s, vessels: { pvTrunk: 0.3 } }));
    const wrong = captureProtocolVessel('portal', cols, rhythm, tNow, opts, hv)!;
    expect(wrong.quality.issue).toBe('wrong-vessel');
    expect(qualityText(wrong.quality)).toContain('vaso equivocado, la puerta está en una suprahepática');
    expect(captureProtocolVessel('portal', cols, rhythm, tNow, opts, pv)!.quality.issue).toBeNull();
  });
});

describe('Columnas de la captura (decisión 94)', () => {
  it('solo las de la PRF actual y sin el transitorio del filtro de pared tras el cambio', () => {
    const col = (t: number, prfHz: number): SpectralColumn => ({ t, prfHz, powerDb: new Float32Array(N) });
    const spectrum = [
      ...Array.from({ length: 50 }, (_, i) => col(i * 0.05, 2600)),
      ...Array.from({ length: 50 }, (_, i) => col(2.5 + i * 0.05, 3900)),
    ];
    const got = captureColumns(spectrum, -10);
    expect(got.every((c) => c.prfHz === 3900)).toBe(true);
    expect(got[0].t).toBeGreaterThan(2.5 + WALL_SETTLE_S - 1e-9);
    expect(captureColumns(spectrum.slice(0, 50), 1)).toHaveLength(spectrum.slice(0, 50).filter((c) => c.t > 1).length);
  });
});

describe('Trazado de la captura sobre el espectro (decisión 94)', () => {
  it('la fila de una frecuencia es la que pinta el espectrograma, con inversión y línea de base', () => {
    const H = 200;
    for (const display of [
      { baselineShift: 0, invert: false },
      { baselineShift: 0.2, invert: false },
      { baselineShift: -0.1, invert: true },
    ]) {
      for (const f of [-1250, -900, 0, 450, 1250]) {
        const y = spectrumRowOf(f, PRF, display, H);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(H);
        // la fórmula de SpectrogramView: la fila y muestra f = (fracBand − 0,5 + desplazamiento)·PRF, plegada a ±PRF/2
        const fracBand = display.invert ? y / H : 1 - y / H;
        const shown = (fracBand - 0.5 + display.baselineShift) * PRF;
        const wrapped = shown - PRF * Math.round((shown - f) / PRF);
        expect(wrapped).toBeCloseTo(f, 6);
      }
    }
  });

  it('la traza se guarda en Hz físicos: la misma captura invertida o corregida en ángulo cae en las mismas filas', () => {
    const cols = portalColumns({ top: pulsatile, snrDb: 30 });
    const a = captureOverlay('portal', measureObservedPortal(cols, beats, opts)!, opts, PRF);
    const inv = { ...opts, invert: true, angleCorrectionRad: 0.6 };
    const b = captureOverlay('portal', measureObservedPortal(cols, beats, inv)!, inv, PRF);
    const fa = a.trace.map((p) => p.fHz).filter(Number.isFinite);
    const fb = b.trace.map((p) => p.fHz).filter(Number.isFinite);
    expect(fb.length).toBe(fa.length);
    fa.forEach((f, i) => expect(fb[i]).toBeCloseTo(f, 6));
    expect(a.beats.length).toBeGreaterThan(3);
    expect(a.accepted).toBe(true);
  });
});
