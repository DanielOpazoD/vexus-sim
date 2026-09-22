import { SimulationClock } from '../core/clock';
import type { PatientState } from './patientState';
import { validatePatient } from './patientState';
import { RespiratoryModel, type RespiratorySample } from './respiratory';
import { RhythmGenerator, gauss } from './rhythm';
import { RightAtriumModel } from './rightAtrium';
import { VenousNetwork, defaultNetworkParams, type NetworkOutputs } from './venousNetwork';
import { HV_FLOW_SHARE, INTERLOBAR_FLOW_SHARE, PV_FLOW_SHARE, VESSEL_IDS, type VesselAreas, type VesselId } from './vessels';

/**
 * Muestra del estado fisiológico en un instante del reloj. Es la única
 * interfaz entre fisiología y el resto del motor (anatomía, Doppler, UI).
 */
export interface PhysiologySample {
  t: number;
  ecgMv: number;
  cardiacPhase: number;
  beatIndex: number;
  lastR: number;
  rr: number;
  resp: RespiratorySample;
  pRa: number;
  pIvc: number;
  pIvcTransmural: number;
  pHepatic: number;
  pSplanchnic: number;
  pAbd: number;
  pPleural: number;
  qHepaticVein: number;
  qPortal: number;
  qHepaticArtery: number;
  qIvcToRa: number;
  qLowerBody: number;
  /** Lecho renal (ambos riñones). */
  pRenal: number;
  qRenalArtery: number;
  qRenalVein: number;
  ivc: { dEqMm: number; dApMm: number; dLatMm: number };
  /** Escala de radio de las suprahepáticas respecto al basal (≥ 0,5). */
  hvRadiusScale: number;
  pvRadiusScale: number;
  /** Velocidad media espacial u = Q/A por vaso, mm/s, sentido fisiológico positivo. */
  velocities: Record<VesselId, number>;
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export class PhysiologyEngine {
  readonly clock: SimulationClock;
  readonly patient: PatientState;
  readonly rhythm: RhythmGenerator;
  readonly respiratory: RespiratoryModel;
  readonly rightAtrium: RightAtriumModel;
  readonly network: VenousNetwork;
  readonly areas: VesselAreas;
  /** Historial reciente (para ECG, mediciones y clasificación). */
  private history: PhysiologySample[] = [];
  private historySeconds: number;
  private current: PhysiologySample;

  constructor(patient: PatientState, areas: VesselAreas, opts: { dt?: number; historySeconds?: number } = {}) {
    validatePatient(patient);
    this.patient = patient;
    this.areas = areas;
    this.clock = new SimulationClock(opts.dt ?? 0.004);
    this.historySeconds = opts.historySeconds ?? 12;
    this.rhythm = new RhythmGenerator(patient, patient.seed ^ 0x51a7);
    this.respiratory = new RespiratoryModel(patient);
    this.rightAtrium = new RightAtriumModel(patient, this.rhythm);
    const rap = patient.rapMeanMmHg;
    const pAbd0 = patient.intraAbdominalPressureMmHg;
    const k = defaultNetworkParams(patient);
    // Régimen estacionario medio (punto fijo): las constantes de tiempo del
    // esplácnico y del cuerpo inferior son de minutos, por lo que no basta un
    // calentamiento corto para llegar a él.
    let pIvc = rap + 1;
    let pHep = rap + 2;
    let pSp = rap + 5;
    let pLb = rap + 3;
    for (let i = 0; i < 60; i++) {
      pSp = (k.pArtMean * k.rPortal + pHep * k.rArtSplanchnic) / (k.rArtSplanchnic + k.rPortal);
      const qPv = (pSp - pHep) / k.rPortal;
      const qHa = Math.max(0, (k.pArtMean - pHep) / k.rHepaticArtery);
      pLb = (k.pArtMean * k.rLowerBody + pIvc * k.rArtLowerBody) / (k.rArtLowerBody + k.rLowerBody);
      const qLb = (pLb - pIvc) / k.rLowerBody;
      const pJ = rap + k.rJunction * (qPv + qHa + qLb);
      pHep = pJ + k.rHepaticVein * (qPv + qHa);
      pIvc = pJ + k.rIvcToRa * qLb;
    }
    this.network = new VenousNetwork(k, {
      pSplanchnic: pSp - pAbd0,
      pHepatic: pHep - pAbd0,
      pLowerBody: pLb,
      pIvcTransmural: pIvc - pAbd0,
    });
    this.warmUp();
    this.current = this.sampleFrom(this.network.last, 0);
    this.history.push(this.current);
  }

  /** Lleva la red a su régimen medio antes de t = 0 (sin ondas cardíacas). */
  private warmUp(): void {
    const pl = this.respiratory.pleuralAtEndExpiration();
    const pRa = this.rightAtrium.pressure(-100, pl, pl);
    const pAbd = this.patient.intraAbdominalPressureMmHg;
    for (let i = 0; i < 3000; i++) this.network.step(this.clock.dt, 0, pRa, pAbd);
  }

  get sample(): PhysiologySample {
    return this.current;
  }

  /** Historial ordenado por tiempo (referencia, no copia). */
  get samples(): readonly PhysiologySample[] {
    return this.history;
  }

  /** Factor pulsátil arterial ∈ ≈[−0,35, 1], centrado en media ≈ 0. */
  private arterialPulse(t: number): number {
    let v = -0.3;
    for (const b of this.rhythm.beatsAround(t)) {
      const s = Math.sqrt(b.rr / 0.8);
      const tau = t - b.tR;
      v += gauss(tau - 0.12 * s, 0.06 * s) + 0.4 * gauss(tau - 0.3 * s, 0.09 * s);
    }
    return v;
  }

  /** Ejecuta un paso de integración y devuelve la muestra nueva. */
  step(): PhysiologySample {
    this.clock.advance();
    const t = this.clock.t;
    const resp = this.respiratory.sample(t);
    const plExp = this.respiratory.pleuralAtEndExpiration();
    const pRa = this.rightAtrium.pressure(t, resp.pleuralMmHg, plExp);
    const out = this.network.step(this.clock.dt, this.arterialPulse(t), pRa, resp.abdominalMmHg);
    this.current = this.sampleFrom(out, t, resp, pRa);
    this.history.push(this.current);
    const tMin = t - this.historySeconds;
    while (this.history.length > 2 && this.history[0].t < tMin) this.history.shift();
    return this.current;
  }

  /** Avanza el número de pasos que corresponde a un intervalo de tiempo real. */
  advanceRealTime(elapsedSeconds: number): number {
    const n = this.clock.requestSteps(elapsedSeconds);
    for (let i = 0; i < n; i++) this.step();
    return n;
  }

  private sampleFrom(out: NetworkOutputs, t: number, resp?: RespiratorySample, pRa?: number): PhysiologySample {
    const r = resp ?? this.respiratory.sample(t);
    const plExp = this.respiratory.pleuralAtEndExpiration();
    const p = pRa ?? this.rightAtrium.pressure(t, r.pleuralMmHg, plExp);
    const beat = this.rhythm.currentBeat(t);
    // Sección elíptica de la VCI: más aplanada (AP < lateral) a baja presión
    // transmural; tiende a circular al distenderse (B.2, [EXTRAPOLACIÓN PROPIA]).
    const flatness = 0.2 * (1 - sigmoid((out.pIvcTransmural - 4) / 3));
    const dEq = out.ivcDiameterEqMm;
    const dAp = dEq * (1 - flatness);
    const dLat = dEq / (1 - flatness);
    // Dilatación de las suprahepáticas con la presión hepática: A ∝ 1 + 0,12·(P − 7) →
    // radio ×0,95 a 6 mmHg (sano) y ×1,6 a 19 mmHg (plétora de la congestión grave, con
    // diámetros de 12–15 mm en el curso medio, B.2) [EXTRAPOLACIÓN PROPIA].
    const hvRadiusScale = Math.max(0.5, Math.sqrt(1 + 0.12 * (out.pHepatic - 7)));
    const pvRadiusScale = Math.max(0.7, Math.sqrt(1 + 0.02 * (out.pSplanchnic - 9)));
    const velocities = {} as Record<VesselId, number>;
    const qHv = out.qHepaticVein;
    const qPv = out.qPortal;
    for (const id of VESSEL_IDS) {
      let q: number;
      let areaScale = 1;
      switch (id) {
        case 'ivcSupra':
          q = out.qIvcToRa + qHv;
          areaScale = out.ivcAreaMm2 / this.areas.ivcSupra;
          break;
        case 'ivcInfra':
          q = out.qLowerBody;
          areaScale = out.ivcAreaMm2 / this.areas.ivcInfra;
          break;
        case 'hvRight':
        case 'hvRightAnterior':
        case 'hvRightPosterior':
        case 'hvMiddle':
        case 'hvMiddleTributary':
        case 'hvLeft':
        case 'hvLeftTributary':
        case 'hvCommonTrunk':
          q = qHv * HV_FLOW_SHARE[id];
          areaScale = hvRadiusScale * hvRadiusScale;
          break;
        case 'pvTrunk':
        case 'pvRight':
        case 'pvRightAnterior':
        case 'pvRightPosterior':
        case 'pvLeft':
        case 'pvLeftLateral':
        case 'pvLeftMedial':
          q = qPv * PV_FLOW_SHARE[id];
          areaScale = pvRadiusScale * pvRadiusScale;
          break;
        case 'hepaticArtery':
          q = out.qHepaticArtery;
          break;
        case 'aorta':
          // Aorta: caudal descendente ilustrativo (no forma parte de VExUS).
          q = 60 + 90 * this.arterialPulse(t);
          break;
        case 'renalArteryRight':
        case 'renalArteryLeft':
          q = 0.5 * out.qRenalArtery;
          break;
        case 'renalVeinRight':
        case 'renalVeinLeft':
          q = 0.5 * out.qRenalVein;
          break;
        case 'interlobarArtery1':
        case 'interlobarArtery2':
        case 'interlobarArtery3':
          q = 0.5 * out.qRenalArtery * INTERLOBAR_FLOW_SHARE;
          break;
        case 'interlobarVein1':
        case 'interlobarVein2':
        case 'interlobarVein3':
          q = 0.5 * out.qRenalVein * INTERLOBAR_FLOW_SHARE;
          break;
      }
      const areaMm2 = this.areas[id] * areaScale;
      // Q en mL/s = 1000 mm³/s; u = Q/A en mm/s.
      velocities[id] = (q * 1000) / Math.max(1, areaMm2);
    }
    return {
      t,
      ecgMv: this.rhythm.ecg(t),
      cardiacPhase: this.rhythm.cardiacPhase(t),
      beatIndex: beat.index,
      lastR: beat.tR,
      rr: beat.rr,
      resp: r,
      pRa: p,
      pIvc: out.pIvc,
      pIvcTransmural: out.pIvcTransmural,
      pHepatic: out.pHepatic,
      pSplanchnic: out.pSplanchnic,
      pAbd: r.abdominalMmHg,
      pPleural: r.pleuralMmHg,
      qHepaticVein: qHv,
      qPortal: qPv,
      qHepaticArtery: out.qHepaticArtery,
      qIvcToRa: out.qIvcToRa,
      qLowerBody: out.qLowerBody,
      pRenal: out.pRenal,
      qRenalArtery: out.qRenalArtery,
      qRenalVein: out.qRenalVein,
      ivc: { dEqMm: dEq, dApMm: dAp, dLatMm: dLat },
      hvRadiusScale,
      pvRadiusScale,
      velocities,
    };
  }
}
