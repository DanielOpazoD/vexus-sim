import { AnatomyQuery } from '../anatomy/query';
import { add, cross, normalize, scale, sub, type Vec3 } from '../core/vec3';
import { prfFromNyquistCms } from '../core/units';
import type { PhysiologySample } from '../physiology/engine';
import { VENOUS_COMPARISON_CHANNELS } from '../physiology/venousComparison';
import { PwDopplerChain } from './pwChain';
import type { GateGeometry } from './sampleVolume';
import type { GateVesselSample } from './vesselIdentity';

export const VENOUS_SPECTRAL_SCALES = [80, 50, 60] as const;
/** Explicit virtual beam orientation: forward hepatic/renal below baseline, portal above. */
export const VENOUS_FORWARD_SIGN = [-1, 1, -1] as const;

/** Three virtual, vessel-following acquisitions; not three simultaneous physical probes.
 * Uses the existing spatial scatterers → IQ → wall filter → STFT pipeline, not an envelope texture.
 * Ideal transmission and beam alignment are explicit teaching assumptions, not an acoustic window claim.
 */
export class VenousSpectralAcquisition {
  readonly f0Hz = 2.5e6;
  readonly scales: number[] = [...VENOUS_SPECTRAL_SCALES];
  readonly chains: PwDopplerChain[];
  readonly gateTracks: GateVesselSample[][] = [[], [], []];
  readonly materialCenters: Vec3[];
  readonly #anatomy: AnatomyQuery;
  #lastT: number | null = null;

  constructor(anatomy: AnatomyQuery, sample: PhysiologySample, seed: number) {
    // Independent query cache and no probe compression; never modify the simulator's anatomy/query.
    this.#anatomy = new AnatomyQuery(anatomy.scene);
    this.materialCenters = VENOUS_COMPARISON_CHANNELS.map(({ vessel }) => {
      const nodes = anatomy.scene.vesselById.get(vessel)!.tube.nodes;
      let best: Vec3 | null = null;
      let clearance = -Infinity;
      for (let i = 1; i < nodes.length; i++) {
        for (const fraction of [0.25, 0.5, 0.75]) {
          const p = add(nodes[i - 1].p, scale(sub(nodes[i].p, nodes[i - 1].p), fraction));
          const world = this.#anatomy.deformation.toWorld(p, sample.resp);
          const hit = this.#anatomy.classifyWorld(world, sample);
          if (hit.vessel === vessel && hit.vesselHit && -hit.vesselHit.d > clearance) {
            clearance = -hit.vesselHit.d;
            best = p;
          }
        }
      }
      if (!best) throw new Error(`Sin puerta virtual válida en ${vessel}`);
      return best;
    });
    this.chains = VENOUS_COMPARISON_CHANNELS.map(
      (_, i) => new PwDopplerChain(this.#anatomy, seed + 7919 * (i + 1), undefined, { maxColumns: 4096 }),
    );
  }

  gate(index: number, sample: PhysiologySample): GateGeometry {
    const material = this.materialCenters[index];
    const center = this.#anatomy.deformation.toWorld(material, sample.resp);
    const hit = this.#anatomy.classifyWorld(center, sample);
    if (hit.vessel !== VENOUS_COMPARISON_CHANNELS[index].vessel || !hit.vesselHit) {
      throw new Error('La puerta virtual perdió su vaso; no se inventa señal');
    }
    // SampleVolumeIQ projects onto -beamDir; the chosen virtual probe orientation is explicit.
    const beamDir = scale(hit.vesselHit.tangent, -VENOUS_FORWARD_SIGN[index]);
    const lateral = normalize(cross(beamDir, Math.abs(beamDir[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]));
    return {
      center,
      beamDir,
      lateral,
      elevation: cross(beamDir, lateral),
      lengthMm: index === 2 ? 1 : 2,
      lateralSigmaMm: index === 2 ? 0.35 : 0.6,
      elevationSigmaMm: index === 2 ? 0.35 : 0.6,
      pulseSigmaMm: 0.25,
      apertureAngleSigmaRad: 0.04,
      transmission: 1,
    };
  }

  /** Input timestamps remain authoritative. A gap resets acquisition instead of bridging absent samples. */
  push(samples: readonly PhysiologySample[], dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) throw new Error('Paso temporal inválido');
    for (const s of samples) {
      if (!Number.isFinite(s.t)) throw new Error('Tiempo no finito');
      if (this.#lastT !== null && s.t <= this.#lastT) continue;
      if (this.#lastT !== null && Math.abs(s.t - this.#lastT - dt) > 1e-6) this.reset();
      for (const [i, chain] of this.chains.entries()) {
        chain.begin(prfFromNyquistCms(this.scales[i], this.f0Hz), this.f0Hz, 0, 15, s.t);
        chain.setGate(this.gate(i, s), s);
        // Tracked virtual gate follows bulk tissue displacement; venous flow still carries respiratory modulation.
        chain.step(s, this.#anatomy.deformation.tissueVelocity(this.materialCenters[i], s.resp), dt);
        chain.flush();
        this.gateTracks[i].push({ t: s.t, vessels: { ...chain.sampleVolume.lastComposition.vessels } });
        while (this.gateTracks[i].length && this.gateTracks[i][0].t < s.t - 8) this.gateTracks[i].shift();
      }
      this.#lastT = s.t;
    }
  }

  reset(): void {
    for (const chain of this.chains) chain.reset();
    for (const track of this.gateTracks) track.length = 0;
    this.#lastT = null;
  }
}
