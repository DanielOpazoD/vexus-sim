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
 * Esta función SOLO recibe observables. No conoce el PatientState.
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
}

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

export function classifyVexusC(input: VexusInputs): VexusResult {
  const portalClass = classifyPortal(input.portalPulsatilityFraction);
  const hepaticClass = input.hepatic;
  const renalClass = input.renal;
  const pf = input.portalPulsatilityFraction;
  const portalNearThreshold = pf !== null && Number.isFinite(pf) && (Math.abs(pf - PF_MILD) <= 1 || Math.abs(pf - PF_SEVERE) <= 1);

  let severeCount = 0;
  let missingCount = 0;
  if (hepaticClass === 'severe') severeCount++;
  else if (hepaticClass === 'not-assessed') missingCount++;
  if (portalClass === 'severe') severeCount++;
  else if (portalClass === 'not-assessed' || portalClass === 'not-applicable') missingCount++;
  if (renalClass === 'monophasic') severeCount++;
  else if (renalClass === 'not-assessed' || renalClass === 'reversal-out-of-scheme') missingCount++;

  const base = { portalClass, hepaticClass, renalClass, severeCount, missingCount, portalNearThreshold };

  if (input.ivcMaxDiameterMm === null || !Number.isFinite(input.ivcMaxDiameterMm)) {
    return { grade: null, gradeRange: null, status: 'ivc-not-assessed', ivcDilated: null, ...base };
  }
  const dilated = input.ivcMaxDiameterMm >= IVC_THRESHOLD_MM;
  if (!dilated) {
    return { grade: 0, gradeRange: [0, 0], status: 'complete', ivcDilated: false, ...base };
  }
  const gradeFromSevere = (n: number): 1 | 2 | 3 => (n === 0 ? 1 : n === 1 ? 2 : 3);
  const lo = gradeFromSevere(severeCount);
  const hi = gradeFromSevere(Math.min(3, severeCount + missingCount));
  if (lo === hi) {
    return { grade: lo, gradeRange: [lo, hi], status: missingCount ? 'incomplete' : 'complete', ivcDilated: true, ...base };
  }
  return { grade: null, gradeRange: [lo, hi], status: 'incomplete', ivcDilated: true, ...base };
}

/** Fracción de pulsatilidad portal (%) sin recorte: puede superar 100 si Vmín < 0. */
export function portalPulsatilityFraction(vMax: number, vMin: number): number {
  if (!(vMax > 0)) return Number.NaN;
  return (100 * (vMax - vMin)) / vMax;
}

/**
 * Patrón venoso intrarrenal a partir de los picos S y D (anterógrados, cm/s) y
 * del mínimo del ciclo. Continuo: el flujo nunca se interrumpe (mín ≥ 30 % del
 * máximo); bifásico: se interrumpe pero hay pico sistólico y diastólico (S ≥ 30 %
 * de D); monofásico: solo pico diastólico. Un mínimo retrógrado con S y D
 * presentes se informa «fuera del esquema». Umbrales [EXTRAPOLACIÓN PROPIA] de
 * la descripción cualitativa de la base (D.9, A.1).
 */
export function renalPatternFromPeaks(sPeak: number, dPeak: number, vMin: number): RenalPattern {
  if (![sPeak, dPeak, vMin].every(Number.isFinite)) return 'not-assessed';
  const vMax = Math.max(sPeak, dPeak);
  if (!(vMax > 0)) return 'not-assessed';
  if (vMin >= 0.3 * vMax) return 'continuous';
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
