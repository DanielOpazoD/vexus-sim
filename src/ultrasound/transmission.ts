import { TISSUES, Tissue, attenuationDbPerCm } from '../anatomy/tissues';

/**
 * Regla de atenuación ida y vuelta a lo largo de un rayo, la MISMA que aplica la
 * pasada A en GLSL (`FRAG_TRANSMISSION`): el gel previo a la piel no atenúa; el gas
 * atenúa 60 dB/cm y no suma absorción; el hueso cobra 6 dB una sola vez al entrar
 * (reflexión en la interfaz) más su absorción por paso; el resto, 2·α(f)·paso.
 * La usan la puerta PW (transmisión hasta la muestra) y sus pruebas; el shader la
 * reproduce. Única diferencia deliberada: la pasada A refleja el rayo en el primer
 * pulmón (espejo diafragmático) y sigue; la puerta PW no sigue rayos reflejados.
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

/** Transmisión de amplitud ida y vuelta (0–1) correspondiente a `rayAttenuationDb`. */
export function rayTransmission(tissues: Iterable<Tissue>, stepMm: number, fMHz: number): number {
  return Math.pow(10, -rayAttenuationDb(tissues, stepMm, fMHz) / 20);
}
