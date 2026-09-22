import { describe, expect, it } from 'vitest';
import { classifyPortal, classifyVexusC, hepaticPatternFromPeaks, portalPulsatilityFraction } from '../vexus/classification';

describe('Clasificación VExUS C (base A.1, guía §6/§21)', () => {
  it('PF portal admite > 100 % cuando Vmín < 0 y no se recorta', () => {
    expect(portalPulsatilityFraction(30, 15)).toBeCloseTo(50, 6);
    expect(portalPulsatilityFraction(30, -15)).toBeCloseTo(150, 6);
    expect(classifyPortal(150)).toBe('severe');
  });

  it('PF no es aplicable con flujo globalmente hepatófugo (Vmáx ≤ 0)', () => {
    expect(Number.isNaN(portalPulsatilityFraction(-8, -8))).toBe(true);
    expect(classifyPortal(Number.NaN)).toBe('not-applicable');
  });

  it('umbral portal 50 % inclusivo y 30 % inclusivo en leve', () => {
    expect(classifyPortal(29.9)).toBe('normal');
    expect(classifyPortal(30)).toBe('mild');
    expect(classifyPortal(49.96)).toBe('mild');
    expect(classifyPortal(50)).toBe('severe');
  });

  it('patrón suprahepático: S>D normal, S<D leve, S=D frontera→leve, S≤0 grave', () => {
    expect(hepaticPatternFromPeaks(28, 18)).toBe('normal');
    expect(hepaticPatternFromPeaks(15, 24)).toBe('mild');
    expect(hepaticPatternFromPeaks(20, 20)).toBe('mild');
    expect(hepaticPatternFromPeaks(-10, 30)).toBe('severe');
  });

  it('VCI < 20 mm cierra en grado 0 aunque haya patrones graves; los hallazgos se conservan', () => {
    const r = classifyVexusC({ ivcMaxDiameterMm: 18, hepatic: 'severe', portalPulsatilityFraction: 80, renal: 'monophasic' });
    expect(r.grade).toBe(0);
    expect(r.severeCount).toBe(3);
    expect(r.portalClass).toBe('severe');
  });

  it('VCI ≥ 20 mm: 0 graves → 1, 1 → 2, ≥2 → 3', () => {
    expect(classifyVexusC({ ivcMaxDiameterMm: 22, hepatic: 'mild', portalPulsatilityFraction: 40, renal: 'biphasic' }).grade).toBe(1);
    expect(classifyVexusC({ ivcMaxDiameterMm: 22, hepatic: 'mild', portalPulsatilityFraction: 65, renal: 'biphasic' }).grade).toBe(2);
    expect(classifyVexusC({ ivcMaxDiameterMm: 22, hepatic: 'severe', portalPulsatilityFraction: 65, renal: 'continuous' }).grade).toBe(3);
  });

  it('territorio ausente → intervalo compatible y estado incompleto', () => {
    const one = classifyVexusC({ ivcMaxDiameterMm: 25, hepatic: 'severe', portalPulsatilityFraction: 40, renal: 'not-assessed' });
    expect(one.grade).toBeNull();
    expect(one.gradeRange).toEqual([2, 3]);
    expect(one.status).toBe('incomplete');
    const two = classifyVexusC({ ivcMaxDiameterMm: 25, hepatic: 'severe', portalPulsatilityFraction: 80, renal: 'not-assessed' });
    expect(two.grade).toBe(3);
    expect(two.status).toBe('incomplete');
  });

  it('inversión sistólica renal queda fuera del esquema original (no cuenta como grave)', () => {
    const r = classifyVexusC({ ivcMaxDiameterMm: 25, hepatic: 'normal', portalPulsatilityFraction: 10, renal: 'reversal-out-of-scheme' });
    expect(r.severeCount).toBe(0);
    expect(r.missingCount).toBe(1);
    expect(r.gradeRange).toEqual([1, 2]);
  });

  it('señala proximidad al umbral en vez de redondear en silencio', () => {
    expect(
      classifyVexusC({ ivcMaxDiameterMm: 25, hepatic: 'normal', portalPulsatilityFraction: 49.6, renal: 'continuous' }).portalNearThreshold,
    ).toBe(true);
  });
});
