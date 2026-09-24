import { TISSUES, Tissue, attenuationDbPerCm } from '../anatomy/tissues';

/**
 * Regla de atenuación ida y vuelta a lo largo de un rayo, la MISMA que aplica la
 * pasada A en GLSL (`FRAG_TRANSMISSION`): el gel previo a la piel no atenúa; el gas
 * atenúa 60 dB/cm y no suma absorción; el hueso cobra 6 dB una sola vez al entrar
 * (reflexión en la interfaz) más su absorción por paso; el resto, 2·α(f)·paso.
 * La usan la puerta PW (transmisión hasta la muestra) y sus pruebas; el shader la
 * reproduce. Única diferencia deliberada: la pasada A refleja el rayo en el primer
 * pulmón (espejo diafragmático, en el cruce exacto: `mirrorCrossing`) y sigue; la puerta
 * PW no sigue rayos reflejados.
 */
export const BONE_ENTRY_DB = 6;
export const GAS_DB_PER_CM = 60;

export function rayAttenuationDb(tissues: Iterable<Tissue>, stepMm: number, fMHz: number): number {
  let db = 0;
  let entered = false;
  let boneEntered = false;
  for (const t of tissues) {
    if (t === Tissue.Air && !entered) continue; // gel de acoplamiento
    entered = true;
    const props = TISSUES[t];
    if (props.gas) {
      db += GAS_DB_PER_CM * (stepMm / 10);
      continue;
    }
    if (props.bone && !boneEntered) {
      db += BONE_ENTRY_DB;
      boneEntered = true;
    }
    db += 2 * attenuationDbPerCm(t, fMHz) * (stepMm / 10);
  }
  return db;
}

/**
 * Pasos de la bisección con que la pasada A (A0) coloca el espejo diafragmático en el cruce exacto con
 * el pulmón (decisión 57): del paso grueso (profundidad/160, 1,125 mm a 18 cm) a 0,018 mm; el punto
 * medio queda a ≤ 0,009 mm de la pleura.
 */
export const MIRROR_BISECTION_STEPS = 6;

/**
 * Gemelo de A0 (`FRAG_TRANS_HITS`): profundidad del espejo sobre la línea recta. `rLung` es el centro del
 * primer segmento grueso cuyo punto medio es pulmón y `step` el paso grueso; la bisección busca el cruce
 * entre la muestra gruesa anterior (que no lo es) y esa, y devuelve el punto medio del último intervalo.
 */
export function mirrorCrossing(isLung: (r: number) => boolean, rLung: number, step: number, steps = MIRROR_BISECTION_STEPS): number {
  let lo = Math.max(rLung - step, 0);
  let hi = rLung;
  for (let i = 0; i < steps; i++) {
    const mid = 0.5 * (lo + hi);
    if (isLung(mid)) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

/** Transmisión de amplitud ida y vuelta (0–1) correspondiente a `rayAttenuationDb`. */
export function rayTransmission(tissues: Iterable<Tissue>, stepMm: number, fMHz: number): number {
  return Math.pow(10, -rayAttenuationDb(tissues, stepMm, fMHz) / 20);
}
