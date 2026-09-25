// @tier slow
import { beforeAll, describe, expect, it } from 'vitest';
import { TISSUES, Tissue } from '../anatomy/tissues';
import {
  BACK,
  LINES,
  bench,
  beading,
  capsuleScene,
  faceTrace,
  kinkCapsule,
  liverStats,
  mean,
  median,
  renalScene,
  sigmaL,
  simulate,
  spiralCapsule,
  summarize,
  thetaOf,
  type BenchLine,
  type BenchOpts,
  type Cls,
} from './support/interfaceTwin';

/**
 * Gemelo B→C→D de la cápsula hepática oblicua (PR 0 de las decisiones 60 y 63), con las funciones de
 * producción de `support/interfaceTwin.ts`. Fija las escenas y las métricas del contorno y deja escritas
 * las pruebas que la decisión 63 (lámina difusa de la cápsula) debe hacer pasar, con los umbrales del plan
 * (`it.fails` hoy): la cápsula solo tiene el lóbulo coherente de la decisión 57, así que desde ~35° de
 * incidencia queda en el suelo del moteado (cociente 1,16–1,19 con 62–71 % de huecos a 40–70°) y su nivel
 * varía poco a escala de centímetros (σ_L 1,30 dB: la línea «dibujada» de la crítica visual).
 *
 * Escenas: la espiral logarítmica centrada en el ápice virtual del convexo (`spiralCapsule`) da la misma
 * incidencia en todas las líneas, así que cada tramo se mide sin mezclar ángulos; la cara a 25–75 mm, 8
 * semillas (a ≥ 60°, 3 caras × 4 semillas, porque la cara oblicua cruza menos líneas). La escena del
 * repositorio (`capsuleScene` a 30 mm, φ 0/25/45/65°) es la del banco de la decisión 57. El pliegue
 * (`kinkCapsule`) pasa de 10° a 50° en una línea, como el corte de la cápsula anterior de la subxifoidea.
 */
const CAPSULE: BenchOpts = {
  before: (c: Cls) => c.kind === 'muscle',
  target: (c: Cls) => c.kind === 'capsule',
  between: () => true,
  refBelow: true,
};
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const DEG = Math.PI / 180;

interface SpiralResult {
  lines: BenchLine[];
  ratio: number;
  dDb: number;
  gapFrac: number;
  /** Huecos de la traza entre líneas (media de las corridas). */
  traceGap: number;
}

/** Ángulos de línea cuya cara cae en [r0; r1] mm (las líneas del banco, sin las 8 de cada borde). */
function faceThetas(faceR: (th: number) => number, r0: number, r1: number, lo = -Infinity, hi = Infinity): [number, number] | null {
  const ths: number[] = [];
  for (let u = 8; u < LINES - 8; u++) {
    const t = thetaOf(u);
    const r = faceR(t);
    if (t >= lo && t <= hi && r >= r0 && r <= r1) ths.push(t);
  }
  return ths.length >= 3 ? [Math.min(...ths), Math.max(...ths)] : null;
}

function spiral(thetaDeg: number, liverMed: number): SpiralResult {
  const runs: [number, number][] =
    thetaDeg >= 60
      ? [40, 50, 60].flatMap((rf) => [1, 2, 3, 4].map((seed): [number, number] => [rf, seed]))
      : SEEDS.map((seed) => [50, seed]);
  const lines: BenchLine[] = [];
  const traces: number[] = [];
  for (const [rf, seed] of runs) {
    const sc = spiralCapsule(thetaDeg, rf);
    const o = simulate(sc, { model: 'echo', r0: 10, r1: 90, seed });
    lines.push(...bench(sc, o, liverMed, 180, CAPSULE).filter((l) => l.rb >= 25 && l.rb <= 75));
    const range = faceThetas(sc.faceR, 25, 75);
    if (range) traces.push(faceTrace(o, sc.faceR, liverMed, range).gap);
  }
  return {
    lines,
    ratio: median(lines.map((l) => l.ratio)),
    dDb: median(lines.map((l) => l.dDb)),
    gapFrac: lines.filter((l) => l.dDb < 6).length / lines.length,
    traceGap: mean(traces),
  };
}

describe('Gemelo de la cápsula oblicua: escenas y métricas del contorno (PR 0 de las decisiones 60 y 63)', () => {
  let liverMed = 1;
  const S: Record<number, SpiralResult> = {};
  /** Escena del repositorio: 0–20° (φ 0) y los tramos oblicuos (φ 25, 45 y 65), 8 semillas. */
  const repo = { straight: [] as BenchLine[], oblique: [] as BenchLine[], sigmaL: [] as number[], beading: [] as number[] };
  /** Pliegue 10° → 50° en th = 0: registros y huecos de la traza de cada lado. */
  const kink = { gentle: [] as BenchLine[], steep: [] as BenchLine[], gentleTrace: [] as number[], steepTrace: [] as number[] };

  beforeAll(() => {
    liverMed = liverStats(180, [1, 2]).median;
    for (const th of [0, 40, 50, 60, 70]) S[th] = spiral(th, liverMed);
    for (const seed of SEEDS)
      for (const phi of [0, 25, 45, 65]) {
        const sc = capsuleScene(30, phi);
        const found = bench(sc, simulate(sc, { model: 'echo', r0: 16, r1: phi === 0 ? 50 : 90, seed }), liverMed, 180, CAPSULE);
        if (phi === 0) {
          repo.straight.push(...found.filter((l) => l.inc < 20));
          repo.sigmaL.push(sigmaL(found, 0, 20));
          repo.beading.push(beading(found, 0, 20));
        } else repo.oblique.push(...found);
      }
    for (const seed of SEEDS) {
      const sc = kinkCapsule(10, 50, 45, 0);
      const o = simulate(sc, { model: 'echo', r0: 15, r1: 95, seed });
      for (const l of bench(sc, o, liverMed, 180, CAPSULE).filter((x) => x.rb >= 25 && x.rb <= 80)) {
        const th = thetaOf(l.u);
        if (th > 2 * DEG) kink.gentle.push(l);
        else if (th < -2 * DEG) kink.steep.push(l);
      }
      kink.gentleTrace.push(faceTrace(o, sc.faceR, liverMed, faceThetas(sc.faceR, 25, 80, 2 * DEG)!).gap);
      kink.steepTrace.push(faceTrace(o, sc.faceR, liverMed, faceThetas(sc.faceR, 25, 80, -Infinity, -2 * DEG)!).gap);
    }
  }, 600_000);

  it('la espiral corta todas las líneas con la misma incidencia y el pliegue salta de 10° a 50° en th0', () => {
    for (const th of [0, 40, 50, 60, 70]) {
      expect(S[th].lines.length, `${th}°`).toBeGreaterThan(300);
      for (const l of S[th].lines) expect(Math.abs(l.inc - th), `${th}°, línea ${l.u}`).toBeLessThan(0.05);
    }
    for (const l of kink.gentle) expect(l.inc).toBeCloseTo(10, 1);
    for (const l of kink.steep) expect(l.inc).toBeCloseTo(50, 1);
    const sc = kinkCapsule(10, 50, 45, 0);
    expect(sc.faceR(-1e-9)).toBeCloseTo(sc.faceR(0), 6);
    expect(sc.incOf(0.1)).toBe(10);
    expect(sc.incOf(-0.1)).toBe(50);
  });

  it('`lines` cambia el paso del abanico: con 192 explícitas la imagen es la de siempre, bit a bit', () => {
    const sc = spiralCapsule(40, 50);
    const a = simulate(sc, { model: 'echo', r0: 30, r1: 70, seed: 3 });
    const b = simulate(sc, { model: 'echo', r0: 30, r1: 70, seed: 3, lines: LINES });
    expect(b.lines).toBe(LINES);
    expect(b.env).toEqual(a.env);
    // con 384 líneas la cara cruza el doble de líneas, con la misma incidencia
    const c = simulate(sc, { model: 'echo', r0: 30, r1: 70, seed: 3, lines: 2 * LINES });
    const found = bench(sc, c, liverMed, 180, CAPSULE);
    const at192 = bench(sc, a, liverMed, 180, CAPSULE);
    expect(found.length / at192.length).toBeGreaterThan(1.9);
    for (const l of found) expect(Math.abs(l.inc - 40)).toBeLessThan(0.05);
    expect(found[1].pitchMm / at192[1].pitchMm).toBeCloseTo((LINES - 1) / (2 * LINES - 1), 1);
  });

  it('traza y σ_L: una cara sin moteado a 0° no tiene huecos y una cresta constante no varía a escala de cm', () => {
    const sc = spiralCapsule(0, 50);
    const o = simulate(sc, { model: 'echo', r0: 10, r1: 90, seed: 1, speckleGain: 0 });
    const t = faceTrace(o, sc.faceR, liverMed, faceThetas(sc.faceR, 25, 75)!);
    expect(t.n).toBeGreaterThan(500);
    expect(t.gap).toBe(0);
    expect(t.cv).toBeLessThan(0.02);
    // σ_L de líneas pintadas: constante o con tendencia lenta, 0; ±3 dB con periodo de 40 líneas, ~2 dB
    const painted = (peak: (u: number) => number, n = 60): BenchLine[] =>
      Array.from({ length: n }, (_, u) => ({ u, inc: 5, ratio: 2, dDb: 12, peakEnvDb: peak(u), rb: 30, rLumen: 30.5, pitchMm: 0.6 }));
    expect(
      sigmaL(
        painted(() => 15),
        0,
        20,
      ),
    ).toBe(0);
    expect(
      sigmaL(
        painted((u) => 15 + u / 10),
        0,
        20,
      ),
    ).toBeLessThan(1e-9);
    expect(
      sigmaL(
        painted(() => 15, 40),
        0,
        20,
      ),
    ).toBeNaN();
    expect(
      sigmaL(
        painted((u) => 15 + 3 * Math.sin((2 * Math.PI * u) / 40), 90),
        0,
        20,
      ),
    ).toBeGreaterThan(1.5);
    // con el moteado, la cápsula de hoy a 0–20°: σ_L de 0,9–1,6 dB por semilla, 1,30 de media
    for (const x of repo.sigmaL) expect(x).toBeGreaterThan(0.5);
  });

  it('hoy, la cápsula a 0° brilla sin huecos: cociente 1,86 ± 0,05 (la guarda de 0–20° de la decisión 63)', () => {
    expect(Math.abs(S[0].ratio - 1.86)).toBeLessThanOrEqual(0.05);
    expect(S[0].gapFrac).toBe(0);
    expect(S[0].traceGap).toBe(0);
    // escena del repositorio a 0–20°: 1,81 sin huecos; rosario 0,200 sin compuesto (solo informado)
    const s0 = summarize(repo.straight)[0];
    expect(s0.ratio).toBeGreaterThanOrEqual(1.4);
    expect(s0.gapFrac).toBe(0);
    expect(mean(repo.beading)).toBeLessThan(0.3);
  });

  it('Morison con la banda de cápsula hepática: en [1,6; 2,2] con T_CAPSULE de hoy y con 1,0', () => {
    expect(BACK.capsule).toBe(TISSUES[Tissue.LiverCapsule].backscatter);
    const morison: BenchOpts = {
      target: (c: Cls) => c.kind === 'renalCapsule',
      between: (c: Cls) => c.kind === 'perirenal' || c.kind === 'capsule',
      maxCells: 12,
    };
    for (const back of [BACK.capsule, 1.0]) {
      const all: BenchLine[] = [];
      for (const seed of [1, 2]) {
        const sc = renalScene(100, 0, { mm: 0.8, back });
        all.push(...bench(sc, simulate(sc, { model: 'echo', r0: 84, r1: 116, seed }), liverMed, 180, morison));
      }
      const b = summarize(all)[0];
      expect(b.n, `cápsula ${back}`).toBeGreaterThan(100);
      expect(b.ratio, `cápsula ${back}`).toBeGreaterThanOrEqual(1.6);
      expect(b.ratio, `cápsula ${back}`).toBeLessThanOrEqual(2.2);
    }
  });

  // ——— Lo que debe hacer la decisión 63 (hoy falla; umbrales del plan, con margen sobre lo medido) ———

  it.fails('61: la cápsula a 40° y 50° sigue a la vista: cociente ≥ 1,28 y huecos ≤ 0,32 (hoy 1,17–1,19 / 0,62–0,69)', () => {
    for (const th of [40, 50]) {
      expect(S[th].ratio, `${th}°`).toBeGreaterThanOrEqual(1.28);
      expect(S[th].gapFrac, `${th}°`).toBeLessThanOrEqual(0.32);
    }
  });

  it.fails('61: a 60° y 70°: cociente ≥ 1,24 y huecos ≤ 0,45 (hoy 1,16–1,17 / 0,69–0,71)', () => {
    for (const th of [60, 70]) {
      expect(S[th].ratio, `${th}°`).toBeGreaterThanOrEqual(1.24);
      expect(S[th].gapFrac, `${th}°`).toBeLessThanOrEqual(0.45);
    }
  });

  it.fails('61: huecos de la traza entre líneas a 40° y 50° ≤ 0,36 (hoy 0,70–0,79)', () => {
    for (const th of [40, 50]) expect(S[th].traceGap, `${th}°`).toBeLessThanOrEqual(0.36);
  });

  it.fails('61: el nivel cae ≤ 12 dB de 0° a 50° (hoy 14,3)', () => {
    expect(S[0].dDb - S[50].dDb).toBeLessThanOrEqual(12);
  });

  it.fails('61: escena del repositorio a 20–40° ≥ 1,45 / ≤ 0,15 y a 40–60° ≥ 1,27 / ≤ 0,35 (hoy 1,38/0,24 y 1,19/0,66)', () => {
    const [, b20, b40] = summarize(repo.oblique);
    expect(b20.ratio).toBeGreaterThanOrEqual(1.45);
    expect(b20.gapFrac).toBeLessThanOrEqual(0.15);
    expect(b40.ratio).toBeGreaterThanOrEqual(1.27);
    expect(b40.gapFrac).toBeLessThanOrEqual(0.35);
  });

  it.fails('61: σ_L de la cápsula a 0–20° (media de 8 semillas) ≥ 1,6 dB: la línea deja de verse dibujada (hoy 1,30)', () => {
    expect(repo.sigmaL.every(Number.isFinite)).toBe(true);
    expect(mean(repo.sigmaL)).toBeGreaterThanOrEqual(1.6);
  });

  it.fails('61: pliegue de 10° a 50°: el lado de 50° visible en ≥ 60 % de las líneas y huecos de traza ≤ 0,45 (hoy 0,34 / 0,75)', () => {
    // el lado de 10° ya es visible y sin huecos: la prueba es la del lado empinado
    expect(kink.gentle.filter((l) => l.dDb >= 6).length / kink.gentle.length).toBeGreaterThan(0.95);
    expect(mean(kink.gentleTrace)).toBeLessThan(0.05);
    expect(kink.steep.filter((l) => l.dDb >= 6).length / kink.steep.length).toBeGreaterThanOrEqual(0.6);
    expect(mean(kink.steepTrace)).toBeLessThanOrEqual(0.45);
  });
});
