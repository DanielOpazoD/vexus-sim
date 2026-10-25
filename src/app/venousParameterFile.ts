import { VENOUS_EXPERIMENT_FIELDS, venousExperimentPatient, type VenousExperimentParameters } from './venousExperiment';

export const VENOUS_PARAMETER_FILE_BYTES = 8192;
const kind = 'vexus-venous-parameters';
const numericKeys = VENOUS_EXPERIMENT_FIELDS.map((f) => f.key);
const keys = [...numericKeys, 'rhythm'];
function exactObject(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function parameters(value: unknown): VenousExperimentParameters {
  if (!exactObject(value, keys)) throw new Error('Parámetros incompletos o desconocidos');
  const p = Object.fromEntries(keys.map((key) => [key, value[key]])) as VenousExperimentParameters;
  venousExperimentPatient(p);
  return p;
}
/** Only bounded control values, never patient identity, recorded IQ or a claimed exact replay. */
export function encodeVenousParameters(p: VenousExperimentParameters): string {
  return JSON.stringify({ kind, version: 2, parameters: parameters(p) }, null, 2) + '\n';
}
export function decodeVenousParameters(text: string): VenousExperimentParameters {
  if (new TextEncoder().encode(text).length > VENOUS_PARAMETER_FILE_BYTES) throw new Error('Archivo mayor de 8 KiB');
  const data: unknown = JSON.parse(text);
  if (!exactObject(data, ['kind', 'version', 'parameters']) || data.kind !== kind || (data.version !== 1 && data.version !== 2))
    throw new Error('Formato o versión de parámetros no compatible');
  // Version 1 could only describe sinus experiments. Do not accept unknown keys during migration.
  if (data.version === 1) {
    if (!exactObject(data.parameters, numericKeys)) throw new Error('Parámetros incompletos o desconocidos');
    return parameters({ ...data.parameters, rhythm: 'sinus' });
  }
  return parameters(data.parameters);
}
