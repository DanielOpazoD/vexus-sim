import { describe, expect, it } from 'vitest';
import { congestionParameters, VENOUS_EXPERIMENT_FIELDS } from '../app/venousExperiment';
import { decodeVenousParameters, encodeVenousParameters } from '../app/venousParameterFile';

describe('archivo versionado de parámetros venosos', () => {
  it('reproduce solo los siete parámetros sin mutar la entrada', () => {
    const p = { ...congestionParameters(0.525), heartRateBpm: 50, venousReservoirCompliance: 0.5 };
    const before = structuredClone(p);
    const text = encodeVenousParameters(p);
    expect(decodeVenousParameters(text)).toEqual(p);
    expect(p).toEqual(before);
    const parsed = JSON.parse(text) as { parameters: Record<string, unknown> };
    expect(Object.keys(parsed)).toEqual(['kind', 'version', 'parameters']);
    expect(Object.keys(parsed.parameters)).toEqual(VENOUS_EXPERIMENT_FIELDS.map((f) => f.key));
  });
  it('rechaza formatos, versiones y claves desconocidas, incluso __proto__', () => {
    const base = { kind: 'vexus-venous-parameters', version: 1, parameters: congestionParameters(0) };
    for (const data of [
      null,
      [],
      1,
      {},
      { ...base, version: 2 },
      { ...base, kind: 'other' },
      { ...base, patient: {} },
      { ...base, parameters: { ...base.parameters, extra: 1 } },
      { ...base, parameters: [] },
    ])
      expect(() => decodeVenousParameters(JSON.stringify(data))).toThrow();
    expect(() => decodeVenousParameters('{"__proto__":{},"kind":"vexus-venous-parameters","version":1,"parameters":{}}')).toThrow();
    expect(() => decodeVenousParameters('{broken')).toThrow();
  });
  it('cada campo debe estar presente, ser finito y pertenecer a su dominio', () => {
    const base = congestionParameters(0);
    for (const field of VENOUS_EXPERIMENT_FIELDS) {
      for (const invalid of [field.min - 1, field.max + 1, NaN, Infinity, '5', null]) {
        const p = { ...base, [field.key]: invalid };
        expect(() => decodeVenousParameters(JSON.stringify({ kind: 'vexus-venous-parameters', version: 1, parameters: p }))).toThrow();
      }
      const p: Record<string, number> = { ...base };
      delete p[field.key];
      expect(() => decodeVenousParameters(JSON.stringify({ kind: 'vexus-venous-parameters', version: 1, parameters: p }))).toThrow();
    }
  });
  it('acota bytes UTF-8 antes de analizar contenido', () => {
    expect(() => decodeVenousParameters(' '.repeat(8193))).toThrow('8 KiB');
    expect(() => decodeVenousParameters('é'.repeat(4097))).toThrow('8 KiB');
  });
});
