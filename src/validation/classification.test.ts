import { describe, expect, it } from 'vitest';
import {
  classifyPortal,
  classifyVexusC,
  hepaticPatternFromPeaks,
  portalPulsatilityFraction,
  renalPatternFromPeaks,
  type HepaticPattern,
  type RenalPattern,
} from '../vexus/classification';

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

  it('PF conserva los límites matemáticos y rechaza velocidades no finitas', () => {
    for (const [vMin, pf] of [
      [16, 20],
      [14, 30],
      [10, 50],
      [-5, 125],
    ]) {
      expect(portalPulsatilityFraction(20, vMin)).toBe(pf);
    }
    for (const [vMax, vMin] of [
      [0, 0],
      [Infinity, 10],
      [20, Infinity],
      [20, -Infinity],
      [20, Number.NaN],
    ]) {
      expect(portalPulsatilityFraction(vMax, vMin)).toBeNaN();
    }
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

  it('tabla completa: de picos medidos a grado en las 27 combinaciones con VCI dilatada', () => {
    const HEP: Record<string, [number, number]> = { normal: [28, 18], mild: [15, 24], severe: [-6, 22] };
    // PF = 20, 30 EXACTO y 50 EXACTO: los dos umbrales inclusivos quedan cubiertos
    const POR: Record<string, [number, number]> = { normal: [20, 16], mild: [20, 14], severe: [20, 10] };
    const REN: Record<string, [number, number, number]> = { continuous: [20, 18, 12], biphasic: [15, 18, 0], monophasic: [2, 18, 0] };
    for (const [hName, [hs, hd]] of Object.entries(HEP)) {
      for (const [pName, [pmax, pmin]] of Object.entries(POR)) {
        for (const [rName, [rs, rd, rmin]] of Object.entries(REN)) {
          const hepatic: HepaticPattern = hepaticPatternFromPeaks(hs, hd);
          const renal: RenalPattern = renalPatternFromPeaks(rs, rd, rmin);
          const pf = portalPulsatilityFraction(pmax, pmin);
          expect(hepatic).toBe(hName);
          expect(renal).toBe(rName);
          expect(classifyPortal(pf)).toBe(pName);
          const res = classifyVexusC({ ivcMaxDiameterMm: 22, hepatic, portalPulsatilityFraction: pf, renal });
          const severe = (hName === 'severe' ? 1 : 0) + (pName === 'severe' ? 1 : 0) + (rName === 'monophasic' ? 1 : 0);
          expect(res.grade).toBe(1 + Math.min(2, severe));
          expect(res.status).toBe('complete');
          expect(res.gradeRange).toEqual([res.grade, res.grade]);
          expect(res.missingCount).toBe(0);
        }
      }
    }
  });

  // VExUS renal: continuo es que el flujo no llegue a la línea de base, por pulsátil que sea. La regla
  // antigua (mínimo ≥ 30 % del máximo) llamaba bifásico o monofásico a un flujo que nunca se detiene
  // y, con S pequeña, sumaba un componente grave al grado.
  it('renal: un flujo pulsátil que no se interrumpe es continuo y no suma al grado', () => {
    expect(renalPatternFromPeaks(20, 18, 4)).toBe('continuous');
    expect(renalPatternFromPeaks(18, 20, 4)).toBe('continuous');
    expect(renalPatternFromPeaks(5, 20, 4)).toBe('continuous');
    const g = classifyVexusC({
      ivcMaxDiameterMm: 25,
      hepatic: 'normal',
      portalPulsatilityFraction: 10,
      renal: renalPatternFromPeaks(5, 20, 4),
    });
    expect(g.severeCount).toBe(0);
    expect(g.grade).toBe(1);
    // con interrupción, S decide entre bifásico y monofásico
    expect(renalPatternFromPeaks(20, 18, 0.5)).toBe('biphasic');
    expect(renalPatternFromPeaks(2, 18, 0.5)).toBe('monophasic');
    expect(renalPatternFromPeaks(5, 20, 1.9)).toBe('monophasic');
  });

  it('fronteras: VCI 20 mm inclusiva, VCI ausente, VCI normal cierra el caso aunque falte todo, porta hepatófuga', () => {
    const normal = { hepatic: 'normal' as const, portalPulsatilityFraction: 10, renal: 'continuous' as const };
    expect(classifyVexusC({ ivcMaxDiameterMm: 20, ...normal }).grade).toBe(1);
    expect(classifyVexusC({ ivcMaxDiameterMm: 19.999, ...normal }).grade).toBe(0);
    for (const ivc of [null, Number.NaN]) {
      const r = classifyVexusC({ ivcMaxDiameterMm: ivc, ...normal });
      expect(r.grade).toBeNull();
      expect(r.gradeRange).toBeNull();
      expect(r.status).toBe('ivc-not-assessed');
      expect(r.ivcDilated).toBeNull();
    }
    const closed = classifyVexusC({
      ivcMaxDiameterMm: 18,
      hepatic: 'not-assessed',
      portalPulsatilityFraction: null,
      renal: 'not-assessed',
    });
    expect(closed.grade).toBe(0);
    expect(closed.status).toBe('complete');
    expect(closed.missingCount).toBe(3);
    const hepatofugal = classifyVexusC({
      ivcMaxDiameterMm: 22,
      hepatic: 'normal',
      portalPulsatilityFraction: portalPulsatilityFraction(-8, -8),
      renal: 'continuous',
    });
    expect(hepatofugal.portalClass).toBe('not-applicable');
    expect(hepatofugal.grade).toBeNull();
    expect(hepatofugal.gradeRange).toEqual([1, 2]);
    expect(hepatofugal.status).toBe('incomplete');
    // fronteras de los patrones: interrupción = mínimo ≤ max(2 cm/s, 10 % del máximo); S ≥ 30 % de D
    expect(renalPatternFromPeaks(10, 15, 2.001)).toBe('continuous');
    expect(renalPatternFromPeaks(10, 15, 2)).toBe('biphasic');
    expect(renalPatternFromPeaks(40, 30, 4.001)).toBe('continuous');
    expect(renalPatternFromPeaks(40, 30, 4)).toBe('biphasic');
    expect(renalPatternFromPeaks(6, 20, 0)).toBe('biphasic');
    expect(renalPatternFromPeaks(5.999, 20, 0)).toBe('monophasic');
    expect(renalPatternFromPeaks(15, 18, -3.6)).toBe('biphasic');
    expect(renalPatternFromPeaks(15, 18, -3.61)).toBe('reversal-out-of-scheme');
    expect(renalPatternFromPeaks(-5, -2, -8)).toBe('not-assessed');
    expect(hepaticPatternFromPeaks(0, 20)).toBe('severe');
    expect(portalPulsatilityFraction(20, 20)).toBe(0);
    for (const [pf, near] of [
      [29, true],
      [31, true],
      [49, true],
      [51, true],
      [28.99, false],
      [31.01, false],
    ] as [number, boolean][]) {
      expect(
        classifyVexusC({ ivcMaxDiameterMm: 22, hepatic: 'normal', portalPulsatilityFraction: pf, renal: 'continuous' }).portalNearThreshold,
      ).toBe(near);
    }
  });
});
