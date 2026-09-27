// @tier slow
import { beforeAll, describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { envelopeTexture, type EnvelopeTexture } from '../app/fidelity';
import { patchSnr, SPECKLE_PATCH } from '../app/speckle';
import { START_POINTS } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import { CONVEX_C35, probeFrame } from '../probe/probe';
import { CONVEX_BEAM, lateralFwhmMm } from '../ultrasound/beamModel';
import { COMPOUND, lookTheta } from '../ultrasound/compound';
import { ElevationAnchor, strongScatter } from '../ultrasound/speckleField';
import { lookWavenumber } from '../ultrasound/steering';
import {
  TWIN_GEOMETRY as G,
  effectiveLooks,
  intensityCorrelation,
  lookPatchEnvelopes,
  type TwinPatch,
  type TwinTexture,
} from './support/compoundTwin';

/**
 * Lo que la textura del hígado (decisión 89) hace a las métricas de la envolvente con las que la e2e y el banco vigilan el
 * moteado, en el gemelo B → C → D de la composición (el de `compoundSpeckle.test.ts`: la subxifoidea del sano, parches de
 * 32 líneas × 144 muestras a 20, 45, 90 y 150 mm, 8 realizaciones, las mismas sales con y sin la textura). Esas métricas
 * se definieron para un moteado de Rayleigh (decisiones 52 y 58); el hígado ya no lo es a propósito (m de Nakagami 0,85 en
 * ventanas de tres pulsos, como el hígado sano in vivo, `parenchymaTexture.test.ts`), así que sus bandas se desplazan. Esta
 * prueba fija cuánto y en qué sentido, y que los defectos que las guardas buscan siguen fuera:
 *
 *  - la SNR de la envolvente baja (mirada 0 ×0,84–0,88; compuesto ×0,75–0,80: la composición promedia el moteado, no la
 *    densidad de dispersores ni los nodos fuertes, que son los mismos en las tres miradas);
 *  - la fracción oscura y las grietas suben (las zonas de menos densidad quedan por debajo de 0,3 × la media del parche);
 *  - el grano medido (FWHM de la autocovarianza normalizada por la varianza del parche) crece: la densidad, de 4 mm, añade
 *    un pedestal ancho a la autocovarianza, y más en el compuesto, que tiene menos varianza de moteado;
 *  - la desviación del gris (en dB) del compuesto crece ×1,19–1,27 (G4).
 */
const DEPTHS = [20, 45, 90, 150];
const SEEDS = 8;
const PATCH = { lines: 32, rows: 144 };
const K2 = lookWavenumber(CONVEX_BEAM);
const TH = lookTheta(1, COMPOUND);
const sp = START_POINTS.find((s) => s.id === 'subxiphoid')!;
const fr = probeFrame(
  { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 },
  new AnatomyScene(NORMAL_ADULT).torso,
  CONVEX_C35,
);
const FRAME = { center: fr.curvatureCenter, axial: fr.axial, lateral: fr.lateral, elevation: fr.elevation, face: fr.face };
const ST = new ElevationAnchor().update(fr.face, fr.elevation);
const GEOM = { depthMm: G.depthMm, halfSector: G.halfSector, curvatureRadius: G.curvatureRadius };

interface Stats {
  look0: EnvelopeTexture[];
  compound: EnvelopeTexture[];
  /** El compuesto suavizado con un binomial [¼ ½ ¼] en las dos direcciones: el defecto que la razón de grano busca. */
  smoothed: EnvelopeTexture[];
  perLook: EnvelopeTexture[];
  /** SNR de la mirada 0 en los parches de 16 × 8 de la guarda de Rayleigh (`speckleStats`). */
  small: number[];
  /** Muestras de la envolvente de la mirada 0 (la mediana) y, con la textura, las de solo los nodos fuertes. */
  env0: number[];
  envStrong: number[];
  /**
   * Con la textura, los defectos que buscan las guardas de una mirada, sobre la mirada 0: SNR por parche de 48 × 16 y de
   * 16 × 8 (y la fracción oscura de 48 × 16) con la intensidad en lugar de la envolvente, con |Re f|, con la envolvente
   * suavizada por la caja de 3 líneas × 5 muestras de `speckle.test.ts` y por el binomial [¼ ½ ¼] en las dos direcciones.
   */
  defects: Record<'intensity' | 'absRe' | 'box' | 'binomial', { snr: number[]; small: number[]; dark: number[] }>;
  nEff: number;
  /** Desviación de 20·log10 de la envolvente (dB), mirada 0 y compuesto. */
  sdDb0: number;
  sdDbC: number;
  beamFwhmMm: number;
}

const mean = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
const sdDb = (env: ArrayLike<number>): number => {
  const d = Array.from(env, (x) => 20 * Math.log10(Math.max(x, 1e-12)));
  const m = mean(d);
  return Math.sqrt(mean(d.map((x) => (x - m) ** 2)));
};

function smooth(env: ArrayLike<number>, nL: number, nR: number): Float64Array {
  const w = [0.25, 0.5, 0.25];
  const a = new Float64Array(nL * nR);
  const b = new Float64Array(nL * nR);
  for (let i = 0; i < nR; i++)
    for (let j = 0; j < nL; j++) {
      let s = 0;
      for (let q = -1; q <= 1; q++) s += w[q + 1] * env[i * nL + Math.min(nL - 1, Math.max(0, j + q))];
      a[i * nL + j] = s;
    }
  for (let i = 0; i < nR; i++)
    for (let j = 0; j < nL; j++) {
      let s = 0;
      for (let q = -1; q <= 1; q++) s += w[q + 1] * a[Math.min(nR - 1, Math.max(0, i + q)) * nL + j];
      b[i * nL + j] = s;
    }
  return b;
}

function box3x5(env: ArrayLike<number>, nL: number, nR: number): Float64Array {
  const out = new Float64Array(nL * nR);
  for (let i = 0; i < nR; i++)
    for (let j = 0; j < nL; j++) {
      let acc = 0;
      let n = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -2; di <= 2; di++) {
          const jj = j + dj;
          const ii = i + di;
          if (jj < 0 || jj >= nL || ii < 0 || ii >= nR) continue;
          acc += env[ii * nL + jj];
          n++;
        }
      out[i * nL + j] = acc / n;
    }
  return out;
}

function stats(r: number, texture: boolean): Stats {
  const dr = G.depthMm / G.samples;
  const i0 = Math.round(r / dr - PATCH.rows / 2);
  const j0 = G.lines / 2;
  const patch: TwinPatch = { j0, j1: j0 + PATCH.lines - 1, i0, i1: i0 + PATCH.rows - 1 };
  const inside = (u: number, v: number) => u >= patch.j0 && u <= patch.j1 && v >= patch.i0 && v <= patch.i1;
  const frameOf = (env: ArrayLike<number>) => {
    const data = new Float32Array(G.lines * G.samples);
    for (let i = 0; i < PATCH.rows; i++) for (let j = 0; j < PATCH.lines; j++) data[(i0 + i) * G.lines + j0 + j] = env[i * PATCH.lines + j];
    return { lines: G.lines, samples: G.samples, data };
  };
  const defect = () => ({ snr: [] as number[], small: [] as number[], dark: [] as number[] });
  const out: Stats = {
    look0: [],
    compound: [],
    smoothed: [],
    perLook: [],
    small: [],
    env0: [],
    envStrong: [],
    defects: { intensity: defect(), absRe: defect(), box: defect(), binomial: defect() },
    nEff: 0,
    sdDb0: 0,
    sdDbC: 0,
    beamFwhmMm: 0,
  };
  const measure = (d: Stats['defects'][keyof Stats['defects']], env: ArrayLike<number>) => {
    const t = envelopeTexture(frameOf(env), inside, GEOM);
    d.snr.push(t.snr);
    d.dark.push(t.darkFraction);
    d.small.push(patchSnr(frameOf(env), inside, SPECKLE_PATCH).snr);
  };
  const rho = { p: [] as number[], m: [] as number[], pm: [] as number[] };
  const sd0: number[] = [];
  const sdC: number[] = [];
  for (let s = 0; s < SEEDS; s++) {
    // las sales de `compoundSpeckle.test.ts`; la densidad, otra realización por sal (anclada al material como en la GPU)
    const salt = 1.234 + s / (7 * 0.1031);
    const tex: TwinTexture | null = texture ? { strong: strongScatter(Tissue.Liver), densitySeed: 17 + 3.1 * s } : null;
    const [e0, ep, em] = lookPatchEnvelopes(FRAME, ST, [0, TH, -TH], patch, salt, K2, 3, G, tex);
    for (const v of e0) out.env0.push(v);
    if (tex) {
      const [strongOnly] = lookPatchEnvelopes(FRAME, ST, [0], patch, salt, K2, 3, G, { strong: tex.strong, densitySeed: null });
      for (const v of strongOnly) out.envStrong.push(v);
      const [intensity] = lookPatchEnvelopes(FRAME, ST, [0], patch, salt, K2, 3, G, tex, (re, im) => re * re + im * im);
      const [absRe] = lookPatchEnvelopes(FRAME, ST, [0], patch, salt, K2, 3, G, tex, (re) => Math.abs(re));
      measure(out.defects.intensity, intensity);
      measure(out.defects.absRe, absRe);
      measure(out.defects.box, box3x5(e0, PATCH.lines, PATCH.rows));
      measure(out.defects.binomial, smooth(e0, PATCH.lines, PATCH.rows));
    }
    const c = Float64Array.from(e0, (v, i) => (v + ep[i] + em[i]) / 3);
    rho.p.push(intensityCorrelation(e0, ep));
    rho.m.push(intensityCorrelation(e0, em));
    rho.pm.push(intensityCorrelation(ep, em));
    out.look0.push(envelopeTexture(frameOf(e0), inside, GEOM));
    out.small.push(patchSnr(frameOf(e0), inside, SPECKLE_PATCH).snr);
    out.compound.push(envelopeTexture(frameOf(c), inside, GEOM));
    out.smoothed.push(envelopeTexture(frameOf(smooth(c, PATCH.lines, PATCH.rows)), inside, GEOM));
    out.perLook.push(envelopeTexture(frameOf(ep), inside, GEOM), envelopeTexture(frameOf(em), inside, GEOM));
    sd0.push(sdDb(e0));
    sdC.push(sdDb(c));
  }
  out.nEff = effectiveLooks(3, [mean(rho.p), mean(rho.m), mean(rho.pm)]);
  out.sdDb0 = mean(sd0);
  out.sdDbC = mean(sdC);
  out.beamFwhmMm = lateralFwhmMm(r, G.focusMm, G.beam);
  return out;
}

const avg = (t: EnvelopeTexture[], k: keyof EnvelopeTexture): number => mean(t.map((x) => x[k]));

/** Bandas de la e2e (`e2e/smoke.spec.ts`) y de los objetivos del banco (`docs/fidelity/README.md`) con la textura. */
const TEXTURED_GUARDS = {
  /** SNR de la guarda de Rayleigh, parches de 16 × 8 de una mirada (antes 1,6–2,25). */
  rayleigh: [1.5, 2.1],
  /** SNR de la envolvente por parche de 48 × 16, mirada 0 y cada mirada del compuesto (antes 1,75–2,1). */
  snr: [1.45, 1.9],
  /** Fracción oscura de la mirada 0 (antes 0,05–0,09). */
  dark: [0.05, 0.11],
  /** Índice de grietas de la mirada 0 (antes < 0,12) y del compuesto (G3, antes ≤ 0,04). */
  crack: 0.25,
  crackCompound: 0.2,
  /** Grano axial (K2, antes 0,5–0,9 mm) y lateral ÷ PSF (K1, antes 0,8–1,25). */
  axialMm: [0.5, 1.0],
  lateralToPsf: [0.8, 1.4],
  /** SNR del compuesto (G1, antes 2,1 / 2,0): 20–60 y 140–180 mm, y 60–140 mm. */
  compoundSnr: { outer: 1.7, inner: 1.6, max: 3.0 },
  /** Razón de grano compuesto ÷ mirada 0 con ≥ 10 parches y con menos (antes 1,1 y 1,15). */
  grainRatio: { many: 1.15, few: 1.2 },
} as const;

describe('textura del hígado en el gemelo de la composición: las bandas de las guardas del moteado (decisión 89)', () => {
  const plain = new Map<number, Stats>();
  const liver = new Map<number, Stats>();
  beforeAll(() => {
    for (const r of DEPTHS) {
      plain.set(r, stats(r, false));
      liver.set(r, stats(r, true));
    }
  }, 180_000);
  const T = TEXTURED_GUARDS;
  const within = (x: number, [lo, hi]: readonly [number, number]) => x >= lo && x <= hi;

  it('mirada 0: la SNR baja 0,2–0,35 y queda en su banda nueva, con más oscuros y grietas, pero lejos de los defectos', () => {
    for (const r of DEPTHS) {
      const [p, l] = [plain.get(r)!, liver.get(r)!];
      const snr = avg(l.look0, 'snr');
      const drop = avg(p.look0, 'snr') - snr;
      expect(drop, `${r} mm: SNR ${snr.toFixed(3)}, baja ${drop.toFixed(3)}`).toBeGreaterThan(0.2);
      expect(drop, `${r} mm`).toBeLessThan(0.35);
      expect(within(snr, T.snr), `${r} mm: SNR ${snr.toFixed(3)}`).toBe(true);
      // ≥ 0,2 sobre el suelo y ≥ 0,1 bajo el techo (los defectos, en su propia prueba)
      expect(snr - T.snr[0], `${r} mm`).toBeGreaterThan(0.2);
      expect(T.snr[1] - snr, `${r} mm`).toBeGreaterThan(0.1);
      const dark = avg(l.look0, 'darkFraction');
      expect(within(dark, T.dark), `${r} mm: oscuros ${dark.toFixed(3)}`).toBe(true);
      expect(dark, `${r} mm`).toBeGreaterThan(avg(p.look0, 'darkFraction'));
      // la guarda de Rayleigh (parches de 16 × 8): ×0,85–0,93 y ≥ 0,2 sobre su suelo nuevo
      const small = mean(l.small);
      expect(small / mean(p.small), `${r} mm: 16 × 8 ${small.toFixed(3)} frente a ${mean(p.small).toFixed(3)}`).toBeGreaterThan(0.85);
      expect(small / mean(p.small), `${r} mm`).toBeLessThan(0.93);
      expect(
        within(small, T.rayleigh) && small - T.rayleigh[0] > 0.2 && T.rayleigh[1] - small > 0.1,
        `${r} mm: 16 × 8 ${small.toFixed(3)}`,
      ).toBe(true);
      const crack = avg(l.look0, 'crackIndex');
      expect(crack, `${r} mm: grietas ${crack.toFixed(3)}`).toBeLessThan(T.crack);
      expect(crack, `${r} mm`).toBeGreaterThan(avg(p.look0, 'crackIndex'));
    }
  });

  it('la mediana de la envolvente del hígado es la del moteado difuso: el nivel de los nodos anula la subida de los fuertes', () => {
    // todas las profundidades y realizaciones juntas; en dB. Sin el nivel (level = 1), los fuertes solos la subían +0,48 dB
    const med = (a: number[]) => {
      const v = [...a].sort((x, y) => x - y);
      return v[v.length >> 1];
    };
    const pool = (m: Map<number, Stats>, k: 'env0' | 'envStrong') => DEPTHS.flatMap((r) => m.get(r)![k]);
    const ref = med(pool(plain, 'env0'));
    const strongDb = 20 * Math.log10(med(pool(liver, 'envStrong')) / ref);
    const bothDb = 20 * Math.log10(med(pool(liver, 'env0')) / ref);
    expect(Math.abs(strongDb), `solo los fuertes: ${strongDb.toFixed(3)} dB`).toBeLessThan(0.1);
    // la densidad, simétrica en dB, no mueve la mediana más que el ruido de sus 32 realizaciones
    expect(Math.abs(bothDb), `fuertes y densidad: ${bothDb.toFixed(3)} dB`).toBeLessThan(0.15);
    for (const r of DEPTHS) {
      const d = 20 * Math.log10(med(liver.get(r)!.envStrong) / med(plain.get(r)!.env0));
      expect(Math.abs(d), `${r} mm, solo los fuertes: ${d.toFixed(3)} dB`).toBeLessThan(0.1);
    }
  });

  it('los defectos que buscan las guardas de una mirada siguen fuera de sus bandas nuevas con la textura', () => {
    for (const r of DEPTHS) {
      const d = liver.get(r)!.defects;
      const at = (k: keyof Stats['defects']) => ({ snr: mean(d[k].snr), small: mean(d[k].small), dark: mean(d[k].dark) });
      const tag = (k: keyof Stats['defects']) => `${r} mm, ${k}: ${JSON.stringify(at(k))}`;
      // intensidad en lugar de la envolvente y |Re f| (la hipótesis de un juez): por debajo de los dos suelos, con margen
      for (const k of ['intensity', 'absRe'] as const) {
        expect(at(k).snr, tag(k)).toBeLessThan(T.snr[0] - 0.1);
        expect(at(k).small, tag(k)).toBeLessThan(T.rayleigh[0] - 0.05);
      }
      // |Re f| deja además muchos oscuros (≥ 0,15 frente al techo de 0,11)
      expect(at('absRe').dark, tag('absRe')).toBeGreaterThan(T.dark[1] + 0.04);
      // el suavizado de la envolvente (la caja de `speckle.test.ts` y el binomial): por encima de los dos techos
      for (const k of ['box', 'binomial'] as const) expect(at(k).snr, tag(k)).toBeGreaterThan(T.snr[1] + 0.1);
      expect(at('box').small, tag('box')).toBeGreaterThan(T.rayleigh[1] + 0.3);
    }
  });

  it('el grano medido crece con el pedestal de la densidad (mirada 0 +5–15 % axial, compuesto más) y sigue en K1 y K2', () => {
    for (const r of DEPTHS) {
      const [p, l] = [plain.get(r)!, liver.get(r)!];
      const ax = avg(l.look0, 'fwhmAxialMm');
      expect(ax / avg(p.look0, 'fwhmAxialMm'), `${r} mm: axial ${ax.toFixed(2)} mm`).toBeGreaterThan(1.05);
      expect(ax / avg(p.look0, 'fwhmAxialMm'), `${r} mm`).toBeLessThan(1.15);
      expect(within(ax, T.axialMm), `${r} mm: axial ${ax.toFixed(2)} mm`).toBe(true);
      for (const [name, t] of [
        ['mirada 0', l.look0],
        ['compuesto', l.compound],
      ] as const) {
        const k1 = avg(t, 'fwhmLateralMm') / l.beamFwhmMm;
        expect(within(k1, T.lateralToPsf), `${r} mm, ${name}: lateral ÷ PSF ${k1.toFixed(3)}`).toBe(true);
      }
    }
  });

  it('compuesto: la SNR sube √N_eff sobre la de la mirada 0 (N_eff baja: la textura es la misma en las tres miradas) y cumple G1, G2 y G3 nuevos', () => {
    for (const r of DEPTHS) {
      const [p, l] = [plain.get(r)!, liver.get(r)!];
      const c = avg(l.compound, 'snr');
      const gain = c / avg(l.look0, 'snr');
      expect(Math.abs(gain / Math.sqrt(l.nEff) - 1), `${r} mm: ×${gain.toFixed(3)} frente a √${l.nEff.toFixed(2)}`).toBeLessThanOrEqual(
        0.1,
      );
      expect(l.nEff, `${r} mm`).toBeLessThan(p.nEff);
      expect(c, `${r} mm: SNR ${c.toFixed(3)}`).toBeGreaterThanOrEqual(r < 60 || r >= 140 ? T.compoundSnr.outer : T.compoundSnr.inner);
      expect(c, `${r} mm`).toBeLessThanOrEqual(T.compoundSnr.max);
      expect(avg(l.compound, 'darkFraction'), `${r} mm`).toBeLessThanOrEqual(0.035);
      expect(avg(l.compound, 'crackIndex'), `${r} mm`).toBeLessThanOrEqual(T.crackCompound);
      const perLook = avg(l.perLook, 'snr');
      expect(within(perLook, T.snr), `${r} mm: SNR por mirada ${perLook.toFixed(3)}`).toBe(true);
    }
  });

  it('la razón de grano compuesto ÷ mirada 0 sube hasta ~1,10 y un suavizado del compuesto sigue fuera de la banda', () => {
    for (const r of DEPTHS) {
      const l = liver.get(r)!;
      const lat = avg(l.compound, 'fwhmLateralMm') / avg(l.look0, 'fwhmLateralMm');
      const ax = avg(l.compound, 'fwhmAxialMm') / avg(l.look0, 'fwhmAxialMm');
      for (const g of [lat, ax]) {
        expect(g, `${r} mm: ${lat.toFixed(3)} × ${ax.toFixed(3)}`).toBeGreaterThanOrEqual(0.9);
        expect(g, `${r} mm: ${lat.toFixed(3)} × ${ax.toFixed(3)}`).toBeLessThanOrEqual(T.grainRatio.many);
      }
      const sLat = avg(l.smoothed, 'fwhmLateralMm') / avg(l.look0, 'fwhmLateralMm');
      const sAx = avg(l.smoothed, 'fwhmAxialMm') / avg(l.look0, 'fwhmAxialMm');
      expect(Math.max(sLat, sAx), `${r} mm: suavizado ${sLat.toFixed(3)} × ${sAx.toFixed(3)}`).toBeGreaterThan(T.grainRatio.few + 0.05);
    }
  });

  it('G4: la desviación del gris del compuesto (en dB) crece ×1,15–1,35 y la de la mirada 0 ×1,05–1,15', () => {
    for (const r of DEPTHS) {
      const [p, l] = [plain.get(r)!, liver.get(r)!];
      const c = l.sdDbC / p.sdDbC;
      const z = l.sdDb0 / p.sdDb0;
      expect(c, `${r} mm: compuesto ×${c.toFixed(3)}`).toBeGreaterThan(1.15);
      expect(c, `${r} mm`).toBeLessThan(1.35);
      expect(z, `${r} mm: mirada 0 ×${z.toFixed(3)}`).toBeGreaterThan(1.05);
      expect(z, `${r} mm`).toBeLessThan(1.15);
    }
  });
});
