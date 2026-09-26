/**
 * Clasificación VExUS C (Beaubien-Souligny 2020) tal como la operativiza la
 * base de conocimiento A.1:
 *
 *   VCI < 20 mm → grado 0.
 *   VCI ≥ 20 mm → contar patrones GRAVES: 0 → 1; 1 → 2; ≥2 → 3.
 *   Porta: PF < 30 % normal; 30 ≤ PF < 50 leve; PF ≥ 50 grave (50 inclusivo).
 *   Suprahepática: S > D normal; S < D (S anterógrada) leve; S retrógrada grave.
 *   Renal: continuo normal; discontinuo S+D leve; solo diastólico grave.
 *
 * Reglas de incertidumbre ([EXTRAPOLACIÓN PROPIA] de la base): si falta un
 * territorio se devuelve el intervalo de grados compatible y estado
 * «incompleto». PF no se limita a 100 %. Una porta globalmente hepatófuga
 * hace inaplicable PF. S = D se registra como frontera y se incluye en «leve».
 *
 * Esta función SOLO recibe observables. No conoce el PatientState. El contexto clínico que el operador conoce (historia,
 * ECG, ventilador: `VexusContext`) puede volver poco fiable un territorio o la puerta de la VCI; entonces el territorio
 * cuenta como no evaluado para el intervalo de grados y el resultado lleva el aviso con su motivo (decisión 79, revisión
 * de la literatura de VExUS del 26-09-2026).
 */
export type HepaticPattern = 'normal' | 'mild' | 'severe' | 'not-assessed';
export type RenalPattern = 'continuous' | 'biphasic' | 'monophasic' | 'reversal-out-of-scheme' | 'not-assessed';
export type PortalClass = 'normal' | 'mild' | 'severe' | 'not-applicable' | 'not-assessed';

export interface VexusInputs {
  ivcMaxDiameterMm: number | null;
  hepatic: HepaticPattern;
  /** Fracción de pulsatilidad portal en %, null si no evaluada, NaN si no aplicable. */
  portalPulsatilityFraction: number | null;
  renal: RenalPattern;
}

export interface VexusResult {
  /** Grado único si se puede determinar; si no, el mínimo compatible. */
  grade: 0 | 1 | 2 | 3 | null;
  gradeRange: [number, number] | null;
  status: 'complete' | 'incomplete' | 'ivc-not-assessed';
  ivcDilated: boolean | null;
  portalClass: PortalClass;
  hepaticClass: HepaticPattern;
  renalClass: RenalPattern;
  severeCount: number;
  missingCount: number;
  /** PF próxima al umbral (±1 punto) — la base pide señalarlo, no redondear en silencio. */
  portalNearThreshold: boolean;
  /**
   * VCI a ±2 mm del umbral de 20 mm: la literatura no unifica el corte (>2 frente a ≥2 cm; 2,1 cm en la tabla de la
   * ASE; 1,7 cm en talla pequeña) y 2 mm es el error típico de colocar los calibradores.
   */
  ivcNearThreshold: boolean;
  /** Avisos de fiabilidad por el contexto clínico, con el territorio y el motivo. */
  warnings: ReliabilityWarning[];
}

/** Territorios del VExUS: la puerta de la VCI y las tres venas. */
export type Territory = 'ivc' | 'hepatic' | 'portal' | 'renal';

/** Aviso de fiabilidad: `excluded` = el territorio cuenta como no evaluado para el intervalo de grados. */
export interface ReliabilityWarning {
  territory: Territory;
  reason: string;
  excluded: boolean;
}

/**
 * Contexto clínico que el operador conoce y que la literatura de VExUS señala como confusor. Todos opcionales: sin
 * contexto, la clasificación es la de siempre.
 */
export interface VexusContext {
  /** Enfermedad renal crónica avanzada o en diálisis: el Doppler intrarrenal no es fiable (bifásico sin congestión). */
  advancedCkd?: boolean;
  /** Cirrosis o hipertensión portal: la porta y la suprahepática dejan de seguir a la PAD. */
  cirrhosis?: boolean;
  /** Sin ECG simultáneo: S y D se rotulan mal. */
  noEcg?: boolean;
  /** Fibrilación auricular: la onda S se reduce sin congestión. */
  atrialFibrillation?: boolean;
  /** Ventilación con presión positiva: VCI dilatada y poco colapsable sin PAD alta; su tabla frente a la PAD no vale. */
  positivePressureVentilation?: boolean;
  /** Presión intraabdominal elevada o ascitis a tensión: la VCI puede ser pequeña con la PAD alta (grado 0 falso). */
  raisedIntraAbdominalPressure?: boolean;
  /** Deportista: la porta puede ser pulsátil en reposo sin congestión. */
  athlete?: boolean;
}

/**
 * Avisos por contexto [LITERATURA, revisión del 26-09-2026: Koratala 2022 y 2026; Leyba 2026; Martin 2025; Kidney360
 * 2022; Clin Kidney J 2024; Med Clin N Am 2025]. Excluyen el territorio (cuenta como no evaluado) la ERC avanzada
 * (renal), la cirrosis (porta y suprahepática) y el deportista (porta); la FA, la falta de ECG y la ventilación solo
 * avisan. La presión intraabdominal alta se trata aparte: una VCI < 20 mm no cierra en grado 0.
 */
export function contextWarnings(ctx: VexusContext = {}): ReliabilityWarning[] {
  const w: ReliabilityWarning[] = [];
  if (ctx.advancedCkd)
    w.push({
      territory: 'renal',
      reason: 'ERC avanzada o diálisis: el patrón intrarrenal puede ser bifásico sin congestión',
      excluded: true,
    });
  if (ctx.cirrhosis) {
    w.push({ territory: 'portal', reason: 'cirrosis: la pulsatilidad portal no sigue a la PAD', excluded: true });
    w.push({ territory: 'hepatic', reason: 'cirrosis: el parénquima rígido aplana la onda suprahepática', excluded: true });
  }
  if (ctx.athlete)
    w.push({ territory: 'portal', reason: 'deportista: la porta puede ser pulsátil en reposo sin congestión', excluded: true });
  if (ctx.noEcg) w.push({ territory: 'hepatic', reason: 'sin ECG: S y D se rotulan sin referencia', excluded: false });
  if (ctx.atrialFibrillation)
    w.push({ territory: 'hepatic', reason: 'fibrilación auricular: la onda S se reduce sin congestión', excluded: false });
  if (ctx.positivePressureVentilation)
    w.push({
      territory: 'ivc',
      reason: 'ventilación con presión positiva: la VCI está dilatada y colapsa poco sin PAD alta',
      excluded: false,
    });
  if (ctx.raisedIntraAbdominalPressure)
    w.push({ territory: 'ivc', reason: 'presión intraabdominal alta: la VCI puede ser pequeña con la PAD alta', excluded: false });
  return w;
}

/** Media distancia al umbral de la VCI dentro de la cual se avisa (mm). */
export const IVC_NEAR_THRESHOLD_MM = 2;

export const IVC_THRESHOLD_MM = 20;
export const PF_MILD = 30;
export const PF_SEVERE = 50;

export function classifyPortal(pf: number | null): PortalClass {
  if (pf === null) return 'not-assessed';
  if (!Number.isFinite(pf)) return 'not-applicable';
  if (pf < PF_MILD) return 'normal';
  if (pf < PF_SEVERE) return 'mild';
  return 'severe';
}

export function classifyVexusC(input: VexusInputs, ctx: VexusContext = {}): VexusResult {
  const portalClass = classifyPortal(input.portalPulsatilityFraction);
  const hepaticClass = input.hepatic;
  const renalClass = input.renal;
  const pf = input.portalPulsatilityFraction;
  const portalNearThreshold = pf !== null && Number.isFinite(pf) && (Math.abs(pf - PF_MILD) <= 1 || Math.abs(pf - PF_SEVERE) <= 1);
  const ivc = input.ivcMaxDiameterMm;
  const ivcNearThreshold = ivc !== null && Number.isFinite(ivc) && Math.abs(ivc - IVC_THRESHOLD_MM) <= IVC_NEAR_THRESHOLD_MM;
  const warnings = contextWarnings(ctx);
  const excluded = new Set(warnings.filter((w) => w.excluded).map((w) => w.territory));

  // un territorio excluido por el contexto cuenta como no evaluado para el intervalo (su clase se sigue informando)
  let severeCount = 0;
  let missingCount = 0;
  if (excluded.has('hepatic')) missingCount++;
  else if (hepaticClass === 'severe') severeCount++;
  else if (hepaticClass === 'not-assessed') missingCount++;
  if (excluded.has('portal')) missingCount++;
  else if (portalClass === 'severe') severeCount++;
  else if (portalClass === 'not-assessed' || portalClass === 'not-applicable') missingCount++;
  if (excluded.has('renal')) missingCount++;
  else if (renalClass === 'monophasic') severeCount++;
  else if (renalClass === 'not-assessed' || renalClass === 'reversal-out-of-scheme') missingCount++;

  const base = { portalClass, hepaticClass, renalClass, severeCount, missingCount, portalNearThreshold, ivcNearThreshold, warnings };

  if (ivc === null || !Number.isFinite(ivc)) {
    return { grade: null, gradeRange: null, status: 'ivc-not-assessed', ivcDilated: null, ...base };
  }
  const dilated = ivc >= IVC_THRESHOLD_MM;
  const gradeFromSevere = (n: number): 1 | 2 | 3 => (n === 0 ? 1 : n === 1 ? 2 : 3);
  const lo = gradeFromSevere(severeCount);
  const hi = gradeFromSevere(Math.min(3, severeCount + missingCount));
  if (!dilated) {
    // con la presión intraabdominal alta una VCI pequeña no descarta la congestión: el intervalo va de 0 al grado que
    // darían las venas con la VCI dilatada
    if (ctx.raisedIntraAbdominalPressure) return { grade: null, gradeRange: [0, hi], status: 'incomplete', ivcDilated: false, ...base };
    return { grade: 0, gradeRange: [0, 0], status: 'complete', ivcDilated: false, ...base };
  }
  if (lo === hi) {
    return { grade: lo, gradeRange: [lo, hi], status: missingCount ? 'incomplete' : 'complete', ivcDilated: true, ...base };
  }
  return { grade: null, gradeRange: [lo, hi], status: 'incomplete', ivcDilated: true, ...base };
}

/**
 * VExUS modificado sin riñón (mVExUS; Martin 2025, Ultrasound J): la VCI y las dos venas hepáticas. Con la VCI ≥ 20 mm,
 * 0 patrones graves → 1, 1 → 2, 2 → 3. Frente a la PAD > 12 mmHg: AUC 0,85 (tradicional 0,87) y concordancia κ 0,85.
 * Útil sin ventana renal o con el territorio renal poco fiable.
 */
export function classifyModifiedVexus(input: Omit<VexusInputs, 'renal'>, ctx: VexusContext = {}): VexusResult {
  // el riñón no forma parte de mVExUS: se pasa como neutro (ni grave ni ausente) y se informa como no evaluado
  const r = classifyVexusC({ ...input, renal: 'continuous' }, { ...ctx, advancedCkd: false });
  return { ...r, renalClass: 'not-assessed' };
}

/** Fracción de pulsatilidad portal (%) sin recorte: puede superar 100 si Vmín < 0. */
export function portalPulsatilityFraction(vMax: number, vMin: number): number {
  if (!(vMax > 0)) return Number.NaN;
  return (100 * (vMax - vMin)) / vMax;
}

/**
 * Suelo de la interrupción renal en la verdad fisiológica (cm/s): la velocidad más baja que la
 * medición cuenta como flujo con los ajustes por defecto (filtro de pared de 25 Hz más el margen de
 * `flowBandMinHz`, 62,5 Hz a 2,5 MHz y sin corrección angular ≈ 1,9 cm/s). La medición observada no
 * usa este valor: pasa su propio suelo, el mismo corte en Hz convertido con su PRF y su ángulo.
 */
export const RENAL_INTERRUPTION_FLOOR_CMS = 2;
/** Fracción del máximo por debajo de la cual el valle se lee como línea de base en la escala del espectro. */
export const RENAL_INTERRUPTION_FRACTION = 0.1;

/**
 * Patrón venoso intrarrenal a partir de los picos S y D (anterógrados, cm/s) y del mínimo
 * RESOLUBLE del ciclo: el valle sostenido lo bastante para verse en el espectro (una pausa más
 * breve que la ventana de análisis no llega a la línea de base, ver `RENAL_GAP_MIN_S`). Continuo:
 * el flujo nunca se interrumpe, por pulsátil que sea (mín > max(suelo, 10 % del máximo));
 * bifásico: se interrumpe pero hay pico sistólico y diastólico (S ≥ 30 % de D); monofásico: solo
 * pico diastólico. Un mínimo retrógrado con S y D presentes se informa «fuera del esquema».
 * Umbrales [EXTRAPOLACIÓN PROPIA] de la descripción cualitativa de la base (D.9, A.1).
 */
export function renalPatternFromPeaks(sPeak: number, dPeak: number, vMin: number, floorCms = RENAL_INTERRUPTION_FLOOR_CMS): RenalPattern {
  if (![sPeak, dPeak, vMin].every(Number.isFinite)) return 'not-assessed';
  const vMax = Math.max(sPeak, dPeak);
  if (!(vMax > 0)) return 'not-assessed';
  if (vMin > Math.max(floorCms, RENAL_INTERRUPTION_FRACTION * vMax)) return 'continuous';
  if (sPeak >= 0.3 * dPeak) return vMin < -0.2 * vMax ? 'reversal-out-of-scheme' : 'biphasic';
  return 'monophasic';
}

/** Patrón suprahepático a partir de picos con signo (positivo = hacia la AD). */
export function hepaticPatternFromPeaks(sPeak: number, dPeak: number): HepaticPattern {
  if (!Number.isFinite(sPeak) || !Number.isFinite(dPeak)) return 'not-assessed';
  if (sPeak <= 0) return 'severe';
  if (sPeak > dPeak) return 'normal';
  return 'mild';
}
