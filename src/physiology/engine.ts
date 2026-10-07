import { SimulationClock } from '../core/clock';
import { supraIvcAreaMm2, supraIvcSection } from './supraIvc';
import { Circulation, circulationBaseline, type AppliedIntervention, type Intervention } from './circulation';
import type { PatientState } from './patientState';
import { validatePatient } from './patientState';
import { RespiratoryModel, type RespiratorySample } from './respiratory';
import { RhythmGenerator, gauss } from './rhythm';
import { RightAtriumModel } from './rightAtrium';
import { VenousNetwork, defaultNetworkParams, hvRadiusScaleFromPressure, ivcPtmFromDiameter, type NetworkOutputs } from './venousNetwork';
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
  /** Abdominal cava: the segment measured by the VExUS protocol. */
  ivc: { dEqMm: number; dApMm: number; dLatMm: number };
  /** Junction/atrial entrance. Optional only for older synthetic test fixtures. */
  ivcSupra?: { dEqMm: number; dApMm: number; dLatMm: number };
  /** Escala de radio de las suprahepáticas respecto al basal (≥ 0,5). */
  hvRadiusScale: number;
  pvRadiusScale: number;
  /** Velocidad media espacial u = Q/A por vaso, mm/s, sentido fisiológico positivo. */
  velocities: Record<VesselId, number>;
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** El estado fisiológico dejó de ser finito: nada aguas abajo (GPU, espectro, medición) puede confiar en él. */
export class NonFiniteStateError extends Error {
  constructor(
    readonly fields: string[],
    readonly t: number,
  ) {
    super(`estado fisiológico no finito en t = ${t.toFixed(3)} s: ${fields.join(', ')}`);
    this.name = 'NonFiniteStateError';
  }
}

/** Campos numéricos no finitos de una muestra (vacío si todo es finito). */
export function nonFiniteFields(s: PhysiologySample): string[] {
  const bad: string[] = [];
  const check = (name: string, v: number) => {
    if (!Number.isFinite(v)) bad.push(name);
  };
  for (const [k, v] of Object.entries(s)) if (typeof v === 'number') check(k, v);
  for (const [k, v] of Object.entries(s.ivc)) check(`ivc.${k}`, v);
  if (s.ivcSupra) for (const [k, v] of Object.entries(s.ivcSupra)) check(`ivcSupra.${k}`, v);
  for (const [k, v] of Object.entries(s.resp)) if (typeof v === 'number') check(`resp.${k}`, v);
  for (const [k, v] of Object.entries(s.velocities)) check(`velocities.${k}`, v);
  return bad;
}

/**
 * Constante de tiempo de la pared de la VCI (s, decisión 73): la pared venosa es viscoelástica (Voigt, η/E) y su
 * posición sigue al diámetro de equilibrio elástico del volumen con este retraso, así que las ondas cardíacas (1–4 Hz)
 * mueven la pared mucho menos que la respiración (0,2–0,3 Hz) [EXTRAPOLACIÓN PROPIA].
 */
export const IVC_WALL_TAU_S = 0.2;

export class PhysiologyEngine {
  readonly clock: SimulationClock;
  readonly patient: PatientState;
  readonly rhythm: RhythmGenerator;
  readonly respiratory: RespiratoryModel;
  readonly rightAtrium: RightAtriumModel;
  /** Lazo cerrado de la media (decisión 79): PAD, gasto e intervenciones. */
  readonly circulation: Circulation;
  readonly network: VenousNetwork;
  readonly areas: VesselAreas;
  /** Historial reciente (para ECG, mediciones y clasificación). */
  private history: PhysiologySample[] = [];
  private historySeconds: number;
  private current: PhysiologySample;
  /** Área de la luz de la VCI que marca su pared (mm²): sigue a la del volumen con la constante de la pared (decisión 73). */
  private ivcWallAreaMm2: number;
  private ivcSupraWallAreaMm2: number;
  /** Pmsf del lazo en el paso anterior: su cambio es el volumen que entra o sale de la red (decisión 79). */
  private lastPmsf: number;

  constructor(patient: PatientState, areas: VesselAreas, opts: { dt?: number; historySeconds?: number } = {}) {
    validatePatient(patient);
    this.patient = patient;
    this.areas = areas;
    this.clock = new SimulationClock(opts.dt ?? 0.004);
    this.historySeconds = opts.historySeconds ?? 12;
    this.rhythm = new RhythmGenerator(patient, patient.seed ^ 0x51a7);
    this.respiratory = new RespiratoryModel(patient);
    this.circulation = new Circulation(patient, this.respiratory.pleuralAtEndExpiration());
    this.rightAtrium = new RightAtriumModel(patient, this.rhythm, () => this.circulation.atrialLoad);
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
    // punto de trabajo del lazo: la red ya en su régimen medio (fin de espiración, sin ondas)
    this.circulation.calibrate(circulationBaseline(this.network, pAbd0));
    this.lastPmsf = this.circulation.state.pmsfMmHg;
    this.ivcWallAreaMm2 = this.network.last.ivcAreaMm2;
    this.ivcSupraWallAreaMm2 = supraIvcAreaMm2(this.network.last.pJunction - this.respiratory.pleuralAtEndExpiration());
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

  /**
   * Pulso de la mesentérica superior en ayunas (decisión 69, revisión): lecho de alta resistencia, trifásico, con el pico
   * sistólico, un reflujo protodiastólico breve (≈ 0,1 s, hasta −0,25 del pico) y un flujo telediastólico bajo (≈ 0,12 del
   * pico, con la cola del latido siguiente): IR ≈ 0,88 (normal en ayunas 0,85–0,9; tras comer baja a ~0,7 y el reflujo
   * desaparece). En unidades del pico; la forma escala con el RR como la de `arterialPulse`.
   */
  private mesentericFastingPulse(t: number): number {
    let v = 0.07;
    for (const b of this.rhythm.beatsAround(t)) {
      const s = Math.sqrt(b.rr / 0.8);
      const tau = t - b.tR;
      v += 0.93 * gauss(tau - 0.12 * s, 0.05 * s) - 0.32 * gauss(tau - 0.28 * s, 0.035 * s);
    }
    return v;
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

  /**
   * Intervención docente (decisión 79) desde el instante actual: bolo o diurético (volumen estresado, con la
   * cinética acelerada de `circulation.ts`) o PEEP. Devuelve lo aplicado (los líquidos se recortan al límite
   * acumulado; null si ya no cabe nada).
   */
  intervene(i: Intervention): AppliedIntervention | null {
    return this.circulation.intervene(i, this.clock.t);
  }

  /** Ejecuta un paso de integración y devuelve la muestra nueva. */
  step(): PhysiologySample {
    this.clock.advance();
    const t = this.clock.t;
    const loop = this.circulation.update(t);
    // el volumen de un bolo o de un diurético entra o sale de los compartimentos de la red, no solo por sus bordes: sin
    // esto la red se llenaba desde la arteria en tiempo real mientras la PAD subía al ritmo acelerado, y sus caudales
    // iban 10–40 s al revés que el gasto del lazo (−13 % de retorno venoso tras 500 mL en el sano)
    const dPmsf = loop.pmsfMmHg - this.lastPmsf;
    this.lastPmsf = loop.pmsfMmHg;
    if (dPmsf !== 0) this.network.shiftVenousPressures(dPmsf);
    this.respiratory.peepCmH2O = loop.peepCmH2O;
    const resp = this.respiratory.sample(t);
    const plExp = this.respiratory.pleuralAtEndExpiration();
    const pRa = this.rightAtrium.pressure(t, resp.pleuralMmHg, plExp);
    const out = this.network.step(this.clock.dt, this.arterialPulse(t), pRa, resp.abdominalMmHg, loop.arterialMeanMmHg);
    this.ivcWallAreaMm2 += (out.ivcAreaMm2 - this.ivcWallAreaMm2) * (1 - Math.exp(-this.clock.dt / IVC_WALL_TAU_S));
    const supraArea = supraIvcAreaMm2(out.pJunction - resp.pleuralMmHg);
    this.ivcSupraWallAreaMm2 += (supraArea - this.ivcSupraWallAreaMm2) * (1 - Math.exp(-this.clock.dt / IVC_WALL_TAU_S));
    const next = this.sampleFrom(out, t, resp, pRa);
    // Guardia NaN: un estado no finito se detiene aquí, con los campos culpables, en vez
    // de viajar en silencio a la GPU, al espectro y a la medición.
    const bad = nonFiniteFields(next);
    if (bad.length > 0) throw new NonFiniteStateError(bad, t);
    this.current = next;
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
    const dEq = 2 * Math.sqrt(this.ivcWallAreaMm2 / Math.PI);
    const flatness = 0.2 * (1 - sigmoid((ivcPtmFromDiameter(dEq, this.network.k) - 4) / 3));
    const dAp = dEq * (1 - flatness);
    const dLat = dEq / (1 - flatness);
    // Dilatación de las suprahepáticas con la presión hepática: A ∝ 1 + 0,12·(P − 7) →
    // radio ×0,95 a 6 mmHg (sano) y ×1,6 a 19 mmHg (plétora de la congestión grave, con
    // diámetros de 12–15 mm en el curso medio, B.2) [EXTRAPOLACIÓN PROPIA].
    const hvRadiusScale = hvRadiusScaleFromPressure(out.pHepatic);
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
          areaScale = this.ivcSupraWallAreaMm2 / this.areas.ivcSupra;
          break;
        case 'ivcInfra':
          q = out.qLowerBody;
          areaScale = this.ivcWallAreaMm2 / this.areas.ivcInfra;
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
        // Ramas viscerales (decisión 69, ilustrativas): celíaco ≈ 0,6 L/min y esplénica ≈ 0,3, con el pulso de baja
        // resistencia de la hepática; AMS en ayunas ≈ 0,25 L/min con el suyo, trifásico de alta resistencia (pico ≈ 1,5 m/s en
        // el eje)
        case 'celiacTrunk':
          q = 10 * (1 + 1.1 * this.arterialPulse(t));
          break;
        case 'splenicArtery':
          q = 5 * (1 + 1.1 * this.arterialPulse(t));
          break;
        case 'commonHepaticArtery':
          q = 3.2 * (1 + 1.1 * this.arterialPulse(t));
          break;
        case 'leftGastricArtery':
          q = 1.8 * (1 + 1.1 * this.arterialPulse(t));
          break;
        case 'ima':
          q = 5 * this.mesentericFastingPulse(t);
          break;
        case 'iliacArteryRight':
        case 'iliacArteryLeft':
          q = (60 + 90 * this.arterialPulse(t)) * 0.14;
          break;
        case 'internalIliacArteryRight':
        case 'internalIliacArteryLeft':
          q = (60 + 90 * this.arterialPulse(t)) * 0.04;
          break;
        case 'externalIliacArteryRight':
        case 'externalIliacArteryLeft':
          q = (60 + 90 * this.arterialPulse(t)) * 0.1;
          break;
        case 'iliacVeinRight':
        case 'iliacVeinLeft':
          q = out.qLowerBody * 0.25;
          break;
        case 'internalIliacVeinRight':
        case 'internalIliacVeinLeft':
          q = out.qLowerBody * 0.1;
          break;
        case 'externalIliacVeinRight':
        case 'externalIliacVeinLeft':
          q = out.qLowerBody * 0.15;
          break;
        case 'portalSmv':
        case 'portalSplenic':
          q = qPv * (id === 'portalSmv' ? 0.7 : 0.3);
          areaScale = pvRadiusScale * pvRadiusScale;
          break;
        case 'sma':
          q = 22 * this.mesentericFastingPulse(t);
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
      ivcSupra: supraIvcSection(this.ivcSupraWallAreaMm2),
      hvRadiusScale,
      pvRadiusScale,
      velocities,
    };
  }
}
