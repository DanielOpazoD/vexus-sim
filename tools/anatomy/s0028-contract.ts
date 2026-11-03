/** Contratos de herramientas P0; nunca se importa desde el runtime. */
export type CandidateField = {
  name: string;
  asset: 'abdominal' | 'thoracic';
  status: string;
  dimensions: [number, number, number];
  originMm: [number, number, number];
  rawBytes: number;
  gzipBytes: number;
  sha256Raw: string;
};
export function triple(value: unknown): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((v: unknown) => typeof v === 'number' && Number.isFinite(v)))
    throw new Error('Triple inválido');
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}
export function parseFields(value: unknown): CandidateField[] {
  if (!value || typeof value !== 'object' || !('fields' in value) || !Array.isArray(value.fields)) throw new Error('Campos ausentes');
  return value.fields.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('name' in entry) ||
      typeof entry.name !== 'string' ||
      !('asset' in entry) ||
      (entry.asset !== 'abdominal' && entry.asset !== 'thoracic') ||
      !('status' in entry) ||
      typeof entry.status !== 'string' ||
      !('dimensions' in entry) ||
      !('originMm' in entry) ||
      !('rawBytes' in entry) ||
      typeof entry.rawBytes !== 'number' ||
      !('gzipBytes' in entry) ||
      typeof entry.gzipBytes !== 'number' ||
      !('sha256Raw' in entry) ||
      typeof entry.sha256Raw !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256Raw)
    )
      throw new Error('Descriptor de campo inválido');
    const dimensions = triple(entry.dimensions);
    if (!dimensions.every((v) => Number.isSafeInteger(v) && v > 0) || entry.rawBytes !== dimensions.reduce((a, b) => a * b, 4))
      throw new Error('Tamaño RG16F distinto de rejilla');
    return {
      name: entry.name,
      asset: entry.asset,
      status: entry.status,
      dimensions,
      originMm: triple(entry.originMm),
      rawBytes: entry.rawBytes,
      gzipBytes: entry.gzipBytes,
      sha256Raw: entry.sha256Raw,
    };
  });
}
export function requireCategorical(values: number[], allowed: number[]): void {
  if (!values.every((v) => Number.isSafeInteger(v) && allowed.includes(v))) throw new Error('Etiqueta interpolada');
}
