// @tier slow
import { beforeAll, describe, expect, it } from 'vitest';
import { Interface } from '../anatomy/interfaces';
import { axialSigmaMm, beamFwhmMm } from '../ultrasound/beamModel';
import { frequencyRatio } from '../ultrasound/beamEcho';
import { IFACE_BETA, IFACE_SIGMA_H_MM } from '../ultrasound/interfaceEcho';
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
  spiralCapsule,
  summarize,
  faceTrace,
  thetaOf,
  grayOf,
  TWIN_BEAM,
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
 * producción no (C = 1 fuera de los tubos, limitación `interface-curvature-tubes-only`): con la s de la
 * tabla del plan (0,21) daba 2,23, sobre la banda M8 [1,6; 2,2]. Su pico es la cara grasa/cápsula renal
 * (4 dB sobre la de hígado/grasa, cuya s no lo mueve: 0,30 → 0,35 deja 2,23); con s 0,25 en la cápsula
 * renal quedaba en 2,17 y, desde la decisión 65 (s 0,2 y σz 0,06, con el nivel fijado por χ(0)), en 2,0–2,1. La VCI
 * del gemelo (`ivc`) es circular (r 10 mm); la de la anatomía, elíptica: sus
 * paredes AP (subxifoidea) tienen curvatura apScale/r y las laterales (flanco) 1/(apScale²·r), y en apnea
 * (apScale 0,777) dan 1,67 y 1,52 frente a 1,62 (`ivcAp`, `ivcLateral`).
 *
 * Desde la decisión 65 el eco es el de la faceta (la normal inclinada por un campo anclado, con el lóbulo propio y
 * χ(0)) más la componente difusa: en media conserva el del conjunto (M1–M3 no cambian), pero la línea se arrosaria y
 * se fragmenta más cuanto más oblicua. M4 y M8 pasan a pedir eso: continuidad a 0–20° sin exigir una cresta constante,
 * y la cápsula que se apaga y se rompe a 20–40°. `noFacets` es el eco de la 57, para la regresión.
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
/** apScale de la VCI del adulto normal en apnea espiratoria (`caliberFor`). */
const IVC_AP_SCALE = 0.777;
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
  // la VCI elíptica de la escena en apnea (apScale 0,777, r 10): pared AP (radio de curvatura r/apScale)
  // y lateral (apScale²·r), la curvatura local de su sección (`tubeFaceGradient`)
  ivcAp: {
    scene: (phi: number) => planarWall(80, phi, 0.8, BACK.wallThin, 0.35, Interface.IvcLumen, 10 / IVC_AP_SCALE),
    phis: [0],
    seeds: [1, 2],
    range: vessel(80),
    opt: blood,
  },
  ivcLateral: {
    scene: (phi: number) => planarWall(80, phi, 0.8, BACK.wallThin, 0.35, Interface.IvcLumen, 10 * IVC_AP_SCALE ** 2),
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
 * dinámica; la elevación no cambia con r en esta comparación), con el haz de la imagen B del gemelo (decisión 84:
 * la cintura de la emisión apodizada y k0 y la recepción a la frecuencia del eco en r). Devuelve
 * |∫a_t·a_r·e^{iφ}|/√∫a_t²a_r².
 */
function gaussianBeamFace(r: number, focus = 90): number {
  const P = TWIN_BEAM;
  const k0 = ((2 * Math.PI) / P.lambdaMm) * frequencyRatio(r, P);
  const w = (fwhm: number) => fwhm / 1.6651; // amplitud exp(−x²/w²)
  const w0 = w(beamFwhmMm(focus, focus, P).tx);
  const zR = (k0 * w0 * w0) / 2;
  const z = r - focus;
  const wt = w0 * Math.sqrt(1 + (z / zR) ** 2);
  const invR = z / (z * z + zR * zR);
  const wr = w(beamFwhmMm(r, focus, P).rx);
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
    // el pulso se alarga con la bajada de la frecuencia (decisión 84): el pico de una cara (el perfil de σh por el pulso
    // de energía unidad) baja como √σa/√(σa² + σh²), y la envolvente RMS del moteado no cambia
    const axial = (r: number) => {
      const sa = axialSigmaMm(r, TWIN_BEAM);
      return Math.sqrt(sa) / Math.hypot(sa, IFACE_SIGMA_H_MM);
    };
    const ref80 = gaussianBeamFace(80) * axial(80);
    const twin80 = peak(80);
    for (const r of [20, 40, 60, 100, 120, 150, 180]) {
      const twin = db(peak(r) / twin80);
      const phys = db((gaussianBeamFace(r) * axial(r)) / ref80);
      // el cociente con el moteado es el del pico: la envolvente RMS del hígado no depende de r
      const coherent = db((lateralCoherentGain(r) * axial(r)) / (lateralCoherentGain(80) * axial(80)));
      expect(Math.abs(coherent - twin), `${r} mm: gemelo ${twin.toFixed(2)}, ganancia coherente ${coherent.toFixed(2)}`).toBeLessThan(0.1);
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
    for (const id of ['hv80', 'hv40', 'hv120', 'hv150', 'ivc', 'ivcAp', 'ivcLateral'] as const)
      expect(bin(R[id], 0).ratio, id).toBeLessThanOrEqual(2.1);
    // la VCI elíptica: la pared lateral, más curva, sigue en M1; la AP, más plana, brilla algo más
    for (const id of ['ivcAp', 'ivcLateral'] as const) expect(bin(R[id], 0).ratio, id).toBeGreaterThanOrEqual(1.45);
    expect(bin(R.ivcAp, 0).dDb).toBeGreaterThan(bin(R.ivc, 0).dDb);
    expect(bin(R.ivcLateral, 0).dDb).toBeLessThan(bin(R.ivc, 0).dDb - 1);
    // M2: caída con la incidencia (lóbulo de s = 0,14) hasta lo que da el moteado solo
    expect(bin(R.hv80, 0).dDb - bin(R.hv80, 40).dDb).toBeGreaterThanOrEqual(5);
    expect(bin(R.hv80, 40).ratio).toBeLessThanOrEqual(1.2);
  });

  it('M3: la porta (vaina de Glisson) brilla en los tres tramos y supera a la VSH fuera de la normal', () => {
    // (el pedestal de lóbulos laterales de la decisión 76 reparte −24 dB de la energía de la vaina en las líneas
    // vecinas y el cociente cresta/hígado bajó de 1,404 a 1,397 a 40°; sin pedestal vuelve a 1,40. La ganancia
    // coherente de una cara continua no cambia: la pantalla de fase es antisimétrica, `clutter.test.ts`. Con la PSF
    // de la decisión 84, más ancha a 80 mm por la bajada de la frecuencia y la emisión apodizada, y el pulso más
    // largo, el eco de una cara oblicua se reparte más: 1,397 → 1,373 a 40° y 1,439 → 1,417 a 20°, sin cambio a 0–20°
    // de incidencia normal (1,616 → 1,623). 1,36 es el borde bajo de las paredes de las referencias reales)
    for (const from of [0, 20, 40] as const) expect(bin(R.portal, from).ratio, `${from}°`).toBeGreaterThanOrEqual(1.36);
    expect(bin(R.portal, 20).dDb - bin(R.hv80, 20).dDb).toBeGreaterThanOrEqual(5);
    expect(bin(R.portal, 40).dDb - bin(R.hv80, 40).dDb).toBeGreaterThanOrEqual(5);
    expect(bin(R.portal, 0).dDb).toBeGreaterThanOrEqual(bin(R.hv80, 0).dDb);
  });

  it('M4: a 0–20° la línea sigue siendo la que se ve, arrosariada como las reales sin romperse', () => {
    // las cotas de la decisión 57 (huecos ≤ 0,15 en la VSH y ≤ 0,05 en el resto, tramos ≤ 1 mm, rosario ≤ 0,26 en las
    // paredes y ≤ 0,22 en el resto) salvo donde las facetas de la 65 las mueven, medido con 8 semillas (26-09-2026): el
    // tramo de la VSH (lóbulo estrecho, 0,14: se corta en tramos cortos como las paredes reales; hasta 2,65 mm) y de la
    // cápsula (hasta 1,77 mm con una semilla, 1,18 con las dos de la prueba) y el rosario de Morison (0,26 con las dos)
    const runMax: Partial<Record<CaseId, number>> = { hv80: 3.5, capsule: 1.5 };
    const beadMax: Partial<Record<CaseId, number>> = { hv80: 0.26, ivc: 0.26, morison: 0.32 };
    for (const id of ['hv80', 'ivc', 'capsule', 'diaphragm', 'morison'] as const) {
      const b = bin(R[id], 0);
      expect(b.gapFrac, id).toBeLessThanOrEqual(id === 'hv80' ? 0.15 : 0.05);
      expect(b.gapRunMm, id).toBeLessThanOrEqual(runMax[id] ?? 1);
      expect(R[id].beading, id).toBeLessThanOrEqual(beadMax[id] ?? 0.22);
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
    // decisión 65: a 20–40° la cápsula se apaga y se rompe. Con cuatro semillas, frente al eco de la 57 con la misma
    // tabla (s 0,2): la caída de 0–20° a 20–40° y los huecos a 20–40° (26-09-2026: 10,5 frente a 9,5 dB y 0,34 frente
    // a 0,25; en main, s 0,25 y χ(θ), 6,7 dB y ≤ 0,2)
    const m8 = (noFacets: boolean) => {
      const all: BenchLine[] = [];
      for (const seed of [1, 2, 3, 4])
        for (const phi of CASES.capsule.phis) {
          const sc = CASES.capsule.scene(phi);
          const [r0, r1] = CASES.capsule.range();
          all.push(...bench(sc, simulate(sc, { model: 'echo', r0, r1, seed, noFacets }), liverMed, 180, CASES.capsule.opt));
        }
      const b = summarize(all);
      const [b0, b20] = [b.find((x) => x.from === 0)!, b.find((x) => x.from === 20)!];
      return { drop: b0.dDb - b20.dDb, gaps: b20.gapFrac };
    };
    const [f65, f57] = [m8(false), m8(true)];
    const msg = JSON.stringify({ f65, f57 });
    expect(f65.drop, msg).toBeGreaterThanOrEqual(9.5);
    expect(f65.gaps, msg).toBeGreaterThanOrEqual(0.28);
    expect(f65.drop - f57.drop, msg).toBeGreaterThanOrEqual(0.3);
    expect(f65.gaps - f57.gaps, msg).toBeGreaterThanOrEqual(0.04);
    // Morison sin la curvatura del riñón (C = 1 fuera de los tubos): con la cápsula renal de la 65 (s 0,2, σz 0,06: su
    // nivel lo fija χ(0)), 2,0–2,1 (con s 0,25 y χ(θ), 2,17; con 0,21, 2,23; el plan, con la curvatura, 2,08)
    expect(bin(R.morison, 0).ratio).toBeGreaterThanOrEqual(1.6);
    expect(bin(R.morison, 0).ratio).toBeLessThanOrEqual(2.2);
    expect(R.morison.saturated).toBeLessThanOrEqual(0.02);
  });

  it('decisión 65: la fragmentación depende de la incidencia (cápsula en espiral: CV de la traza a 0°, 10° y 20°)', () => {
    // la traza a lo largo de la cara entre líneas (la de la imagen), 4 semillas; con el eco de la 57 la línea es un
    // trazo: CV 0,09 / 0,12 / 0,22 (el moteado solo); con las facetas, 0,16 / 0,27 / 0,48 y huecos que aparecen a 20°
    const cv = (th: number, noFacets: boolean) => {
      const out: number[] = [];
      const gaps: number[] = [];
      for (const seed of [1, 2, 3, 4]) {
        const sc = spiralCapsule(th, 50);
        const o = simulate(sc, { model: 'echo', r0: 10, r1: 90, seed, noFacets });
        const ths: number[] = [];
        for (let u = 8; u < LINES - 8; u++) {
          const t = thetaOf(u);
          if (sc.faceR(t) >= 25 && sc.faceR(t) <= 75) ths.push(t);
        }
        const tr = faceTrace(o, sc.faceR, liverMed, [Math.min(...ths), Math.max(...ths)]);
        out.push(tr.cv);
        gaps.push(tr.gap);
      }
      return { cv: mean(out), gap: mean(gaps) };
    };
    const now = [0, 10, 20].map((th) => cv(th, false));
    const before = [0, 10, 20].map((th) => cv(th, true));
    const msg = JSON.stringify({ now, before });
    expect(now[0].cv, msg).toBeLessThan(0.3);
    expect(now[0].gap, msg).toBe(0);
    expect(now[1].cv, msg).toBeGreaterThan(0.22);
    expect(now[2].cv, msg).toBeGreaterThan(0.4);
    expect(now[2].gap, msg).toBeGreaterThan(0.1);
    expect(now[1].cv - now[0].cv, msg).toBeGreaterThan(0.06);
    // el eco de la 57: la cresta apenas varía a 10° (lo que da el moteado)
    expect(before[1].cv, msg).toBeLessThan(0.2);
    expect(before[2].gap, msg).toBeLessThan(0.05);
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
