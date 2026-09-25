// @tier slow
import { beforeAll, describe, expect, it } from 'vitest';
import { envelopeTexture } from '../app/fidelity';
import { SLIDING_DB, SLIDING_EFOLD_MM, edgeWidth1090Mm } from '../ultrasound/pleura';
import {
  LINES,
  envAt,
  greyAt,
  levelDbAt,
  liverReference,
  median,
  pearson,
  pleuraLateral,
  simulatePleura,
  thetaOf,
  type PleuraTwinOut,
} from './support/pleuraTwin';

/**
 * Gemelo B → C → D → G de la pleura parietal y la cortina (decisión 61, `support/pleuraTwin.ts`): las métricas
 * de aceptación del banco de GPU (spec §4, `docs/fidelity/README.md`) sobre una pared plana del adulto de
 * referencia con las funciones de producción. Antes de la decisión 61 la cortina era el espejo del diafragma:
 * bajo la pleura no había eco de la pleura parietal, ni neblina (el camino reflejado volvía a la pared y salía
 * al gel: negro) y las líneas A eran tres gaussianas de 1,2 mm.
 */
const deg = Math.PI / 180;
const GEOM = { depthMm: 180, halfSector: 34 * deg, curvatureRadius: 60 };
const central = [...Array(LINES).keys()].filter((u) => Math.abs(thetaOf(u)) <= 15 * deg);
const hazeLines = [...Array(LINES).keys()].filter((u) => Math.abs(thetaOf(u)) <= 25 * deg);

let liver = 1;
let full: PleuraTwinOut;
beforeAll(() => {
  liver = liverReference(1);
  full = simulatePleura({ edgeMm: -Infinity, seed: 1 });
}, 600_000);

/** Valores de `f(línea, r)` en [D + a, D·k + b] de las líneas `lines`. */
function band(
  o: PleuraTwinOut,
  lines: readonly number[],
  lo: (D: number) => number,
  hi: (D: number) => number,
  f: (u: number, r: number) => number,
): number[] {
  const out: number[] = [];
  for (const u of lines) {
    const D = o.D[u];
    for (let r = lo(D); r <= hi(D); r += o.dr) out.push(f(u, r));
  }
  return out;
}

describe('gemelo de la cortina: la imagen bajo la pleura parietal (decisión 61)', () => {
  it('la línea pleural satura ≥ 0,8 mm a 0–15° (la más brillante de la imagen) y se apaga a 30°', () => {
    const widths = central.map((u) => {
      let w = 0;
      for (let r = full.D[u] - 3; r <= full.D[u] + 3; r += 0.02) if (greyAt(envAt(full, u, r), r, liver) >= 250) w += 0.02;
      return w;
    });
    // gemelo: 1,24–1,30 mm
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(0.8);
    const edge = [...Array(LINES).keys()].filter((u) => Math.abs(Math.abs(thetaOf(u)) - 30 * deg) < 0.4 * deg);
    for (const u of edge) {
      let pk = 0;
      for (let r = full.D[u] - 3; r <= full.D[u] + 3; r += 0.02) pk = Math.max(pk, greyAt(envAt(full, u, r), r, liver));
      expect(pk).toBeLessThan(250);
    }
  });

  it('neblina bajo la pleura: mediana 0,35–0,9 del hígado en [D + 2, 2D − 2] y más oscura en el intervalo siguiente', () => {
    const grey = (u: number, r: number) => greyAt(envAt(full, u, r), r, liver);
    const first = median(
      band(
        full,
        hazeLines,
        (D) => D + 2,
        (D) => 2 * D - 2,
        grey,
      ),
    );
    const second = median(
      band(
        full,
        hazeLines,
        (D) => 2 * D + 2,
        (D) => 3 * D - 2,
        grey,
      ),
    );
    // gemelo: 61 y 32 de gris (el hígado puro, 100)
    expect(first / 100).toBeGreaterThanOrEqual(0.35);
    expect(first / 100).toBeLessThanOrEqual(0.9);
    expect(second).toBeLessThan(first);
  });

  it('líneas A: la de orden 2 destaca ≥ 3 dB sobre la neblina vecina y la 3 es más débil que la 2', () => {
    const lv = (u: number, r: number) => levelDbAt(envAt(full, u, r), r, liver);
    const peak = (u: number, k: number) => {
      let p = -1e9;
      for (let r = k * full.D[u] - 1.5; r <= k * full.D[u] + 1; r += 0.05) p = Math.max(p, lv(u, r));
      return p;
    };
    const around = (u: number, k: number) => {
      const D = full.D[u];
      const v: number[] = [];
      for (let r = (k - 0.4) * D; r <= (k - 0.15) * D; r += full.dr) v.push(lv(u, r));
      for (let r = (k + 0.15) * D; r <= (k + 0.4) * D; r += full.dr) v.push(lv(u, r));
      return median(v);
    };
    const pro2 = median(central.map((u) => peak(u, 2) - around(u, 2)));
    const pk2 = median(central.map((u) => peak(u, 2)));
    const pk3 = median(central.map((u) => peak(u, 3)));
    // gemelo: +45 dB sobre la neblina; 28 y 8 dB sobre el hígado
    expect(pro2).toBeGreaterThanOrEqual(3);
    expect(pk3).toBeLessThan(pk2);
  });

  it('anisotropía de la neblina: grano lateral ≥ 2,5 veces el axial (parches del banco)', () => {
    const t = envelopeTexture(
      { lines: LINES, samples: full.nv, data: full.env },
      (u, v) => {
        const r = (v + 0.5) * full.dr;
        return Math.abs(thetaOf(u)) <= 25 * deg && r >= full.D[u] + 2 && r <= 2 * full.D[u] - 2;
      },
      GEOM,
      { axial: 48, lateral: 16 },
    );
    // gemelo: 2,12 / 0,77 mm = 2,8
    expect(t.patches).toBeGreaterThanOrEqual(8);
    expect(t.fwhmLateralMm / t.fwhmAxialMm).toBeGreaterThanOrEqual(2.5);
  });

  it('el deslizamiento se ve a SLIDING_DB del hígado junto a la pleura (la ganancia de C y D, calibrada)', () => {
    const o = simulatePleura({ edgeMm: -Infinity, seed: 1, parts: { pleura: false, series: false, sliding: true, tissue: false } });
    // sin su caída con la profundidad: el nivel a 1–3 mm bajo la pleura, sobre el hígado a esa profundidad
    const v = band(
      o,
      hazeLines,
      (D) => D + 1,
      (D) => D + 3,
      (u, r) => levelDbAt(envAt(o, u, r), r, liver) + (20 * (r - o.D[u])) / SLIDING_EFOLD_MM / Math.LN10,
    );
    // gemelo: −8,5 dB con SLIDING_DB −9
    expect(Math.abs(median(v) - SLIDING_DB)).toBeLessThan(1.5);
  });

  it('deslizamiento: la banda de 2–6 mm bajo la pleura se decorrela al bajar el pulmón 2 mm; la pared no', () => {
    const a = simulatePleura({ edgeMm: -Infinity, seed: 1, caudalMm: 0, noiseSeed: 3 });
    const same = simulatePleura({ edgeMm: -Infinity, seed: 1, caudalMm: 0, noiseSeed: 4 });
    const moved = simulatePleura({ edgeMm: -Infinity, seed: 1, caudalMm: 2, noiseSeed: 4 });
    const env = (o: PleuraTwinOut) => (u: number, r: number) => envAt(o, u, r);
    const sub = (o: PleuraTwinOut) =>
      band(
        o,
        hazeLines,
        (D) => D + 2,
        (D) => D + 6,
        env(o),
      );
    const wall = (o: PleuraTwinOut) =>
      band(
        o,
        hazeLines,
        (D) => D - 6,
        (D) => D - 2,
        env(o),
      );
    // la misma fase: solo cambia el ruido del receptor (gemelo: 1,000)
    expect(pearson(sub(a), sub(same))).toBeGreaterThan(0.98);
    // otra fase (gemelo: 0,47 con 2 mm; 0,80 con 1 mm) y la pared quieta (1,000)
    expect(pearson(sub(a), sub(moved))).toBeLessThan(0.8);
    expect(pearson(wall(a), wall(moved))).toBeGreaterThanOrEqual(0.9);
  });

  it('borde de la cortina: 5–15 mm de 10 a 90 %, sigue al borde y fuera de él la imagen es la de siempre', () => {
    const fit = (o: PleuraTwinOut) => {
      const xs: number[] = [];
      const lv: number[] = [];
      for (let u = 20; u < LINES - 20; u++) {
        const D = o.D[u];
        const v: number[] = [];
        for (let r = 2 * D + 3; r <= 2 * D + 20; r += o.dr) v.push(levelDbAt(envAt(o, u, r), r, liver));
        xs.push(pleuraLateral(thetaOf(u)));
        lv.push(v.reduce((x, y) => x + y, 0) / v.length);
      }
      const hi = median(lv.filter((_, i) => xs[i] < -25));
      const lo = median(lv.filter((_, i) => xs[i] > 25));
      const Phi = (x: number) => 0.5 * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x ** 3)));
      let best = { e: Infinity, c: 0, s: 0 };
      for (let c = -25; c <= 25; c += 0.25)
        for (let s = 0.5; s <= 12; s += 0.1) {
          let e = 0;
          for (let i = 0; i < xs.length; i++) e += (lv[i] - (hi + (lo - hi) * Phi((xs[i] - c) / s))) ** 2;
          if (e < best.e) best = { e, c, s };
        }
      return best;
    };
    const e0 = fit(simulatePleura({ edgeMm: 0, seed: 1 }));
    const e10 = fit(simulatePleura({ edgeMm: 10, seed: 1 }));
    // gemelo: σ 4,6 mm (11,8 mm de 10 a 90 %), centro a 2 mm del borde
    expect(edgeWidth1090Mm(e0.s)).toBeGreaterThanOrEqual(5);
    expect(edgeWidth1090Mm(e0.s)).toBeLessThanOrEqual(15);
    expect(Math.abs(e10.c - e0.c - 10)).toBeLessThan(3);
    // lejos del borde por el lado del hígado (fAir < 10⁻³) la imagen es exactamente la de sin cortina
    const edge = simulatePleura({ edgeMm: 40, seed: 1, noiseSeed: 5 });
    const none = simulatePleura({ edgeMm: Infinity, seed: 1, noiseSeed: 5 });
    let lines = 0;
    for (let u = 0; u < LINES; u++) {
      // la línea y las que la PSF lateral de D mezcla con ella (±14)
      let clear = true;
      for (let q = Math.max(0, u - 14); q <= Math.min(LINES - 1, u + 14); q++) if (edge.fAir[q] > 0) clear = false;
      if (!clear) continue;
      lines++;
      for (let v = 0; v < edge.nv; v += 7) expect(edge.env[v * LINES + u]).toBe(none.env[v * LINES + u]);
    }
    expect(lines).toBeGreaterThan(80);
  });
});
