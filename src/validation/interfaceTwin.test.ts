// @tier slow
import { beforeAll, describe, expect, it } from 'vitest';
import { Interface } from '../anatomy/interfaces';
import { CONVEX_BEAM } from '../ultrasound/beamModel';
import { IFACE_BETA } from '../ultrasound/interfaceEcho';
import {
  BACK,
  LINES,
  arcPeak,
  beading,
  bench,
  calibrateBeta,
  capsuleScene,
  diaphragmExtras,
  diaphragmScene,
  envAt,
  lateralCoherentGain,
  liverStats,
  mean,
  planarWall,
  posOn,
  renalScene,
  simulate,
  summarize,
  thetaOf,
  grayOf,
  type BenchLine,
  type BenchOpts,
  type BinSummary,
  type Cls,
  type Scene,
  type SimOpts,
} from './support/interfaceTwin';

/**
 * Gemelo B → C → D → G de los ecos de interfaz (decisión 57) sobre escenas 2D con las funciones de
 * producción (`support/interfaceTwin.ts`): fija β, comprueba que el cociente eco/moteado no depende de
 * la profundidad seleccionada ni de la posición de la cara entre muestras, que la tendencia con la
 * profundidad sigue a la de haces gaussianos coherentes, y las métricas M1–M9 del banco en las paredes
 * de VSH, VCI y porta, la cápsula, el diafragma con el espejo exacto y Morison. La regla de antes
 * (spec·cos⁴ en una muestra, espejo en el centro de la celda gruesa) no cumple M1, M4 ni M7.
 *
 * Los tramos se llenan con escenas planas a varias inclinaciones φ (el 0–20° de una pared a φ = 0 va de
 * 0° en la línea central a ~20° en las líneas laterales); cada cifra del plan (`design-spec/final`,
 * K = 55 dB) se reproduce con estas escenas salvo Morison, que allí llevaba la curvatura del riñón y
 * producción no (C = 1 fuera de los tubos, limitación `interface-curvature-tubes-only`): 2,23 frente a
 * 2,08.
 */
type Model = SimOpts['model'];
interface CaseSpec {
  scene: (phi: number) => Scene;
  phis: number[];
  seeds: number[];
  range: (phi: number) => [number, number];
  opt: BenchOpts;
  mirror?: boolean;
  /** Tejido cuyos píxeles se cuentan para la saturación (≥ 250). */
  satKind?: string;
}
interface CaseResult {
  bins: BinSummary[];
  /** Rosario a 0–20°, media sobre las realizaciones de la primera φ. */
  beading: number;
  seam: number;
  saturated: number;
}

const blood: BenchOpts = { target: (c) => c.kind === 'blood' };
const vessel =
  (D: number) =>
  (phi: number): [number, number] =>
    phi === 0 ? [D - 16, D + 10] : [Math.max(20, D - 40), Math.min(175, D + 50)];
const hv = (D: number) => (phi: number) => planarWall(D, phi, 0.5, BACK.wallThin, 0.35, Interface.VeinLumen, 5);
const CASES = {
  hv80: { scene: hv(80), phis: [0, 20, 55], seeds: [1], range: vessel(80), opt: blood },
  hv40: { scene: hv(40), phis: [0], seeds: [1], range: vessel(40), opt: blood },
  hv120: { scene: hv(120), phis: [0], seeds: [1], range: vessel(120), opt: blood },
  hv150: { scene: hv(150), phis: [0], seeds: [1], range: vessel(150), opt: blood },
  ivc: {
    scene: (phi: number) => planarWall(80, phi, 0.8, BACK.wallThin, 0.35, Interface.IvcLumen, 10),
    phis: [0],
    seeds: [1, 2],
    range: vessel(80),
    opt: blood,
  },
  portal: {
    scene: (phi: number) => planarWall(80, phi, 1.0, BACK.wallPortal, 0.7, Interface.PortalLumen, 6),
    phis: [0, 20, 55],
    seeds: [1],
    range: vessel(80),
    opt: blood,
  },
  capsule: {
    scene: (phi: number) => capsuleScene(30, phi),
    phis: [0, 25],
    seeds: [1, 2],
    range: () => [16, 50],
    opt: { before: (c: Cls) => c.kind === 'muscle', target: (c: Cls) => c.kind === 'capsule', between: () => true, refBelow: true },
  },
  diaphragm: {
    scene: (phi: number) => diaphragmScene(120, phi),
    phis: [0],
    seeds: [1, 2],
    range: () => [104, 134],
    opt: { target: (c: Cls) => c.kind === 'lung', between: () => true, maxCells: 10 },
    mirror: true,
    satKind: 'diaphragm',
  },
  morison: {
    scene: (phi: number) => renalScene(100, phi),
    phis: [0],
    seeds: [1, 2],
    range: () => [84, 116],
    opt: { target: (c: Cls) => c.kind === 'renalCapsule', between: (c: Cls) => c.kind === 'perirenal', maxCells: 12 },
    satKind: 'renalCapsule',
  },
} satisfies Record<string, CaseSpec>;
type CaseId = keyof typeof CASES;

function runCase(model: Model, spec: CaseSpec, liverMed: number): CaseResult {
  const all: BenchLine[] = [];
  const beads: number[] = [];
  let seam = 0;
  let lines = 0;
  let sat = 0;
  let px = 0;
  for (const seed of spec.seeds)
    for (const phi of spec.phis) {
      const sc = spec.scene(phi);
      const [r0, r1] = spec.range(phi);
      const o = simulate(sc, { model, r0, r1, seed, mirror: spec.mirror });
      const found = bench(sc, o, liverMed, 180, spec.opt);
      all.push(...found);
      if (phi === spec.phis[0]) beads.push(beading(found, 0, 20));
      if (spec.mirror) {
        const d = diaphragmExtras(sc, o, liverMed, r0, r1);
        seam += d.seamLines;
        lines += d.lines;
      }
      if (spec.satKind)
        for (let u = 8; u < LINES - 8; u++)
          for (let r = r0; r < r1; r += 0.1) {
            if (sc.classify(posOn(thetaOf(u), r)).kind !== spec.satKind) continue;
            px++;
            if (grayOf(envAt(o, u, r), liverMed) >= 250) sat++;
          }
    }
  return {
    bins: summarize(all),
    beading: mean(beads.filter(Number.isFinite)),
    seam: lines ? seam / lines : Number.NaN,
    saturated: px ? sat / px : Number.NaN,
  };
}

const db = (x: number) => 20 * Math.log10(x);
/** Tramo 0–20°, 20–40° o 40–60° de un caso. */
const bin = (r: CaseResult, from: 0 | 20 | 40): BinSummary => r.bins.find((b) => b.from === from)!;

/** Métricas M1, M4 y M7 que la regla de antes no cumple (la prueba de regresión las reutiliza). */
function wallsAndMirror(R: Pick<Record<CaseId, CaseResult>, 'hv80' | 'ivc' | 'diaphragm'>): void {
  // M1: pared a 0–20°
  expect(bin(R.hv80, 0).ratio).toBeGreaterThanOrEqual(1.42);
  expect(bin(R.ivc, 0).ratio).toBeGreaterThanOrEqual(1.45);
  // M4: continuidad
  expect(bin(R.hv80, 0).gapFrac).toBeLessThanOrEqual(0.15);
  expect(bin(R.ivc, 0).gapFrac).toBeLessThanOrEqual(0.05);
  expect(R.hv80.beading).toBeLessThanOrEqual(0.26);
  // M7: diafragma con el espejo exacto
  expect(bin(R.diaphragm, 0).ratio).toBeGreaterThanOrEqual(1.8);
  expect(R.diaphragm.seam).toBe(0);
}

/**
 * Referencia física de la tendencia con la profundidad de una cara plana normal: haces gaussianos
 * coherentes de `beamModel` (emisión de foco fijo con z_R = k0·w0²/2, recepción de fase plana y anchura
 * dinámica; la elevación no cambia con r en esta comparación). Devuelve |∫a_t·a_r·e^{iφ}|/√∫a_t²a_r².
 */
function gaussianBeamFace(r: number, focus = 90): number {
  const P = CONVEX_BEAM;
  const k0 = (2 * Math.PI) / P.lambdaMm;
  const w = (fwhm: number) => fwhm / 1.6651; // amplitud exp(−x²/w²)
  const w0 = w((P.k * P.lambdaMm * focus) / P.apertureTxMm);
  const zR = (k0 * w0 * w0) / 2;
  const z = r - focus;
  const wt = w0 * Math.sqrt(1 + (z / zR) ** 2);
  const invR = z / (z * z + zR * zR);
  const wr = w((P.k * P.lambdaMm * r) / Math.max(1, Math.min(P.apertureRxMaxMm, r / P.fNumberRxMin)));
  const L = 6 * Math.max(wt, wr);
  const N = 6000;
  const dx = (2 * L) / N;
  let re = 0;
  let im = 0;
  let s2 = 0;
  for (let i = 0; i <= N; i++) {
    const x = -L + i * dx;
    const a = Math.exp(-(x * x) / (wt * wt)) * Math.exp(-(x * x) / (wr * wr));
    const ph = 0.5 * k0 * x * x * invR;
    re += a * Math.cos(ph) * dx;
    im += a * Math.sin(ph) * dx;
    s2 += a * a * dx;
  }
  return Math.hypot(re, im) / Math.sqrt(s2);
}

describe('Gemelo B→C→D de los ecos de interfaz (decisión 57)', () => {
  let liverMed = 1;
  let R = {} as Record<CaseId, CaseResult>;
  beforeAll(() => {
    liverMed = liverStats(180, [1, 2]).median;
    R = Object.fromEntries(Object.entries(CASES).map(([id, spec]) => [id, runCase('echo', spec, liverMed)])) as Record<CaseId, CaseResult>;
  }, 120_000);

  it('β: una cara lisa en arco con S = 1 a 80 mm y 180 mm de profundidad da un pico igual al RMS del hígado', () => {
    const { beta } = calibrateBeta(180, 80);
    expect(Math.abs(db(beta / IFACE_BETA))).toBeLessThan(0.3);
  });

  it('el cociente eco/moteado no depende de la profundidad seleccionada ni de dónde cae la cara entre muestras', () => {
    // deriva de β entre 100 y 240 mm (antes, con el término de una muestra, 7,4 dB)
    const betas = [100, 140, 180, 240].map((depth) => calibrateBeta(depth, 80).beta);
    expect(db(Math.max(...betas) / Math.min(...betas)), betas.map((b) => b.toFixed(4)).join(' ')).toBeLessThanOrEqual(1);
    // rizado de pico a pico con la cara en 8 posiciones dentro de una muestra, de dos lados y de uno
    for (const depth of [180, 240]) {
      const dr = depth / 1024;
      const level: Record<string, number> = {};
      for (const two of [true, false]) {
        const peaks = Array.from({ length: 8 }, (_, j) => arcPeak(depth, 80 + (j / 8) * dr, 1, two, 0.01, 4));
        const pp = db(Math.max(...peaks) / Math.min(...peaks));
        expect(pp, `${depth} mm, ${two ? 'dos lados' : 'un lado'}`).toBeLessThanOrEqual(0.8);
        level[String(two)] = mean(peaks);
      }
      // la cara de un lado, desplazada 2,5σh dentro de su dueño, da el mismo nivel
      expect(Math.abs(db(level.false / level.true))).toBeLessThan(0.1);
    }
  });

  it('la tendencia con la profundidad sigue a la de haces gaussianos coherentes sin factor de celda', () => {
    // 240 mm de profundidad seleccionada (la cara a 180 mm queda dentro) y la media de 4 posiciones de
    // la cara dentro de una muestra, que quita su rizado (±0,35 dB)
    const dr = 240 / 1024;
    const peak = (r: number) => mean([0, 1, 2, 3].map((j) => arcPeak(240, r + (j / 4) * dr, 1, true, 0.01, 4)));
    const ref80 = gaussianBeamFace(80);
    const twin80 = peak(80);
    for (const r of [20, 40, 60, 100, 120, 150, 180]) {
      const twin = db(peak(r) / twin80);
      const phys = db(gaussianBeamFace(r) / ref80);
      // el cociente con el moteado es el del pico: la envolvente RMS del hígado no depende de r
      expect(Math.abs(db(lateralCoherentGain(r) / lateralCoherentGain(80)) - twin), `${r} mm`).toBeLessThan(0.1);
      expect(Math.abs(twin - phys), `${r} mm: gemelo ${twin.toFixed(2)}, haces ${phys.toFixed(2)}`).toBeLessThanOrEqual(
        r >= 40 && r <= 120 ? 1.5 : 2.5,
      );
    }
  });

  it('M1 y M2: la VSH y la VCI brillan a 0–20° a cualquier profundidad y la VSH se apaga fuera de ±20°', () => {
    wallsAndMirror(R);
    for (const [id, min] of [
      ['hv40', 1.4],
      ['hv120', 1.4],
      ['hv150', 1.3],
    ] as const)
      expect(bin(R[id], 0).ratio, id).toBeGreaterThanOrEqual(min);
    for (const id of ['hv80', 'hv40', 'hv120', 'hv150', 'ivc'] as const) expect(bin(R[id], 0).ratio, id).toBeLessThanOrEqual(2.1);
    // M2: caída con la incidencia (lóbulo de s = 0,14) hasta lo que da el moteado solo
    expect(bin(R.hv80, 0).dDb - bin(R.hv80, 40).dDb).toBeGreaterThanOrEqual(5);
    expect(bin(R.hv80, 40).ratio).toBeLessThanOrEqual(1.2);
  });

  it('M3: la porta (vaina de Glisson) brilla en los tres tramos y supera a la VSH fuera de la normal', () => {
    for (const from of [0, 20, 40] as const) expect(bin(R.portal, from).ratio, `${from}°`).toBeGreaterThanOrEqual(1.4);
    expect(bin(R.portal, 20).dDb - bin(R.hv80, 20).dDb).toBeGreaterThanOrEqual(5);
    expect(bin(R.portal, 40).dDb - bin(R.hv80, 40).dDb).toBeGreaterThanOrEqual(5);
    expect(bin(R.portal, 0).dDb).toBeGreaterThanOrEqual(bin(R.hv80, 0).dDb);
  });

  it('M4: paredes y caras continuas a 0–20°, sin huecos largos ni rosario', () => {
    for (const id of ['hv80', 'ivc', 'capsule', 'diaphragm', 'morison'] as const) {
      const b = bin(R[id], 0);
      expect(b.gapFrac, id).toBeLessThanOrEqual(id === 'hv80' ? 0.15 : 0.05);
      expect(b.gapRunMm, id).toBeLessThanOrEqual(1);
      expect(R[id].beading, id).toBeLessThanOrEqual(id === 'hv80' || id === 'ivc' ? 0.26 : 0.22);
    }
  });

  it('M5: el eco aislado mide 0,60–0,80 mm (pulso ⊕ perfil) y la pared destaca ≥ 8 dB', () => {
    const o = simulate(
      {
        classify: (p) => {
          const l = Math.hypot(p[0], p[1] + 60);
          const rr = l - 60;
          const n: [number, number] = [p[0] / l, (p[1] + 60) / l];
          return {
            back: 0,
            het: false,
            kind: 'x',
            n,
            bd: Math.abs(80 - rr),
            specOld: 0,
            face: Interface.VeinLumen,
            ifd: Math.abs(80 - rr),
          };
        },
      },
      { model: 'echo', r0: 76, r1: 84, unitS: { beta: 1 }, speckleGain: 0 },
    );
    const u = LINES / 2;
    let pk = 0;
    let rPk = 0;
    for (let r = 78; r <= 82; r += 0.005) {
      const e = envAt(o, u, r);
      if (e > pk) [pk, rPk] = [e, r];
    }
    let lo = rPk;
    while (envAt(o, u, lo) > pk / 2) lo -= 0.005;
    let hi = rPk;
    while (envAt(o, u, hi) > pk / 2) hi += 0.005;
    expect(hi - lo).toBeGreaterThanOrEqual(0.6);
    expect(hi - lo).toBeLessThanOrEqual(0.8);
    expect(bin(R.hv80, 0).dDb).toBeGreaterThanOrEqual(8);
    expect(bin(R.ivc, 0).dDb).toBeGreaterThanOrEqual(8);
  });

  it('M7 y M8: diafragma con el espejo exacto, cápsula y Morison en su banda, sin saturar', () => {
    const dia = bin(R.diaphragm, 0);
    expect(dia.ratio).toBeGreaterThanOrEqual(1.8);
    expect(dia.ratio).toBeLessThanOrEqual(2.4);
    expect(R.diaphragm.seam).toBe(0);
    expect(R.diaphragm.saturated).toBeLessThanOrEqual(0.02);
    expect(bin(R.capsule, 0).ratio).toBeGreaterThanOrEqual(1.4);
    expect(bin(R.capsule, 0).ratio).toBeLessThanOrEqual(2.1);
    expect(bin(R.capsule, 20).ratio).toBeGreaterThanOrEqual(1.3);
    expect(bin(R.capsule, 20).gapFrac).toBeLessThanOrEqual(0.2);
    // Morison sin la curvatura del riñón (C = 1 fuera de los tubos): 2,23; el plan, con ella, 2,08
    expect(bin(R.morison, 0).ratio).toBeGreaterThanOrEqual(1.6);
    expect(bin(R.morison, 0).ratio).toBeLessThanOrEqual(2.3);
    expect(R.morison.saturated).toBeLessThanOrEqual(0.02);
  });

  it('M9: el moteado del hígado a ≥ 6 mm de la pared no cambia con los ecos', () => {
    const wall = planarWall(80, 0, 0.5, BACK.wallThin, 0.35, Interface.VeinLumen, 5);
    const bare: Scene = { classify: (p) => ({ ...wall.classify(p), face: undefined, ifd: undefined }) };
    const snr = (sc: Scene) => {
      const o = simulate(sc, { model: 'echo', r0: 40, r1: 90, seed: 3 });
      const env: number[] = [];
      for (let v = 0; v < o.nv; v++)
        for (let u = 20; u < LINES - 20; u++) {
          const r = (v + o.v0 + 0.5) * o.dr;
          if (r > 45 && posOn(thetaOf(u), r)[1] < 80 - 6) env.push(o.env[v * LINES + u]);
        }
      const m = mean(env);
      return m / Math.sqrt(mean(env.map((x) => (x - m) ** 2)));
    };
    const withEcho = snr(wall);
    const without = snr(bare);
    expect(Math.abs(withEcho - without)).toBeLessThanOrEqual(0.02);
    expect(withEcho).toBeGreaterThan(1.8);
    expect(withEcho).toBeLessThan(2.1);
  });

  it('la regla de antes da lo que da el moteado solo y deja la costura del espejo', () => {
    const today = {
      hv80: runCase('today', { ...CASES.hv80, phis: [0] }, liverMed),
      ivc: runCase('today', { ...CASES.ivc, seeds: [1] }, liverMed),
      diaphragm: runCase('today', { ...CASES.diaphragm, seeds: [1] }, liverMed),
    };
    expect(bin(today.hv80, 0).ratio).toBeLessThan(1.25);
    expect(bin(today.ivc, 0).ratio).toBeLessThan(1.25);
    expect(bin(today.hv80, 0).gapFrac).toBeGreaterThan(0.5);
    expect(today.diaphragm.seam).toBeGreaterThan(0.3);
  });

  it.fails('regresión: la regla de hoy (spec·cos⁴ en una muestra, espejo grueso) cumple M1, M4 y M7', () => {
    wallsAndMirror({
      hv80: runCase('today', { ...CASES.hv80, phis: [0] }, liverMed),
      ivc: runCase('today', { ...CASES.ivc, seeds: [1] }, liverMed),
      diaphragm: runCase('today', { ...CASES.diaphragm, seeds: [1] }, liverMed),
    });
  });
});
