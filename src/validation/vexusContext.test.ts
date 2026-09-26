import { describe, expect, it } from 'vitest';
import { IVC_NEAR_THRESHOLD_MM, IVC_THRESHOLD_MM, classifyModifiedVexus, classifyVexusC, contextWarnings } from '../vexus/classification';

/**
 * Fiabilidad por el contexto clínico, VCI cerca del umbral y mVExUS (decisión 79; revisión de la literatura de VExUS
 * del 26-09-2026): un territorio que el contexto vuelve poco fiable cuenta como no evaluado para el intervalo de
 * grados, y el resultado dice por qué.
 */
const congested = { ivcMaxDiameterMm: 26, hepatic: 'severe', portalPulsatilityFraction: 70, renal: 'monophasic' } as const;

describe('VExUS con el contexto clínico (decisión 79)', () => {
  it('sin contexto, la clasificación de siempre y sin avisos', () => {
    const r = classifyVexusC(congested);
    expect(r.grade).toBe(3);
    expect(r.warnings).toEqual([]);
    expect(classifyVexusC(congested, {})).toEqual(r);
  });

  it('ERC avanzada: el territorio renal no cuenta, y un patrón monofásico no basta para el grado 3', () => {
    const renalOnly = { ivcMaxDiameterMm: 24, hepatic: 'mild', portalPulsatilityFraction: 60, renal: 'monophasic' } as const;
    expect(classifyVexusC(renalOnly).grade).toBe(3);
    const r = classifyVexusC(renalOnly, { advancedCkd: true });
    expect(r.gradeRange).toEqual([2, 3]);
    expect(r.grade).toBeNull();
    expect(r.renalClass).toBe('monophasic'); // se informa lo observado
    expect(r.warnings).toEqual([expect.objectContaining({ territory: 'renal', excluded: true })]);
  });

  it('cirrosis: porta y suprahepática no cuentan; solo el riñón decide', () => {
    const r = classifyVexusC(congested, { cirrhosis: true });
    expect(r.gradeRange).toEqual([2, 3]);
    expect(r.warnings.map((w) => w.territory).sort()).toEqual(['hepatic', 'portal']);
  });

  it('deportista: la porta pulsátil no sube el grado por sí sola', () => {
    const r = classifyVexusC(
      { ivcMaxDiameterMm: 21, hepatic: 'normal', portalPulsatilityFraction: 55, renal: 'continuous' },
      { athlete: true },
    );
    expect(r.gradeRange).toEqual([1, 2]);
  });

  it('FA, sin ECG o con ventilación: avisan pero no quitan el territorio', () => {
    for (const ctx of [{ atrialFibrillation: true }, { noEcg: true }, { positivePressureVentilation: true }]) {
      const r = classifyVexusC(congested, ctx);
      expect(r.grade).toBe(3);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].excluded).toBe(false);
    }
  });

  it('presión intraabdominal alta: una VCI pequeña no cierra en grado 0', () => {
    const small = { ...congested, ivcMaxDiameterMm: 14 };
    expect(classifyVexusC(small).grade).toBe(0);
    const r = classifyVexusC(small, { raisedIntraAbdominalPressure: true });
    expect(r.grade).toBeNull();
    expect(r.gradeRange).toEqual([0, 3]);
    expect(r.status).toBe('incomplete');
    expect(r.warnings[0].territory).toBe('ivc');
    // con la VCI dilatada no cambia nada
    expect(classifyVexusC(congested, { raisedIntraAbdominalPressure: true }).grade).toBe(3);
  });

  it('VCI a ±2 mm del umbral: se avisa, no se redondea', () => {
    for (const d of [IVC_THRESHOLD_MM - IVC_NEAR_THRESHOLD_MM, 19.5, 20, 21.9, IVC_THRESHOLD_MM + IVC_NEAR_THRESHOLD_MM])
      expect(classifyVexusC({ ...congested, ivcMaxDiameterMm: d }).ivcNearThreshold, `${d}`).toBe(true);
    for (const d of [17.9, 22.1, 30]) expect(classifyVexusC({ ...congested, ivcMaxDiameterMm: d }).ivcNearThreshold, `${d}`).toBe(false);
  });

  it('los avisos nombran el territorio y el motivo', () => {
    const all = contextWarnings({
      advancedCkd: true,
      cirrhosis: true,
      noEcg: true,
      atrialFibrillation: true,
      positivePressureVentilation: true,
      raisedIntraAbdominalPressure: true,
      athlete: true,
    });
    expect(all.length).toBe(8);
    for (const w of all) expect(w.reason.length).toBeGreaterThan(20);
  });
});

describe('mVExUS sin riñón (Martin 2025)', () => {
  it('VCI y las dos venas hepáticas: 0 graves → 1, 1 → 2, 2 → 3; el riñón no cuenta', () => {
    expect(classifyModifiedVexus({ ivcMaxDiameterMm: 24, hepatic: 'mild', portalPulsatilityFraction: 40 }).grade).toBe(1);
    expect(classifyModifiedVexus({ ivcMaxDiameterMm: 24, hepatic: 'severe', portalPulsatilityFraction: 40 }).grade).toBe(2);
    const r = classifyModifiedVexus({ ivcMaxDiameterMm: 24, hepatic: 'severe', portalPulsatilityFraction: 80 });
    expect(r.grade).toBe(3);
    expect(r.status).toBe('complete');
    expect(r.renalClass).toBe('not-assessed');
    expect(classifyModifiedVexus({ ivcMaxDiameterMm: 18, hepatic: 'severe', portalPulsatilityFraction: 80 }).grade).toBe(0);
    // con una vena sin evaluar, intervalo
    expect(classifyModifiedVexus({ ivcMaxDiameterMm: 24, hepatic: 'not-assessed', portalPulsatilityFraction: 80 }).gradeRange).toEqual([
      2, 3,
    ]);
    // la ERC avanzada no cambia el mVExUS (no usa el riñón)
    expect(
      classifyModifiedVexus({ ivcMaxDiameterMm: 24, hepatic: 'severe', portalPulsatilityFraction: 80 }, { advancedCkd: true }).warnings,
    ).toEqual([]);
  });
});
