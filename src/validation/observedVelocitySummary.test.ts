import { describe, expect, it } from 'vitest';
import { observedVelocitySummary } from '../ui/observedVelocitySummary';

const hepatic = { kind: 'hepatic' as const, quality: { issue: null }, beats: 4, anterogradeSign: -1, sPeak: 32, dPeak: 18, aPeak: -5 };
describe('valores PW observados con signo de pantalla', () => {
  it('conserva S/D/A y muestra el mismo sentido que sus marcas', () => {
    expect(observedVelocitySummary(hepatic)).toBe('S -32.0 · D -18.0 · A +5.0 cm/s · mediana 4 lat.');
    expect(observedVelocitySummary({ ...hepatic, anterogradeSign: 1 })).toBe('S +32.0 · D +18.0 · A -5.0 cm/s · mediana 4 lat.');
  });
  it('no inventa una A ausente ni la sustituye por cero', () => {
    expect(observedVelocitySummary({ ...hepatic, aPeak: NaN })).toContain('A —');
  });
  it('conserva una inversión portal y no recorta su mínimo', () => {
    expect(observedVelocitySummary({ kind: 'portal', quality: { issue: null }, beats: 4, anterogradeSign: 1, vMax: 25, vMin: -6 })).toBe(
      'Vmáx +25.0 · Vmín -6.0 cm/s · mediana 4 lat.',
    );
  });
  it('los valores renales son máximos por fase, no nuevas ondas S/D', () => {
    expect(
      observedVelocitySummary({ kind: 'renal', quality: { issue: null }, beats: 4, anterogradeSign: -1, sPeak: 6.3, dPeak: 25.8, vMin: 0 }),
    ).toBe('máx. sist. -6.3 · diást. -25.8 · mín 0.0 cm/s · mediana 4 lat.');
  });
  it('no publica valores de una adquisición rechazada o sin suficientes datos', () => {
    expect(observedVelocitySummary(null)).toBe('');
    for (const issue of ['aliasing', 'renal-identity', 'wall-filter', 'few-beats', 'no-signal'] as const)
      expect(observedVelocitySummary({ ...hepatic, quality: { issue } })).toBe('');
    expect(observedVelocitySummary({ ...hepatic, beats: 0 })).toBe('');
    expect(observedVelocitySummary({ ...hepatic, anterogradeSign: 0 })).toBe('');
  });
  it('redondea solo texto y no modifica la captura ni fabrica cero negativo', () => {
    const input = { ...hepatic, sPeak: 0.01, dPeak: 18.34 };
    const before = structuredClone(input);
    expect(observedVelocitySummary(input)).toContain('S 0.0 · D -18.3');
    expect(input).toEqual(before);
  });
});
