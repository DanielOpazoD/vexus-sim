import type { PatientState } from './patientState';
import { peepPleuralShiftMmHg } from './respiratory';
import { ivcDiameterFromPtm, type VenousNetwork } from './venousNetwork';

/**
 * Aurícula derecha de lazo cerrado en la media (decisión 79). La PAD media de fin de espiración sale del cruce
 * de dos curvas (Guyton):
 *
 *   retorno venoso  RV(PAD) = (Pmsf − PAD) / R_RV        Pmsf = Pmsf₀ + ΔV / C
 *   función del VD  GC(PAD) = f_A · GC_S(PAD − P_pl)      (Frank–Starling sobre la presión transmural)
 *
 * La curva de retorno venoso sale de la red (`venousNetwork.ts`) en el punto de trabajo del caso: Pmsf₀ es la
 * media de las presiones de sus compartimentos ponderada por su distensibilidad (la presión a la que se
 * igualarían sin flujo) y R_RV = (Pmsf₀ − PAD₀)/GC₀. La curva de Starling pasa por el punto del caso (su PAD y
 * el caudal de la red) con la pendiente que dan la función del VD, la regurgitación y el llenado. Sin
 * intervenciones el lazo devuelve exactamente la PAD del caso: los casos calibrados no cambian.
 *
 * Las intervenciones mueven el estado: el volumen estresado (bolo, diurético) desplaza la curva de retorno
 * venoso; la PEEP sube la presión pleural (desplaza la curva de Starling a la derecha) y la poscarga del VD
 * (la deprime). La forma de onda (a/c/x/v/y y la onda sistólica de la IT) sigue siendo la calibrada de
 * `rightAtrium.ts`; su rigidez auricular y la regurgitación siguen al llenado por volumen (`atrialLoad`).
 * Unidades: mmHg, mL, s. Parámetros [EXTRAPOLACIÓN PROPIA] / NEEDS_CALIBRATION.
 */

/** Distensibilidad arterial sistémica (mL/mmHg) del compartimento que la red no modela [EXTRAPOLACIÓN PROPIA]. */
export const ARTERIAL_COMPLIANCE_ML_PER_MMHG = 1.5;

/**
 * Ganancia de Frank–Starling (mL por latido): pendiente del volumen latido frente al llenado transmural,
 * dVL/dPtm = G·fVD·(1 − 0,7·IT)/(Ptm + 2). Con 61 mL el sano (FC 70, fVD 0,85, Ptm 8,7) sube el gasto
 * 5,5 mL/s por mmHg (0,33 L/min/mmHg: ~ +10 % con los ~300 mL de la elevación pasiva de piernas) y responde a
 * 500 mL con +18 %; la congestión grave (fVD 0,3, IT 0,7, Ptm 21,7) está en la meseta (+3 %) [EXTRAPOLACIÓN PROPIA].
 */
export const STARLING_GAIN_ML = 61;
/** Presión de la curva de distensibilidad diastólica del VD (dV/dP ∝ 1/(P + 2)), mmHg. */
const STARLING_PRESSURE_OFFSET = 2;
/** Fracción regurgitante por unidad de IT (IT 0,7 → 49 % del volumen latido vuelve a la aurícula). */
const REGURGITANT_FRACTION_PER_TR = 0.7;

/**
 * Poscarga del VD con la PEEP: la insuflación sube la resistencia vascular pulmonar un 1,5 % por cmH₂O
 * (+15 % con 10) [EXTRAPOLACIÓN PROPIA]. El volumen latido cae como (Ea/Ea₀)^(−1/(1 + Ees/Ea)), con el
 * acoplamiento VD–arteria pulmonar Ees/Ea = 2·fVD (1,7 en el sano, 0,6 en el VD que falla).
 */
export const PEEP_RV_AFTERLOAD_PER_CMH2O = 0.015;

/**
 * IT funcional dependiente de la carga: el orificio regurgitante sigue al anillo, que sigue al llenado del
 * corazón derecho por volumen, IT = IT₀·(Ptm_V/Ptm₀)³ (recortada a 1). El exponente 3 dice que el orificio crece
 * más deprisa que el anillo porque la reserva de coaptación de los velos se agota; con −500 mL la congestión
 * grave pasa de 0,7 a 0,37 (la IT funcional mejora al descongestionar, D.6). Con 2 quedaba en 0,45, justo en el
 * umbral de la S invertida, y el patrón cambiaba de una ventana de 8 s a otra [EXTRAPOLACIÓN PROPIA]. La PEEP no
 * la cambia: baja la precarga del VD pero sube su poscarga, y se supone que el tamaño del anillo no varía.
 */
export const TR_LOAD_EXPONENT = 3;

/**
 * Tiempo docente acelerado para los líquidos: 1 s simulado ≈ 30 s clínicos, para que un bolo o un diurético se
 * vean en 1–2 min de simulación. La PEEP y la respuesta de la red no se aceleran.
 */
export const FLUID_TIME_ACCELERATION = 30;
/** Bolo: constante de tiempo clínica de 5 min (≈ 95 % en 15 min) → 10 s simulados. */
export const BOLUS_TAU_S = (5 * 60) / FLUID_TIME_ACCELERATION;
/** Diurético o ultrafiltración: 20 min clínicos (≈ 95 % en 1 h) → 40 s simulados. */
export const DIURESIS_TAU_S = (20 * 60) / FLUID_TIME_ACCELERATION;
/** La PEEP llega a la pleura en una o dos respiraciones (s, sin acelerar). */
export const PEEP_TAU_S = 3;

/** Límites absolutos del volumen estresado añadido o retirado en total (mL). */
export const FLUID_LIMITS_ML = { min: -1000, max: 1500 } as const;
/**
 * Dominio de la PAD (mmHg) al que pueden llevar los líquidos: el que recorren las pruebas por propiedades
 * (`properties.test.ts`). La PAD no baja de 2 mmHg con ninguna PEEP de la intervención (por debajo la VCI se vacía sin
 * cascada torácica, `no-thoracic-waterfall`: el sano con −1000 mL llega a PAD ≈ 0 y a 3 m/s en la VCI) y el llenado,
 * la PAD con la PEEP del caso, no pasa de 30. El volumen que cabe se calcula por caso con las dos curvas
 * (`Circulation.fluidBounds`).
 */
export const FILLING_RAP_LIMITS_MMHG = { min: 2, max: 30 } as const;
/** PEEP admitida por la intervención (cmH₂O). */
export const PEEP_LIMITS_CMH2O = { min: 0, max: 20 } as const;

export type Intervention = { kind: 'bolus'; volumeMl: number } | { kind: 'diuresis'; volumeMl: number } | { kind: 'peep'; cmH2O: number };

/** Intervención aplicada: la pedida, recortada a los límites, con su instante de inicio. */
export type AppliedIntervention = Intervention & { t0: number };

/** Estado de un compartimento de la red en el punto de trabajo (para la curva de retorno venoso). */
export interface CompartmentPoint {
  name: string;
  /** Distensibilidad local (mL/mmHg). */
  complianceMlPerMmHg: number;
  /** Presión absoluta (mmHg). */
  pressureMmHg: number;
}

/** Punto de trabajo del caso medido en la red tras el calentamiento (fin de espiración, sin pulso). */
export interface CirculationBaseline {
  /** Retorno venoso a la AD = gasto del caso (mL/s). */
  cardiacOutputMlS: number;
  /** Presión arterial media de la red (mmHg). */
  arterialMeanMmHg: number;
  compartments: CompartmentPoint[];
}

/** Curva de Frank–Starling ajustada al caso: GC = GCmáx·(1 − e^(−(Ptm − P_off)/k)), nunca negativa. */
export interface StarlingCurve {
  coMaxMlS: number;
  kMmHg: number;
  offsetMmHg: number;
  /** Pendiente en el punto del caso (mL/s/mmHg). */
  slopeMlSPerMmHg: number;
}

/** Parámetros del lazo, fijos para el caso. */
export interface LoopParams {
  rap0: number;
  pleural0: number;
  peep0: number;
  co0: number;
  pArt0: number;
  /** Mean systemic filling pressure del caso (mmHg). */
  pmsf0: number;
  /** Resistencia al retorno venoso (mmHg·s/mL). */
  rvr: number;
  /** Distensibilidad sistémica total (mL/mmHg). */
  complianceMlPerMmHg: number;
  /** Resistencia arteria → AD de la red (mmHg·s/mL): la presión arterial sigue al gasto con ella constante. */
  svr: number;
  starling: StarlingCurve;
  /** Acoplamiento VD–arteria pulmonar Ees/Ea del caso. */
  coupling: number;
  tr0: number;
}

/** Estado del lazo en un instante. */
export interface LoopState {
  t: number;
  /** PAD media de fin de espiración (mmHg). */
  rapMeanMmHg: number;
  /** PAD que daría el volumen actual sin cambiar la PEEP: el llenado que siente el corazón derecho (mmHg). */
  fillingRapMmHg: number;
  /** Gasto del VD = retorno venoso (mL/s). */
  cardiacOutputMlS: number;
  pmsfMmHg: number;
  /** Presión arterial media que alimenta la red (mmHg). */
  arterialMeanMmHg: number;
  /** Volumen estresado añadido (+) o retirado (−) hasta ahora (mL). */
  fluidDeltaMl: number;
  /** Volumen total pedido por las intervenciones de líquidos (mL). */
  fluidTargetMl: number;
  /** PEEP vigente (cmH₂O) y la pedida. */
  peepCmH2O: number;
  peepTargetCmH2O: number;
  /** Subida de la presión pleural de fin de espiración respecto al caso (mmHg). */
  pleuralShiftMmHg: number;
  /** IT efectiva (0–1). */
  tricuspidRegurgitation: number;
}

/** Carga que ve la forma de onda auricular (`RightAtriumModel`). */
export interface AtrialLoad {
  /** PAD media de fin de espiración (mmHg). */
  rapMeanMmHg: number;
  /** PAD del llenado por volumen (rigidez auricular, mmHg). */
  fillingRapMmHg: number;
  tricuspidRegurgitation: number;
}

/** Distensibilidad de la VCI (mL/mmHg) a una presión transmural, derivando la ley de tubo. */
function ivcCompliance(net: VenousNetwork, ptm: number): number {
  const k = net.k;
  const vol = (p: number) => (Math.PI * ivcDiameterFromPtm(p, k) ** 2 * 0.25 * k.ivcLengthMm) / 1000;
  const h = 0.05;
  return (vol(ptm + h) - vol(ptm - h)) / (2 * h);
}

/**
 * Punto de trabajo de la red: caudal a la AD, presión arterial y, por compartimento, su distensibilidad local
 * (linealizada) y su presión absoluta. Se llama tras el calentamiento (régimen medio sin ondas).
 */
export function circulationBaseline(net: VenousNetwork, pAbd: number): CirculationBaseline {
  const k = net.k;
  const o = net.last;
  const pHepEl = o.pHepatic - pAbd;
  return {
    cardiacOutputMlS: o.qHepaticVein + o.qIvcToRa,
    arterialMeanMmHg: k.pArtMean,
    compartments: [
      { name: 'arterial', complianceMlPerMmHg: ARTERIAL_COMPLIANCE_ML_PER_MMHG, pressureMmHg: k.pArtMean },
      { name: 'esplácnico', complianceMlPerMmHg: k.cSplanchnic, pressureMmHg: o.pSplanchnic },
      {
        name: 'hígado',
        complianceMlPerMmHg: k.cHepatic * Math.exp(-(pHepEl - k.pRefHepatic) / k.kHepatic),
        pressureMmHg: o.pHepatic,
      },
      { name: 'cuerpo inferior', complianceMlPerMmHg: k.cLowerBody, pressureMmHg: o.pLowerBody },
      { name: 'VCI', complianceMlPerMmHg: ivcCompliance(net, o.pIvcTransmural), pressureMmHg: o.pIvc },
      { name: 'riñón', complianceMlPerMmHg: k.cRenal, pressureMmHg: o.pRenal },
    ],
  };
}

/** Pendiente de Frank–Starling en el punto del caso (mL/s/mmHg), ver `STARLING_GAIN_ML`. */
export function starlingSlope(p: PatientState, transmuralMmHg: number): number {
  const beatsPerS = p.heartRateBpm / 60;
  const forward = 1 - REGURGITANT_FRACTION_PER_TR * p.tricuspidRegurgitation;
  return (STARLING_GAIN_ML * beatsPerS * p.rvFunction * forward) / Math.max(1, transmuralMmHg + STARLING_PRESSURE_OFFSET);
}

/**
 * Ajusta GC = GCmáx·(1 − e^(−(Ptm − P_off)/k)) para que pase por (Ptm₀, GC₀) con pendiente S₀. Con P_off = 0 (sin
 * llenado no hay gasto) la pendiente relativa r = S₀·Ptm₀/GC₀ = x/(eˣ − 1), x = Ptm₀/k, decrece de 1 a 0: se
 * resuelve x por bisección. Una curva cóncava que pase por el origen exige r < 1: se recorta a 0,98 (casi recta).
 */
export function fitStarlingCurve(co0: number, transmural0: number, slope0: number): StarlingCurve {
  const offsetMmHg = Math.min(0, transmural0 - 2);
  const u0 = transmural0 - offsetMmHg;
  const r = Math.min(0.98, Math.max(1e-6, (slope0 * u0) / co0));
  const g = (x: number) => x / Math.expm1(x);
  let lo = 1e-9;
  let hi = 60;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    if (g(mid) > r) lo = mid;
    else hi = mid;
  }
  const x = 0.5 * (lo + hi);
  const kMmHg = u0 / x;
  const coMaxMlS = co0 / -Math.expm1(-x);
  return { coMaxMlS, kMmHg, offsetMmHg, slopeMlSPerMmHg: (coMaxMlS / kMmHg) * Math.exp(-x) };
}

export function starlingOutput(c: StarlingCurve, transmuralMmHg: number): number {
  return Math.max(0, -c.coMaxMlS * Math.expm1(-(transmuralMmHg - c.offsetMmHg) / c.kMmHg));
}

/** Factor del gasto por la poscarga que añade la PEEP (1 sin cambio de PEEP). */
export function afterloadFactor(coupling: number, peepDeltaCmH2O: number): number {
  const ea = Math.max(0.2, 1 + PEEP_RV_AFTERLOAD_PER_CMH2O * peepDeltaCmH2O);
  return ea ** (-1 / (1 + coupling));
}

/** Parámetros del lazo del caso a partir del paciente, su pleural de fin de espiración y el punto de trabajo de la red. */
export function loopParams(p: PatientState, pleural0: number, base: CirculationBaseline): LoopParams {
  let cSum = 0;
  let cp = 0;
  for (const c of base.compartments) {
    cSum += c.complianceMlPerMmHg;
    cp += c.complianceMlPerMmHg * c.pressureMmHg;
  }
  const rap0 = p.rapMeanMmHg;
  const co0 = Math.max(1e-3, base.cardiacOutputMlS);
  // Pmsf: la presión a la que se igualarían los compartimentos sin flujo (las presiones externas se cancelan).
  // Con PAD ≥ Pmsf la red no podría devolver caudal: suelo de R_RV 0,01 mmHg·s/mL (los casos dan 0,07–0,08) y
  // Pmsf₀ = PAD₀ + GC₀·R_RV, para que el cruce siga en el punto del caso
  const rvr = Math.max(0.01, (cp / cSum - rap0) / co0);
  const pmsf0 = rap0 + co0 * rvr;
  const transmural0 = rap0 - pleural0;
  return {
    rap0,
    pleural0,
    peep0: p.peepCmH2O,
    co0,
    pArt0: base.arterialMeanMmHg,
    pmsf0,
    rvr,
    complianceMlPerMmHg: cSum,
    svr: (base.arterialMeanMmHg - rap0) / co0,
    starling: fitStarlingCurve(co0, transmural0, starlingSlope(p, transmural0)),
    coupling: 2 * p.rvFunction,
    tr0: p.tricuspidRegurgitation,
  };
}

/**
 * Cruce de las dos curvas: PAD tal que (Pmsf − PAD)/R_RV = f_A·GC_S(PAD − P_pl). El retorno venoso baja y el gasto
 * sube con la PAD: raíz única, por bisección entre la PAD que anula el gasto (menos 1 mmHg) y Pmsf.
 */
export function solveEquilibrium(
  k: LoopParams,
  fluidDeltaMl: number,
  pleuralShiftMmHg: number,
  afterload: number,
): { rap: number; co: number; pmsf: number } {
  const pmsf = k.pmsf0 + fluidDeltaMl / k.complianceMlPerMmHg;
  const pl = k.pleural0 + pleuralShiftMmHg;
  const excess = (rap: number) => (pmsf - rap) / k.rvr - afterload * starlingOutput(k.starling, rap - pl);
  let lo = Math.min(pl + k.starling.offsetMmHg, pmsf) - 1;
  let hi = pmsf;
  for (let i = 0; i < 80 && hi - lo > 1e-10; i++) {
    const mid = 0.5 * (lo + hi);
    if (excess(mid) > 0) lo = mid;
    else hi = mid;
  }
  const rap = 0.5 * (lo + hi);
  return { rap, co: (pmsf - rap) / k.rvr, pmsf };
}

/** Ley de la IT funcional con el llenado por volumen (`TR_LOAD_EXPONENT`). */
export function loadDependentTr(k: LoopParams, fillingRap: number): number {
  const ratio = Math.max(1, fillingRap - k.pleural0) / Math.max(1, k.rap0 - k.pleural0);
  return Math.min(1, k.tr0 * ratio ** TR_LOAD_EXPONENT);
}

/**
 * Cinética de una clase de líquido (una constante de tiempo): lo pedido en total y lo que aún faltaba por llegar en
 * `tRef`. Las dosis de primer orden con la misma τ se suman en un solo acumulador (lo que falta decae como
 * e^(−(t − tRef)/τ)), así que el coste por paso no crece con los clics.
 */
interface FluidChannel {
  readonly tauS: number;
  targetMl: number;
  pendingMl: number;
  tRef: number;
}

const pendingAt = (c: FluidChannel, t: number): number =>
  c.pendingMl === 0 ? 0 : c.pendingMl * Math.exp(-Math.max(0, t - c.tRef) / c.tauS);

/**
 * Circulación de lazo cerrado del motor: guarda las intervenciones (líquidos con su cinética de primer orden y los
 * cambios de PEEP) y calcula el estado del lazo en cada paso. Determinista: el estado es una función del tiempo y de
 * las intervenciones.
 */
export class Circulation {
  private params: LoopParams | null = null;
  /** Volumen estresado admitido del caso (se calcula al calibrar). */
  private bounds = { min: 0, max: 0 };
  /** Bolos (τ corta) y diuréticos (τ larga): un acumulador por constante de tiempo. */
  private readonly bolus: FluidChannel = { tauS: BOLUS_TAU_S, targetMl: 0, pendingMl: 0, tRef: 0 };
  private readonly diuresis: FluidChannel = { tauS: DIURESIS_TAU_S, targetMl: 0, pendingMl: 0, tRef: 0 };
  private peepChange: { t0: number; from: number; to: number } | null = null;
  private readonly applied: AppliedIntervention[] = [];
  private current: LoopState;

  constructor(
    private readonly patient: PatientState,
    private readonly pleural0: number,
  ) {
    this.current = this.baselineState(0);
  }

  /** Fija el punto de trabajo con la red ya calentada; hasta entonces el lazo devuelve el caso. */
  calibrate(base: CirculationBaseline): void {
    const k = loopParams(this.patient, this.pleural0, base);
    this.params = k;
    // volumen que deja la PAD en `rap` con una PEEP dada, por las dos curvas: Pmsf = PAD + R_RV·f_A·GC_S(PAD − P_pl)
    const dvAt = (rap: number, peep: number) => {
      const pl = k.pleural0 + peepPleuralShiftMmHg(peep) - peepPleuralShiftMmHg(k.peep0);
      const fA = afterloadFactor(k.coupling, peep - k.peep0);
      return (rap + k.rvr * fA * starlingOutput(k.starling, rap - pl) - k.pmsf0) * k.complianceMlPerMmHg;
    };
    this.bounds = {
      // la PAD más baja con un volumen dado es la de la PEEP más baja que admite la intervención: con ella, 2 mmHg
      min: Math.max(FLUID_LIMITS_ML.min, Math.min(0, dvAt(FILLING_RAP_LIMITS_MMHG.min, PEEP_LIMITS_CMH2O.min))),
      // y el llenado (la PAD con la PEEP del caso) no pasa de 30 mmHg
      max: Math.min(FLUID_LIMITS_ML.max, Math.max(0, dvAt(FILLING_RAP_LIMITS_MMHG.max, k.peep0))),
    };
    this.current = this.baselineState(this.current.t);
  }

  get loop(): LoopParams {
    if (!this.params) throw new Error('Circulation.calibrate no se ha llamado');
    return this.params;
  }

  get state(): LoopState {
    return this.current;
  }

  get interventions(): readonly AppliedIntervention[] {
    return this.applied;
  }

  get atrialLoad(): AtrialLoad {
    const s = this.current;
    return { rapMeanMmHg: s.rapMeanMmHg, fillingRapMmHg: s.fillingRapMmHg, tricuspidRegurgitation: s.tricuspidRegurgitation };
  }

  /**
   * Volumen estresado admitido (mL) por las dos curvas: el que deja la PAD en 2 mmHg con la PEEP más baja de la
   * intervención y el que lleva el llenado a 30 mmHg (`FILLING_RAP_LIMITS_MMHG`), dentro de `FLUID_LIMITS_ML` y sin
   * cruzar el caso.
   */
  fluidBounds(): { min: number; max: number } {
    return { ...this.bounds };
  }

  /**
   * Volumen que aún admiten los límites en ese sentido (mL, ≥ 0) en el peor caso: lo ya llegado más todo lo que aún
   * falta en ese sentido (un bolo rápido puede llegar antes que un diurético lento). Así el volumen en curso nunca
   * sale de `fluidBounds`, por muchos clics alternos que se den.
   */
  fluidRoom(sign: 1 | -1, t = this.current.t): number {
    const now = this.fluidAt(t);
    if (sign > 0) return Math.max(0, this.bounds.max - (now + pendingAt(this.bolus, t)));
    return Math.max(0, now + pendingAt(this.diuresis, t) - this.bounds.min);
  }

  /**
   * Aplica una intervención en `t`. Los líquidos se recortan a lo que admiten los límites (devuelve null si ya no cabe
   * nada); una PEEP fuera de [0, 20] cmH₂O o un volumen no positivo lanzan.
   */
  intervene(i: Intervention, t: number): AppliedIntervention | null {
    if (i.kind === 'peep') {
      if (!(i.cmH2O >= PEEP_LIMITS_CMH2O.min && i.cmH2O <= PEEP_LIMITS_CMH2O.max)) {
        throw new RangeError(`PEEP ${i.cmH2O} cmH₂O fuera de [${PEEP_LIMITS_CMH2O.min}, ${PEEP_LIMITS_CMH2O.max}]`);
      }
      this.peepChange = { t0: t, from: this.peepAt(t), to: i.cmH2O };
      return this.record({ kind: 'peep', cmH2O: i.cmH2O, t0: t });
    }
    if (!(i.volumeMl > 0) || !Number.isFinite(i.volumeMl)) throw new RangeError(`volumen ${i.volumeMl} mL: debe ser positivo`);
    const sign = i.kind === 'bolus' ? 1 : -1;
    const volumeMl = Math.min(i.volumeMl, this.fluidRoom(sign, t));
    if (!(volumeMl > 1e-9)) return null;
    const ch = i.kind === 'bolus' ? this.bolus : this.diuresis;
    ch.pendingMl = pendingAt(ch, t) + sign * volumeMl;
    ch.tRef = t;
    ch.targetMl += sign * volumeMl;
    return this.record({ kind: i.kind, volumeMl, t0: t });
  }

  /** Anota la intervención y deja ya en el estado lo pedido (el efecto llega con los pasos siguientes). */
  private record(applied: AppliedIntervention): AppliedIntervention {
    this.applied.push(applied);
    this.current = { ...this.current, fluidTargetMl: this.fluidTarget(), peepTargetCmH2O: this.peepChange?.to ?? this.patient.peepCmH2O };
    return applied;
  }

  /** Estado del lazo en `t` (lo llama el motor una vez por paso, con t creciente). */
  update(t: number): LoopState {
    if (!this.params || (this.bolus.targetMl === 0 && this.diuresis.targetMl === 0 && this.peepChange === null)) {
      this.current = this.baselineState(t);
      return this.current;
    }
    const k = this.params;
    const fluidDeltaMl = this.fluidAt(t);
    const peep = this.peepAt(t);
    const peepDelta = peep - k.peep0;
    const pleuralShiftMmHg = peepPleuralShiftMmHg(peep) - peepPleuralShiftMmHg(k.peep0);
    const eq = solveEquilibrium(k, fluidDeltaMl, pleuralShiftMmHg, afterloadFactor(k.coupling, peepDelta));
    // el llenado por volumen: el mismo volumen con la PEEP del caso (sin cambio de PEEP es la misma raíz)
    const fillingRapMmHg = peepDelta === 0 ? eq.rap : fluidDeltaMl === 0 ? k.rap0 : solveEquilibrium(k, fluidDeltaMl, 0, 1).rap;
    this.current = {
      t,
      rapMeanMmHg: eq.rap,
      fillingRapMmHg,
      cardiacOutputMlS: eq.co,
      pmsfMmHg: eq.pmsf,
      arterialMeanMmHg: k.pArt0 + (eq.rap - k.rap0) + (eq.co - k.co0) * k.svr,
      fluidDeltaMl,
      fluidTargetMl: this.fluidTarget(),
      peepCmH2O: peep,
      peepTargetCmH2O: this.peepChange?.to ?? k.peep0,
      pleuralShiftMmHg,
      tricuspidRegurgitation: loadDependentTr(k, fillingRapMmHg),
    };
    return this.current;
  }

  private fluidTarget(): number {
    return this.bolus.targetMl + this.diuresis.targetMl;
  }

  /** Volumen llegado en `t`: lo pedido menos lo que aún falta, en los dos acumuladores. */
  private fluidAt(t: number): number {
    const v = this.bolus.targetMl - pendingAt(this.bolus, t) + (this.diuresis.targetMl - pendingAt(this.diuresis, t));
    // con `fluidRoom` en el peor caso nunca sale de los límites; el recorte solo quita el redondeo
    return Math.min(this.bounds.max, Math.max(this.bounds.min, v));
  }

  private peepAt(t: number): number {
    const c = this.peepChange;
    if (!c) return this.patient.peepCmH2O;
    if (!(t > c.t0)) return c.from;
    return c.to + (c.from - c.to) * Math.exp(-(t - c.t0) / PEEP_TAU_S);
  }

  /** El caso tal cual: la PAD declarada, su IT y su PEEP; la presión arterial de la red. */
  private baselineState(t: number): LoopState {
    const p = this.patient;
    const k = this.params;
    return {
      t,
      rapMeanMmHg: p.rapMeanMmHg,
      fillingRapMmHg: p.rapMeanMmHg,
      cardiacOutputMlS: k?.co0 ?? Number.NaN,
      pmsfMmHg: k?.pmsf0 ?? Number.NaN,
      arterialMeanMmHg: k?.pArt0 ?? Number.NaN,
      fluidDeltaMl: 0,
      fluidTargetMl: 0,
      peepCmH2O: p.peepCmH2O,
      peepTargetCmH2O: p.peepCmH2O,
      pleuralShiftMmHg: 0,
      tricuspidRegurgitation: p.tricuspidRegurgitation,
    };
  }
}
