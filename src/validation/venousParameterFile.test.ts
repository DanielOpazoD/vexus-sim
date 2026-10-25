import { describe, expect, it } from 'vitest';
import { congestionParameters, VENOUS_EXPERIMENT_FIELDS } from '../app/venousExperiment';
import { decodeVenousParameters, encodeVenousParameters } from '../app/venousParameterFile';

describe('archivo versionado de parámetros venosos', () => {
  it('conserva FA en v2 e importa v1 exclusivamente como el escenario sinusal original', () => {
    const p = { ...congestionParameters(0.5), rhythm: 'atrial-fibrillation' as const };
    expect(decodeVenousParameters(encodeVenousParameters(p))).toEqual(p);
    const { rhythm: _r, ...legacy } = p;
    const file = { kind: 'vexus-venous-parameters', version: 1, parameters: legacy };
    expect(decodeVenousParameters(JSON.stringify(file))).toEqual({ ...legacy, rhythm: 'sinus' });
    expect(() => decodeVenousParameters(JSON.stringify({ ...file, parameters: p }))).toThrow();
    for (const rhythm of ['af', '', 0, null, undefined])
      expect(() => decodeVenousParameters(JSON.stringify({ ...file, version: 2, parameters: { ...p, rhythm } }))).toThrow();
    const { heartRateBpm: _h, ...incomplete } = legacy;
    expect(() => decodeVenousParameters(JSON.stringify({ ...file, parameters: incomplete }))).toThrow();
  });
  it('reproduce controles numéricos y ritmo sin mutar la entrada', () => {
    const p = { ...congestionParameters(0.525), heartRateBpm: 50, venousReservoirCompliance: 0.5 };
    const before = structuredClone(p);
    const text = encodeVenousParameters(p);
    expect(decodeVenousParameters(text)).toEqual(p);
    expect(p).toEqual(before);
    const parsed = JSON.parse(text) as { parameters: Record<string, unknown> };
    expect(Object.keys(parsed)).toEqual(['kind', 'version', 'parameters']);
    expect(Object.keys(parsed.parameters)).toEqual([...VENOUS_EXPERIMENT_FIELDS.map((f) => f.key), 'rhythm']);
  });
  it('rechaza formatos, versiones y claves desconocidas, incluso __proto__', () => {
    const base = { kind: 'vexus-venous-parameters', version: 2, parameters: congestionParameters(0) };
    for (const data of [
      null,
      [],
      1,
      {},
      { ...base, version: 3 },
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
        expect(() => decodeVenousParameters(JSON.stringify({ kind: 'vexus-venous-parameters', version: 2, parameters: p }))).toThrow();
      }
      const p: Record<string, unknown> = { ...base };
      delete p[field.key];
      expect(() => decodeVenousParameters(JSON.stringify({ kind: 'vexus-venous-parameters', version: 2, parameters: p }))).toThrow();
    }
  });
  it('acota bytes UTF-8 antes de analizar contenido', () => {
    expect(() => decodeVenousParameters(' '.repeat(8193))).toThrow('8 KiB');
    expect(() => decodeVenousParameters('é'.repeat(4097))).toThrow('8 KiB');
  });
});
