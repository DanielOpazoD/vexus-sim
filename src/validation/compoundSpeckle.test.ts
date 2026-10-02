// @tier slow
import { beforeAll, describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { envelopeTexture, type EnvelopeTexture } from '../app/fidelity';
import { START_POINTS } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import { CONVEX_C35, probeFrame } from '../probe/probe';
import { CONVEX_BEAM } from '../ultrasound/beamModel';
import { frequencyRatio } from '../ultrasound/beamEcho';
import { COMPOUND, lookTheta } from '../ultrasound/compound';
import { ElevationAnchor } from '../ultrasound/speckleField';
import { lookWavenumber, steerBeta } from '../ultrasound/steering';
import {
  TWIN_GEOMETRY as G,
  effectiveLooks,
  intensityCorrelation,
  lookCorrelationLaw,
  lookPatchEnvelopes,
  type TwinPatch,
} from './support/compoundTwin';

/**
 * Composición espacial en el gemelo B → C → D (decisión 58, T3): las tres miradas (0, +θ, −θ) de
 * `COMPOUND` formadas en la rejilla común con la fase por nodo, sobre el medio anclado de producción, y
 * su media lineal. A 20, 45, 90 y 150 mm (parches de 32 líneas × 144 muestras, 8 realizaciones):
 *
 *  - Mecanismo (campo coherente de un plano): la decorrelación entre miradas sigue la ley gaussiana de la
 *    PSF, ρ_I = exp(−(k2·2·sin(β/2)·σ)²/2), con σ el grano lateral medido de la mirada 0 / 2,355 y k2 a la
 *    frecuencia del eco en el parche, que baja con la profundidad (decisión 84).
 *  - Pasada B (tres planos, ½|f₀| + ¼(|f₁| + |f₂|)): la mezcla de magnitudes, no lineal y por muestra
 *    ANTES de la PSF, decorrela las miradas más que la ley: la rampa de fase de la mirada entre nodos de
 *    la retícula (≈ 1,1 rad por celda a 20 mm) cambia las magnitudes crudas a escala de la retícula, no de
 *    la PSF. Es un artefacto del modelo, no de la física del compuesto (una suma coherente en elevación
 *    seguiría la ley, como el plano único). Medido: ρ − ley de −0,05 a −0,11 y N_eff +4–12 % sobre la ley.
 *    Con la bajada de la frecuencia de la decisión 84, k2 baja con la profundidad y la rampa de fase entre nodos
 *    también: a 90 mm el exceso queda en −0,025 a −0,05. Se fija ese artefacto: ρ(0,±) − ley en [−0,13; −0,02],
 *    ρ(0,±) de tres planos al menos 0,03 por debajo
 *    del de un plano con las mismas realizaciones (la causa es la mezcla), N_eff entre la ley y +15 %; el
 *    grano del compuesto igual al de la mirada 0 (0,9–1,1: no es un filtro de suavizado, §23) y la
 *    fracción oscura ≤ 0,035 (Rayleigh: 0,068). ρ(−,+) solo se informa (aliasing de línea,
 *    `speckle-line-aliasing`). Calibrar θ con la desviación del gris (G4) absorbe este exceso: el θ
 *    calibrado no es una medida física del equipo.
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
const ST = new ElevationAnchor().update(fr.face, fr.elevation, 0);
const GEOM = { depthMm: G.depthMm, halfSector: G.halfSector, curvatureRadius: G.curvatureRadius };

interface BandStats {
  rho0p: number;
  rho0m: number;
  rhoPm: number;
  law1: number;
  law2: number;
  nEff: number;
  nEffLaw: number;
  look0: EnvelopeTexture[];
  compound: EnvelopeTexture[];
}

const mean = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0) / a.length;

function band(r: number, planes: 1 | 3): BandStats {
  const dr = G.depthMm / G.samples;
  const i0 = Math.round(r / dr - PATCH.rows / 2);
  // fuera del eje (la imagen no es simétrica respecto a él) y dentro de las tres miradas
  const j0 = G.lines / 2;
  const patch: TwinPatch = { j0, j1: j0 + PATCH.lines - 1, i0, i1: i0 + PATCH.rows - 1 };
  const inside = (u: number, v: number) => u >= patch.j0 && u <= patch.j1 && v >= patch.i0 && v <= patch.i1;
  const frameOf = (env: ArrayLike<number>) => {
    const data = new Float32Array(G.lines * G.samples);
    for (let i = 0; i < PATCH.rows; i++) for (let j = 0; j < PATCH.lines; j++) data[(i0 + i) * G.lines + j0 + j] = env[i * PATCH.lines + j];
    return { lines: G.lines, samples: G.samples, data };
  };
  const rho = { p: [] as number[], m: [] as number[], pm: [] as number[] };
  const look0: EnvelopeTexture[] = [];
  const compound: EnvelopeTexture[] = [];
  for (let s = 0; s < SEEDS; s++) {
    // sales separadas 1/7 de periodo del hash: realizaciones independientes
    const [e0, ep, em] = lookPatchEnvelopes(FRAME, ST, [0, TH, -TH], patch, 1.234 + s / (7 * 0.1031), K2, planes);
    rho.p.push(intensityCorrelation(e0, ep));
    rho.m.push(intensityCorrelation(e0, em));
    rho.pm.push(intensityCorrelation(ep, em));
    look0.push(envelopeTexture(frameOf(e0), inside, GEOM));
    compound.push(envelopeTexture(frameOf(Array.from(e0, (v, i) => (v + ep[i] + em[i]) / 3)), inside, GEOM));
  }
  const sigma = mean(look0.map((t) => t.fwhmLateralMm)) / 2.355;
  const beta = steerBeta(G.curvatureRadius + r, TH, G.curvatureRadius);
  // la fase de la mirada va a la frecuencia del eco (decisión 84): el gemelo, como la pasada B, usa k2·f(r)/f0
  const k2r = K2 * frequencyRatio(r, G.beam);
  const law1 = lookCorrelationLaw(beta, sigma, k2r);
  const law2 = lookCorrelationLaw(2 * beta, sigma, k2r);
  const [rho0p, rho0m, rhoPm] = [mean(rho.p), mean(rho.m), mean(rho.pm)];
  return {
    rho0p,
    rho0m,
    rhoPm,
    law1,
    law2,
    nEff: effectiveLooks(3, [rho0p, rho0m, rhoPm]),
    nEffLaw: effectiveLooks(3, [law1, law1, law2]),
    look0,
    compound,
  };
}

describe('composición espacial en el gemelo B → C → D (decisión 58)', () => {
  const coherent = new Map<number, BandStats>();
  const bmode = new Map<number, BandStats>();
  // ~4 s solo; con la suite entera en paralelo y la cobertura pasaba del plazo de 10 s de los ganchos
  beforeAll(() => {
    for (const r of DEPTHS) {
      coherent.set(r, band(r, 1));
      bmode.set(r, band(r, 3));
    }
  }, 120_000);

  it('mecanismo: con el campo coherente, la decorrelación entre miradas es la de la ley de la PSF', () => {
    for (const r of DEPTHS) {
      const b = coherent.get(r)!;
      for (const rho of [b.rho0p, b.rho0m])
        expect(Math.abs(rho - b.law1), `ρ(0,±) a ${r} mm: ${rho.toFixed(3)} frente a ${b.law1.toFixed(3)}`).toBeLessThanOrEqual(0.05);
      expect(
        Math.abs(b.nEff / b.nEffLaw - 1),
        `N_eff a ${r} mm: ${b.nEff.toFixed(2)} frente a ${b.nEffLaw.toFixed(2)}`,
      ).toBeLessThanOrEqual(0.1);
    }
  });

  it('pasada B de tres planos: la mezcla de magnitudes decorrela 0,05–0,11 más que la ley (artefacto fijado) y N_eff sube hasta +15 %', () => {
    for (const r of DEPTHS) {
      const b = bmode.get(r)!;
      const one = coherent.get(r)!;
      const ctx = `a ${r} mm: ρ(0,+) ${b.rho0p.toFixed(3)}, ρ(0,−) ${b.rho0m.toFixed(3)}, ley ${b.law1.toFixed(3)}, un plano ${one.rho0p.toFixed(3)}/${one.rho0m.toFixed(3)}, ρ(−,+) ${b.rhoPm.toFixed(3)} (ley ${b.law2.toFixed(3)})`;
      for (const rho of [b.rho0p, b.rho0m]) {
        expect(rho - b.law1, ctx).toBeLessThanOrEqual(-0.02);
        expect(rho - b.law1, ctx).toBeGreaterThanOrEqual(-0.13);
      }
      // la causa es la mezcla de los tres planos: con las mismas realizaciones y miradas, un plano no la tiene
      expect(b.rho0p - one.rho0p, ctx).toBeLessThanOrEqual(-0.03);
      expect(b.rho0m - one.rho0m, ctx).toBeLessThanOrEqual(-0.03);
      const nCtx = `N_eff ${b.nEff.toFixed(2)} frente a ${b.nEffLaw.toFixed(2)} ${ctx}`;
      expect(b.nEff / b.nEffLaw - 1, nCtx).toBeGreaterThanOrEqual(0);
      expect(b.nEff / b.nEffLaw - 1, nCtx).toBeLessThanOrEqual(0.15);
      // el compuesto sube la SNR como √N_eff (Burckhardt 1978): dentro de ±10 %
      const gain = mean(b.compound.map((t) => t.snr)) / mean(b.look0.map((t) => t.snr));
      expect(Math.abs(gain / Math.sqrt(b.nEff) - 1), `SNRc/SNR0 ${gain.toFixed(3)} ${ctx}`).toBeLessThanOrEqual(0.1);
    }
  });

  it('el grano del compuesto es el de la mirada 0 (no es un filtro) y apenas quedan huecos oscuros', () => {
    for (const r of DEPTHS) {
      const b = bmode.get(r)!;
      const lat = mean(b.compound.map((t) => t.fwhmLateralMm)) / mean(b.look0.map((t) => t.fwhmLateralMm));
      const ax = mean(b.compound.map((t) => t.fwhmAxialMm)) / mean(b.look0.map((t) => t.fwhmAxialMm));
      expect(lat, `grano lateral compuesto/mirada 0 a ${r} mm`).toBeGreaterThanOrEqual(0.9);
      expect(lat, `grano lateral compuesto/mirada 0 a ${r} mm`).toBeLessThanOrEqual(1.1);
      expect(ax, `grano axial compuesto/mirada 0 a ${r} mm`).toBeGreaterThanOrEqual(0.9);
      expect(ax, `grano axial compuesto/mirada 0 a ${r} mm`).toBeLessThanOrEqual(1.1);
      const dark0 = mean(b.look0.map((t) => t.darkFraction));
      const dark = mean(b.compound.map((t) => t.darkFraction));
      expect(dark0, `fracción oscura de la mirada 0 a ${r} mm (Rayleigh)`).toBeGreaterThan(0.05);
      expect(dark, `fracción oscura del compuesto a ${r} mm`).toBeLessThanOrEqual(0.035);
    }
  });
});
