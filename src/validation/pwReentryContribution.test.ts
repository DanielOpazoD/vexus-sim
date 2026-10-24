import { describe, expect, it } from 'vitest';
import type { AnatomyQuery } from '../anatomy/query';
import { TISSUES, Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import type { PhysiologySample } from '../physiology/engine';
import { SampleVolumeIQ } from '../doppler/sampleVolume';

type Scenario = 'interior' | 'positive' | 'negative' | 'oblique' | 'fallback-blood' | 'fallback-tissue';
interface Particle {
  m: Vec3;
  amp: number;
  cr: number;
  ci: number;
  isBlood: boolean;
  tissue: Tissue;
  rampLeft: number;
}
interface ControlledState {
  scatterers: Particle[];
  tick: number;
  rng: { float(): number; gaussian(): number; range(lo: number, hi: number): number };
}
const PRF = 1000;

/** One controlled particle isolates transport from random interference and receiver noise.
 * The all-blood straight phantom has no taper, tributary or clinical calibration claim. */
function acquire(scenario: Scenario, chunks = [1, 1]) {
  const vx = scenario === 'negative' ? -100 : 100;
  const vz = scenario === 'oblique' ? 40 : 0;
  const fallback = scenario.startsWith('fallback');
  const blood = scenario !== 'fallback-tissue';
  const tissue = blood ? Tissue.Blood : Tissue.Liver;
  const velocity: Vec3 = [vx, 0, vz];
  const sample = { resp: {}, velocities: { hvRight: 1 } } as unknown as PhysiologySample;
  const anatomy = {
    deformation: { displacement: () => [0, 0, 0], tissueVelocity: () => [0, 0, 0] },
    scene: { vesselById: new Map() },
    classifyWorld: (p: Vec3) => ({
      tissue,
      vessel: blood ? 'hvRight' : null,
      material: p,
      bloodVelocity: blood ? velocity : null,
      flowBasis: blood ? velocity : null,
      tissueVelocity: [0, 0, 0],
    }),
  } as unknown as AnatomyQuery;
  const volume = new SampleVolumeIQ(anatomy, 19);
  volume.setEquipment({ prfHz: PRF, f0Hz: 3.5e6, gain: 1 });
  volume.setGate(
    {
      center: [0, 0, 0],
      beamDir: [0, 0, -1],
      lateral: [1, 0, 0],
      elevation: [0, 1, 0],
      lengthMm: 8,
      lateralSigmaMm: 1,
      elevationSigmaMm: 1,
      pulseSigmaMm: 0.25,
      apertureAngleSigmaRad: 0,
      transmission: 1,
    },
    sample,
  );
  const state = volume as unknown as ControlledState;
  const particle = state.scatterers[0];
  Object.assign(particle, {
    m: [scenario === 'interior' ? 0 : Math.sign(vx) * 2.45, fallback ? 3 : 0, 0],
    isBlood: true,
    tissue: Tissue.Blood,
    vessel: 'hvRight',
    vBlood: [...velocity],
    flowBasis: [...velocity],
    amp: 0.7 * TISSUES[Tissue.Blood].backscatter,
    cr: 1,
    ci: 0,
    rotC: 1,
    rotS: 0,
    fresh: true,
    fading: false,
    pending: null,
    rampLeft: 0,
    dAmp: 0,
    apAngle: 0,
    weightEpoch: -1,
  });
  state.scatterers = [particle];
  state.tick = 1; // This isolates renewal, not the separate partial-reclassification limitation.
  state.rng = { float: () => 0, gaussian: () => 0, range: () => 0 };
  const re = new Float32Array(2),
    im = new Float32Array(2);
  const states: { pulse: number; particle: Particle }[] = [];
  let offset = 0;
  for (const n of chunks) {
    volume.generate(sample, [0, 0, 0], n, re, im, offset);
    offset += n;
    const p = state.scatterers[0];
    states.push({
      pulse: offset,
      particle: {
        m: [...p.m],
        amp: p.amp,
        cr: p.cr,
        ci: p.ci,
        isBlood: p.isBlood,
        tissue: p.tissue,
        rampLeft: p.rampLeft,
      },
    });
  }
  // The 5 mm periodic chord preserves the overshoot. Fallback is centred by the controlled RNG.
  const entry = fallback ? [0, 0, 0] : scenario === 'interior' ? [vx / PRF, 0, 0] : [-Math.sign(vx) * 2.45, 0, vz / PRF - vz * 0.05];
  const dphi = (2 * Math.PI * ((2 * 3.5e6 * (blood ? vz : 0)) / 1540000)) / PRF;
  const expected = [0, 1].map((i) => {
    const m = [entry[0] + (blood ? (vx * i) / PRF : 0), 0, entry[2] + (blood ? (vz * i) / PRF : 0)];
    const amp = 0.7 * TISSUES[tissue].backscatter * (fallback ? (i + 1) / 32 : 1);
    const cr = Math.cos((i + 1) * dphi),
      ci = Math.sin((i + 1) * dphi);
    // Axial weight is one here under the documented erf tail approximation.
    const w = Math.exp(-0.5 * m[0] * m[0]);
    return {
      m,
      amp,
      cr,
      ci,
      isBlood: blood,
      tissue,
      rampLeft: fallback ? 31 - i : 0,
      re: Math.fround(amp * w * cr),
      im: Math.fround(amp * w * ci),
    };
  });
  return { re, im, states, expected };
}

describe('blood-box exits contribute IQ at the transported position in the current pulse', () => {
  for (const scenario of ['interior', 'positive', 'negative', 'oblique', 'fallback-blood', 'fallback-tissue'] as const)
    it(scenario, () => {
      const { re, im, states, expected } = acquire(scenario);
      for (let i = 0; i < 2; i++) {
        // Two float32 rounding units; no spectral/clinical tolerance is inferred.
        for (const component of ['re', 'im'] as const) {
          const actual = component === 're' ? re[i] : im[i];
          expect(Math.abs(actual - expected[i][component])).toBeLessThanOrEqual(Math.max(1e-12, Math.abs(expected[i][component]) * 2e-7));
        }
        const p = states[i].particle,
          e = expected[i];
        for (let k = 0; k < 3; k++) expect(Math.abs(p.m[k] - e.m[k])).toBeLessThanOrEqual(2e-12);
        for (const field of ['amp', 'cr', 'ci'] as const) expect(Math.abs(p[field] - e[field])).toBeLessThanOrEqual(2e-12);
        expect(p.isBlood).toBe(e.isBlood);
        expect(p.tissue).toBe(e.tissue);
        expect(p.rampLeft).toBe(e.rampLeft);
      }
    });

  it('two pulses equal two one-pulse batches, including fallback ramps', () => {
    for (const scenario of ['oblique', 'fallback-blood', 'fallback-tissue'] as const) {
      const a = acquire(scenario),
        b = acquire(scenario, [2]);
      expect(a.re).toEqual(b.re);
      expect(a.im).toEqual(b.im);
      expect(a.states.at(-1)).toEqual(b.states.at(-1));
    }
  });
});
