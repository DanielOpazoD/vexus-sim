import type { PatientState } from './patientState';

/**
 * Red venosa de parámetros concentrados (base D.7, «red mínima propuesta»):
 *
 *   arteria → esplácnico (C_sp) → porta (R_pv) → sinusoides (C_h) → suprahepáticas
 *   (R_hv, L_hv) → unión cavoauricular (nodo resistivo R_j, sin volumen) → AD
 *   arteria → arteria hepática (R_ha) → sinusoides
 *   arteria → cuerpo inferior (C_lb) → VCI abdominal (ley de tubo, P_ext = P_abd)
 *   → (R_ivc, L_ivc) → unión cavoauricular
 *   arteria → arteria renal (R_ra) → lecho renal (C_k, ambos riñones) → vena renal
 *   (R_rv, L_rv) → VCI abdominal
 *
 * El lecho renal es un órgano encapsulado de baja distensibilidad: la presión de
 * la cava se transmite casi sin amortiguar a la vena interlobar, de donde salen
 * los patrones continuo / bifásico / monofásico del VExUS (D.9) sin regla alguna.
 *
 * Las suprahepáticas desembocan a 1–2 cm de la aurícula (B.2): su presión de
 * salida es prácticamente la auricular, sin el amortiguamiento del tramo
 * abdominal de la cava, que sí se modela como compartimento distensible.
 *
 *   dV_i/dt = ΣQ_entrada − ΣQ_salida ;  P_i = P_ext,i + P_el,i(V_i)
 *   L·dQ/dt = ΔP − R·Q   (ramas con inercia)
 *
 * Nada aquí sabe qué es «VExUS». Las velocidades salen de Q/A (invariante 10.1)
 * con las áreas geométricas del caso. Unidades: mmHg, mL, s.
 * Parámetros: [EXTRAPOLACIÓN PROPIA] / NEEDS_CALIBRATION, ajustados con
 * tools/calibrate.ts para que el avatar basal reproduzca los anclajes de D.4.
 */
export interface NetworkParams {
  /** Presión arterial media (constante del modelo). */
  pArtMean: number;
  /** Amplitud pulsátil arterial (para arteria hepática). */
  pArtPulse: number;
  rArtSplanchnic: number;
  cSplanchnic: number;
  v0Splanchnic: number;
  rPortal: number;
  rHepaticArtery: number;
  /** Distensibilidad sinusoidal a presión elástica de referencia (mL/mmHg). */
  cHepatic: number;
  /** Presión elástica de referencia (mmHg) y constante de rigidización (mmHg). */
  pRefHepatic: number;
  kHepatic: number;
  v0Hepatic: number;
  rHepaticVein: number;
  lHepaticVein: number;
  rArtLowerBody: number;
  cLowerBody: number;
  v0LowerBody: number;
  rLowerBody: number;
  /** Segmento de VCI modelado (mm). */
  ivcLengthMm: number;
  ivcDmaxMm: number;
  ivcP0: number;
  ivcW: number;
  /** Distensibilidad residual en la rama saturada (mm/mmHg). */
  ivcResidual: number;
  rIvcToRa: number;
  lIvcToRa: number;
  /** Resistencia del nodo de unión cavoauricular (sin volumen). */
  rJunction: number;
  /** Lecho renal (ambos riñones): resistencia arterial, distensibilidad, salida venosa. */
  rRenalArtery: number;
  cRenal: number;
  v0Renal: number;
  rRenalVein: number;
  lRenalVein: number;
}

export function defaultNetworkParams(p: PatientState): NetworkParams {
  const sv = p.stressedVolume;
  return {
    pArtMean: 90,
    pArtPulse: 18,
    rArtSplanchnic: 4.8 / sv,
    cSplanchnic: 40,
    v0Splanchnic: 0,
    rPortal: 0.2 * p.liver.sinusoidalResistance,
    rHepaticArtery: 16,
    cHepatic: 12 * p.liver.compliance,
    pRefHepatic: 1,
    kHepatic: 12,
    v0Hepatic: 0,
    rHepaticVein: 0.06,
    lHepaticVein: 0.004,
    rArtLowerBody: 2.4 / sv,
    cLowerBody: 60,
    v0LowerBody: 0,
    rLowerBody: 0.08,
    ivcLengthMm: 150,
    ivcDmaxMm: 30,
    ivcP0: 0.0,
    ivcW: 3.0,
    ivcResidual: 0.1,
    rIvcToRa: 0.03,
    lIvcToRa: 0.0015,
    rJunction: 0.01,
    // Flujo renal total ≈ 1,2 L/min (20 mL/s) con P_art − P_k ≈ 75 mmHg → R ≈ 3,75;
    // C_k y R_rv (τ ≈ 0,45 s) ajustadas para que el sano sea «continuo» (mín/máx ≈ 0,4)
    // y la congestión grave «monofásica» sin reglas (tools/calibrate.ts) [EXTRAPOLACIÓN PROPIA]
    rRenalArtery: 3.75,
    cRenal: 4.5,
    v0Renal: 0,
    rRenalVein: 0.1,
    lRenalVein: 0.002,
  };
}

export interface NetworkState {
  vSplanchnic: number;
  vHepatic: number;
  vLowerBody: number;
  vIvc: number;
  qHepaticVein: number;
  qIvcToRa: number;
  vRenal: number;
  qRenalVein: number;
}

export interface NetworkOutputs {
  pSplanchnic: number;
  pHepatic: number;
  pLowerBody: number;
  pIvc: number;
  pIvcTransmural: number;
  qPortal: number;
  qHepaticArtery: number;
  qHepaticVein: number;
  qLowerBody: number;
  qIvcToRa: number;
  /** Presión en la unión cavoauricular (salida de las suprahepáticas). */
  pJunction: number;
  ivcDiameterEqMm: number;
  ivcAreaMm2: number;
  /** Lecho renal (ambos riñones): presión venosa intrarrenal y caudales totales. */
  pRenal: number;
  qRenalArtery: number;
  qRenalVein: number;
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
const logit = (y: number): number => Math.log(y / (1 - y));

/**
 * Compartimento sinusoidal con rigidización: dV/dP = C0·exp(−(P−Pref)/k), es
 * decir V(P) = V0 + C0·k·(1 − exp(−(P−Pref)/k)). Un hígado congestivo distendido
 * transmite más la presión (D.7, «amortiguación portal»); no es un ajuste por caso.
 */
export function hepaticVolumeFromPressure(pEl: number, k: NetworkParams): number {
  return k.v0Hepatic + k.cHepatic * k.kHepatic * (1 - Math.exp(-(pEl - k.pRefHepatic) / k.kHepatic));
}

export function hepaticPressureFromVolume(v: number, k: NetworkParams): number {
  const x = (v - k.v0Hepatic) / (k.cHepatic * k.kHepatic);
  return k.pRefHepatic - k.kHepatic * Math.log(Math.max(1e-6, 1 - x));
}

/** Diámetro equivalente de la VCI en función de la presión transmural (ley de tubo). */
/**
 * Escala de radio de las suprahepáticas con la presión hepática (misma ley que usa la
 * anatomía): A ∝ 1 + 0,12·(P − 7), con suelo 0,5.
 */
export function hvRadiusScaleFromPressure(pHepaticMmHg: number): number {
  return Math.max(0.5, Math.sqrt(1 + 0.12 * (pHepaticMmHg - 7)));
}

/**
 * Resistor de Starling (Fase 0, hallado por las pruebas de propiedades): una vena que
 * colapsa LIMITA el caudal. Por debajo del calibre crítico la resistencia crece como
 * Poiseuille (R ∝ 1/r⁴ ∝ 1/A²); por encima no cambia nada, así que los casos calibrados
 * (VCI ≥ 11 mm, suprahepáticas ≥ 0,9) no se alteran. Sin esto, una VCI colapsada a 0,5 mm
 * con presión auricular de −10 mmHg daba velocidades Q/A de 288 m/s.
 */
export const IVC_CRITICAL_DIAMETER_MM = 8;
/** Diámetro del lumen residual de una VCI totalmente colapsada (mm). */
export const IVC_RESIDUAL_LUMEN_MM = 3;
export const HV_CRITICAL_RADIUS_SCALE = 0.8;
export function collapseResistanceFactor(caliberRatio: number): number {
  const r = Math.max(1e-3, caliberRatio);
  return r >= 1 ? 1 : 1 / (r * r * r * r);
}

export function ivcDiameterFromPtm(ptm: number, k: NetworkParams): number {
  const s = sigmoid((ptm - k.ivcP0) / k.ivcW);
  const residual = k.ivcResidual * Math.max(0, ptm - k.ivcP0);
  return Math.max(1.5, k.ivcDmaxMm * s + residual);
}

/** Inversa numérica de la ley de tubo: diámetro → presión transmural. */
export function ivcPtmFromDiameter(d: number, k: NetworkParams): number {
  // Newton sobre f(ptm) = D(ptm) − d, partiendo de la inversa de la sigmoide.
  const y = Math.min(0.995, Math.max(0.005, d / k.ivcDmaxMm));
  let ptm = k.ivcP0 + k.ivcW * logit(y);
  for (let i = 0; i < 12; i++) {
    const f = ivcDiameterFromPtm(ptm, k) - d;
    const h = 1e-3;
    const df = (ivcDiameterFromPtm(ptm + h, k) - ivcDiameterFromPtm(ptm - h, k)) / (2 * h);
    if (Math.abs(df) < 1e-9) break;
    const step = f / df;
    ptm -= step;
    if (Math.abs(step) < 1e-6) break;
  }
  return ptm;
}

export class VenousNetwork {
  state: NetworkState;
  readonly k: NetworkParams;
  private outputs: NetworkOutputs;

  constructor(params: NetworkParams, initial: { pSplanchnic: number; pHepatic: number; pLowerBody: number; pIvcTransmural: number }) {
    this.k = params;
    const k = params;
    const dIvc = ivcDiameterFromPtm(initial.pIvcTransmural, k);
    this.state = {
      vSplanchnic: k.v0Splanchnic + k.cSplanchnic * initial.pSplanchnic,
      vHepatic: hepaticVolumeFromPressure(initial.pHepatic, k),
      vLowerBody: k.v0LowerBody + k.cLowerBody * initial.pLowerBody,
      vIvc: (Math.PI * dIvc * dIvc * 0.25 * k.ivcLengthMm) / 1000,
      qHepaticVein: 0,
      qIvcToRa: 0,
      vRenal: k.v0Renal + k.cRenal * (initial.pIvcTransmural + 1),
      qRenalVein: 0,
    };
    this.outputs = this.evaluate(0, initial.pIvcTransmural + 5, 5);
  }

  get last(): NetworkOutputs {
    return this.outputs;
  }

  private ivcGeometry(vIvc: number): { d: number; area: number; ptm: number } {
    const k = this.k;
    const areaMm2 = (Math.max(1e-3, vIvc) * 1000) / k.ivcLengthMm;
    const d = 2 * Math.sqrt(areaMm2 / Math.PI);
    return { d, area: areaMm2, ptm: ivcPtmFromDiameter(d, k) };
  }

  /** Evalúa presiones y caudales para el estado actual. */
  evaluate(pArtPulseFactor: number, pRa: number, pAbd: number): NetworkOutputs {
    const k = this.k;
    const s = this.state;
    const pSplanchnic = (s.vSplanchnic - k.v0Splanchnic) / k.cSplanchnic;
    const pHepatic = pAbd + hepaticPressureFromVolume(s.vHepatic, k);
    const pLowerBody = (s.vLowerBody - k.v0LowerBody) / k.cLowerBody;
    const geo = this.ivcGeometry(s.vIvc);
    const pIvc = pAbd + geo.ptm;
    const qPortal = (pSplanchnic + pAbd - pHepatic) / k.rPortal;
    // Arteria hepática: el caudal arterial es mucho más pulsátil que la
    // presión media (lecho de alta resistencia con distensibilidad aguas
    // arriba); factor 1,1 → IR 0,63 medido sobre la verdad en los tres casos [EXTRAPOLACIÓN PROPIA].
    const qHepaticArtery = Math.max(0, (k.pArtMean - pHepatic) / k.rHepaticArtery) * (1 + 1.1 * pArtPulseFactor);
    // El cuerpo inferior está fuera del abdomen: su presión externa es ~0, por lo
    // que una presión abdominal alta reduce su retorno hacia la VCI.
    const qLowerBody = (pLowerBody - pIvc) / k.rLowerBody;
    const pJunction = pRa + k.rJunction * (s.qHepaticVein + s.qIvcToRa);
    // Lecho renal: presión elástica lineal + presión abdominal; la arteria renal es
    // un lecho de baja resistencia (factor 0,8 sobre el pulso → IR 0,53 medido; el mismo en los tres
    // casos porque el pulso es multiplicativo y fijo, `fixed-arterial-resistive-index`).
    const pRenal = pAbd + (s.vRenal - k.v0Renal) / k.cRenal;
    const qRenalArtery = Math.max(0, (k.pArtMean - pRenal) / k.rRenalArtery) * (1 + 0.8 * pArtPulseFactor);
    return {
      pSplanchnic: pSplanchnic + pAbd,
      pHepatic,
      pLowerBody,
      pIvc,
      pIvcTransmural: geo.ptm,
      qPortal,
      qHepaticArtery,
      qHepaticVein: s.qHepaticVein,
      qLowerBody,
      qIvcToRa: s.qIvcToRa,
      pJunction,
      ivcDiameterEqMm: geo.d,
      ivcAreaMm2: geo.area,
      pRenal,
      qRenalArtery,
      qRenalVein: s.qRenalVein,
    };
  }

  /**
   * Integra un paso `dt` (s) con Euler semi-implícito y subpasos. `pRa` y
   * `pAbd` son condiciones de contorno del paso; `pArtPulseFactor` ∈ [−0,5, 1].
   */
  step(dt: number, pArtPulseFactor: number, pRa: number, pAbd: number): NetworkOutputs {
    const k = this.k;
    const sub = 4;
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      const o = this.evaluate(pArtPulseFactor, pRa, pAbd);
      const s = this.state;
      const pArtIn = k.pArtMean + k.pArtPulse * pArtPulseFactor;
      const qArtSp = (pArtIn - o.pSplanchnic) / k.rArtSplanchnic;
      const qArtLb = (pArtIn - o.pLowerBody) / k.rArtLowerBody;
      // Ramas con inercia
      // Resistores de Starling: suprahepáticas y VCI colapsadas limitan su propio caudal
      const rHv = k.rHepaticVein * collapseResistanceFactor(hvRadiusScaleFromPressure(o.pHepatic) / HV_CRITICAL_RADIUS_SCALE);
      const rIvc = k.rIvcToRa * collapseResistanceFactor(o.ivcDiameterEqMm / IVC_CRITICAL_DIAMETER_MM);
      // Término resistivo implícito: estable aunque el colapso multiplique R por 10⁴
      // (explícito exigiría h·R/L < 2); para calibres normales difiere en O((h·R/L)²).
      const aHv = h / k.lHepaticVein;
      const aRa = h / k.lIvcToRa;
      const dQrv = (o.pRenal - o.pIvc - k.rRenalVein * s.qRenalVein) / k.lRenalVein;
      s.qHepaticVein = (s.qHepaticVein + aHv * (o.pHepatic - o.pJunction)) / (1 + aHv * rHv);
      s.qIvcToRa = (s.qIvcToRa + aRa * (o.pIvc - o.pJunction)) / (1 + aRa * rIvc);
      s.qRenalVein += dQrv * h;
      // Compartimentos
      s.vSplanchnic += (qArtSp - o.qPortal) * h;
      s.vHepatic += (o.qPortal + o.qHepaticArtery - s.qHepaticVein) * h;
      s.vLowerBody += (qArtLb - o.qLowerBody) * h;
      s.vRenal += (o.qRenalArtery - s.qRenalVein) * h;
      s.vIvc += (o.qLowerBody + s.qRenalVein - s.qIvcToRa) * h;
      // Lumen residual de la VCI colapsada (pliegues de la pared, ≈ 3 mm): nunca se vacía del
      // todo; con el resistor de Starling el caudal de salida ya es mínimo a ese calibre.
      const vIvcMin = (Math.PI * (IVC_RESIDUAL_LUMEN_MM / 2) ** 2 * k.ivcLengthMm) / 1000;
      if (s.vIvc < vIvcMin) s.vIvc = vIvcMin;
    }
    this.outputs = this.evaluate(pArtPulseFactor, pRa, pAbd);
    return this.outputs;
  }
}
