import { maxPrfForDepth } from './equipment';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import type { Vec3 } from '../core/vec3';
import { C_RECONSTRUCTION_MM_S, nyquistVelocityCms, prfFromNyquistCms } from '../core/units';
import type { PhysiologySample } from '../physiology/engine';
import type { PatientState } from '../physiology/patientState';
import type { VesselId } from '../physiology/vessels';
import { PwDopplerChain } from '../doppler/pwChain';
import type { GateGeometry } from '../doppler/sampleVolume';
import type { GateVesselSample } from '../doppler/vesselIdentity';
import { startPointsFor, type StartPoint } from './startPoints';
import { bestGateOnVessel, type GatePlacement } from './gatePlacement';
import { acousticWindowWeight } from './gateTransmission';
import { pwGate, type PwGateInfo } from './pwGate';
import { pointOnLine } from '../probe/probe';
import { probeContact, type ProbeContact } from '../probe/contact';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import type { BModeSettings } from '../ultrasound/renderer';

/** Experimental acquisition settings; calibration is separate from physiological normality. */
export const VENOUS_SPECTRAL_SCALES = [50, 30, 50] as const;
export const VENOUS_FORWARD_SIGN = [-1, 1, -1] as const;
export type RenalSpectralWindow = 'venous' | 'paired';
export type HepaticSpectralWindow = 'standard' | 'tilted';
const WINDOWS: readonly { window: StartPoint['id']; vessels: readonly VesselId[]; gateMm: number }[] = [
  { window: 'intercostal', vessels: ['hvRight'], gateMm: 4 },
  { window: 'portalTrunk', vessels: ['pvTrunk'], gateMm: 6 },
  { window: 'renal', vessels: ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'], gateMm: 4 },
];

export const VENOUS_GATE_LENGTHS_MM = WINDOWS.map((w) => w.gateMm);

/** A missing anatomical window is an acquisition limitation, not a numerical engine failure. */
export class AcousticWindowUnavailableError extends Error {
  constructor(readonly window: StartPoint['id']) {
    super('No acoustic gate found for ' + window);
    this.name = 'AcousticWindowUnavailableError';
  }
}

/** Three virtual probe acquisitions through the same anatomical window code as the simulator.
 * Independent scene/query instances isolate probe compression; physiology remains shared and read-only.
 */
export class VenousSpectralAcquisition {
  readonly f0Hz = CONVEX_C35_PROFILE.geometry.f0Doppler;
  readonly scales: number[];
  readonly wallFilters: number[];
  readonly chains: PwDopplerChain[];
  readonly gateTracks: GateVesselSample[][];
  readonly materialCenters: Vec3[];
  readonly #gateLengthsMm: number[];
  readonly gateDepthsMm: readonly number[];
  readonly gateInfo: PwGateInfo[] = [];
  readonly #contexts: { anatomy: AnatomyQuery; contact: ProbeContact; best: GatePlacement; index: number }[];
  readonly #settings: Pick<BModeSettings, 'depthMm' | 'focusMm'>;
  readonly #seed: number;
  #lastT: number | null = null;
  #steps = 0;

  constructor(
    anatomy: AnatomyQuery,
    sample: PhysiologySample,
    seed: number,
    patient: PatientState,
    settings: Pick<BModeSettings, 'depthMm' | 'focusMm'>,
    renalWindow: RenalSpectralWindow = 'venous',
    hepaticWindow: HepaticSpectralWindow = 'standard',
    /** Restrict to one territory (0=hepatic, 1=portal, 2=renal); its public arrays then use index 0. */
    onlyWindow?: number,
  ) {
    if (onlyWindow !== undefined && (!Number.isInteger(onlyWindow) || onlyWindow < 0 || onlyWindow >= WINDOWS.length))
      throw new RangeError('Invalid PW territory');
    const windows = WINDOWS.map((w, index) => ({ ...w, index })).filter((w) => onlyWindow === undefined || w.index === onlyWindow);
    this.scales = windows.map(({ index }) => VENOUS_SPECTRAL_SCALES[index]);
    this.wallFilters = windows.map(() => 15);
    this.gateTracks = windows.map(() => []);
    this.#gateLengthsMm = windows.map(({ gateMm }) => gateMm);
    this.#seed = seed;
    this.#settings = { depthMm: settings.depthMm, focusMm: settings.focusMm };
    const profile = CONVEX_C35_PROFILE,
      tr = profile.geometry;
    this.#contexts = windows.map(({ window, vessels, gateMm, index }) => {
      const paired = window === 'renal' && renalWindow === 'paired';
      const scene = new AnatomyScene(patient),
        query = new AnatomyQuery(scene);
      // Reuse the exact reference body selected when the observed simulator was constructed.
      if (scene.torso.profile !== anatomy.scene.torso.profile) throw new Error('The reference body changed during acquisition setup');
      const sp = startPointsFor(scene.torso).find((s) => s.id === window)!;
      // Audited acquisition pose, not a velocity or brightness correction.
      const contact = probeContact(
        {
          phi: sp.phi,
          z: sp.z,
          yaw: sp.yaw,
          rock: sp.rock ?? 0,
          tilt: (sp.tilt ?? 0) - (paired ? Math.PI / 90 : 0) + (window === 'intercostal' && hepaticWindow === 'tilted' ? Math.PI / 90 : 0),
          lift: 0,
        },
        tr,
        scene.torso,
      );
      query.setProbeCompression(contact);
      const weight = acousticWindowWeight(query, contact.frame, tr, contact, sample, this.#settings.depthMm, profile.dopplerEffectiveMHz);
      // A virtual trunk acquisition should not straddle its terminal bifurcation.
      // One gate length is a geometric safeguard, not a clinical distance threshold.
      const portalEnd = window === 'portalTrunk' ? scene.vessels.find((v) => v.id === 'pvTrunk')!.tube.nodes.at(-1)!.p : null;
      const trunkInterior = portalEnd
        ? (candidate: GatePlacement) => {
            const q = query.classifyWorld(pointOnLine(contact.frame, tr, candidate.theta, candidate.r), sample);
            return Math.hypot(...q.material.map((value, i) => value - portalEnd[i])) >= gateMm;
          }
        : undefined;
      const best = bestGateOnVessel(
        query,
        contact.frame,
        tr,
        sample,
        paired ? ['interlobarArtery1', 'interlobarArtery2', 'interlobarArtery3'] : vessels,
        175,
        paired ? 0.2 : 1.2,
        weight,
        trunkInterior,
      );
      if (!best) throw new AcousticWindowUnavailableError(window);
      return { anatomy: query, contact, best, index };
    });
    this.gateDepthsMm = this.#contexts.map((c) => c.best.r);
    this.materialCenters = this.#contexts.map((c, i) => c.anatomy.deformation.toMaterial(this.gate(i, sample).center, sample.resp));
    this.chains = this.#contexts.map((c) => new PwDopplerChain(c.anatomy, seed + 7919 * (c.index + 1), undefined, { maxColumns: 4096 }));
  }

  gateLengthMm(index: number): number {
    return this.#gateLengthsMm[index];
  }

  setGateLengthMm(index: number, lengthMm: number): void {
    if (!this.#contexts[index] || ![2, 4, 6].includes(lengthMm)) throw new RangeError('Puerta PW fuera de dominio');
    this.#gateLengthsMm[index] = lengthMm;
  }

  /** The far edge must return before the next pulse; this viewer does not simulate HPRF. */
  prfHz(index: number): number {
    return Math.min(
      prfFromNyquistCms(this.scales[index], this.f0Hz),
      maxPrfForDepth(this.gateDepthsMm[index] + this.gateLengthMm(index) / 2, C_RECONSTRUCTION_MM_S),
    );
  }

  nyquistCms(index: number): number {
    return nyquistVelocityCms(this.prfHz(index), this.f0Hz);
  }

  gate(index: number, sample: PhysiologySample): GateGeometry {
    const { anatomy, contact, best } = this.#contexts[index];
    const result = pwGate(
      anatomy,
      contact.frame,
      contact,
      CONVEX_C35_PROFILE,
      this.#settings.focusMm,
      { theta: best.theta, depthMm: best.r, gateMm: this.gateLengthMm(index) },
      sample,
    );
    this.gateInfo[index] = result.info;
    return result.gate;
  }

  /** Input timestamps remain authoritative. A gap resets acquisition instead of bridging absent samples. */
  push(samples: readonly PhysiologySample[], dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) throw new Error('Paso temporal inválido');
    const prfs = this.chains.map((_, i) => this.prfHz(i));
    for (const s of samples) {
      if (!Number.isFinite(s.t)) throw new Error('Tiempo no finito');
      if (this.#lastT !== null && s.t <= this.#lastT) continue;
      if (this.#lastT !== null && Math.abs(s.t - this.#lastT - dt) > 1e-6) this.reset();
      for (const [i, chain] of this.chains.entries()) {
        chain.begin(prfs[i], this.f0Hz, 0, this.wallFilters[i], s.t);
        if (this.#steps % 8 === 0) chain.setGate(this.gate(i, s), s);
        // Each virtual probe stays on its anatomical window; respiratory dropout remains observable.
        chain.step(s, [0, 0, 0], dt);
        chain.flush();
        this.gateTracks[i].push({ t: s.t, vessels: { ...chain.sampleVolume.lastComposition.vessels } });
        while (this.gateTracks[i].length && this.gateTracks[i][0].t < s.t - 8) this.gateTracks[i].shift();
      }
      this.#lastT = s.t;
      this.#steps++;
    }
  }

  reset(): void {
    for (const chain of this.chains) chain.reset();
    for (const track of this.gateTracks) track.length = 0;
    this.#lastT = null;
    this.#steps = 0;
  }

  /** Replay a history with new equipment, retaining the already selected probe/gate geometry.
   * A fresh particle population is essential: history replay must not reuse future advection state.
   */
  reacquire(): void {
    for (const [i, context] of this.#contexts.entries())
      this.chains[i] = new PwDopplerChain(context.anatomy, this.#seed + 7919 * (context.index + 1), undefined, { maxColumns: 4096 });
    this.reset();
  }
}
