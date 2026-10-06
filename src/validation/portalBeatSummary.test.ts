import { describe, expect, it } from 'vitest';
import { portalBeatSummary } from '../ui/portalBeatSummary';

describe('variabilidad de los latidos portales observados', () => {
  it('expresa rango muestral y umbrales cruzados sin inventar un intervalo de confianza', () => {
    const m = { beats: 4, pulsatilityFraction: 39, pulsatilityByBeat: [20, 38, 40, 55] };
    const before = structuredClone(m);
    expect(portalBeatSummary(m)).toBe('PF 39 % · rango entre 4 latidos 20–55 % · cruza 30/50 %: ampliar registro');
    expect(m).toEqual(before);
  });
  it('conserva PF superior a 100 y no advierte cuando no hay cruce', () => {
    expect(portalBeatSummary({ beats: 3, pulsatilityFraction: 124, pulsatilityByBeat: [120, 124, 128] })).toBe(
      'PF 124 % · rango entre 3 latidos 120–128 %',
    );
    expect(portalBeatSummary({ beats: 2, pulsatilityFraction: 40, pulsatilityByBeat: [30, 50] })).toContain('cruza 50 %');
  });
  it('no informa rangos de datos incompletos o no finitos', () => {
    expect(portalBeatSummary({ beats: 4, pulsatilityFraction: 20 })).toBe('');
    for (const values of [[], [20], [20, NaN], [20, Infinity]])
      expect(portalBeatSummary({ beats: 2, pulsatilityFraction: 20, pulsatilityByBeat: values })).toBe('');
    expect(portalBeatSummary({ beats: 2, pulsatilityFraction: NaN, pulsatilityByBeat: [20, 20] })).toBe('');
  });
});
