import { describe, expect, it } from 'vitest';
import { CASES, CASE_IDS, findCase, isCaseId } from '../cases';
import { CASE_TEACHING } from '../cases/teaching';
import { CASE_VIGNETTES } from '../cases/vignettes';
import { validatePatient } from '../physiology/patientState';
import { VESSEL_IDS, VESSEL_META } from '../physiology/vessels';
import { contextWarnings } from '../vexus/classification';

describe('Registro de casos y metadatos de vasos (Fase 1)', () => {
  it('cada id del registro es el id de su paciente, sin duplicados, y todos validan', () => {
    expect(new Set(CASE_IDS).size).toBe(CASE_IDS.length);
    expect(CASES.map((c) => c.id)).toEqual(CASE_IDS);
    for (const id of CASE_IDS) {
      expect(findCase(id).id).toBe(id);
      expect(isCaseId(id)).toBe(true);
      expect(() => validatePatient(findCase(id))).not.toThrow();
    }
    expect(isCaseId('otro')).toBe(false);
  });

  it('cada caso tiene su semilla y su nombre, y ningún PatientState lleva un grado ni el contexto clínico', () => {
    // una semilla compartida daría a dos casos la misma variabilidad RR y el mismo moteado espectral
    expect(new Set(CASES.map((c) => c.seed)).size).toBe(CASES.length);
    expect(new Set(CASES.map((c) => c.label)).size).toBe(CASES.length);
    for (const c of CASES) {
      // el PatientState es la verdad latente: ni grado (guía §5) ni viñeta, confusores o trampa (decisión 82)
      const keys = JSON.stringify(Object.keys(c)).toLowerCase();
      for (const bad of ['vexus', 'grade', 'vignette', 'context', 'trap']) expect(keys, `${c.id}: ${bad}`).not.toContain(bad);
    }
  });

  it('cada vaso tiene sistema, tipo y ley de calibre coherentes', () => {
    for (const id of VESSEL_IDS) {
      const m = VESSEL_META[id];
      expect(m.kind).toBe(/Artery|aorta|celiac|^sma$/.test(id) ? 'artery' : 'vein');
      if (m.caliber !== 'fixed') expect(m.kind).toBe('vein');
    }
    expect(VESSEL_META.ivcSupra.caliber).toBe('ivc');
    expect(VESSEL_META.hvCommonTrunk.caliber).toBe('hepaticVein');
    expect(VESSEL_META.pvLeftMedial.caliber).toBe('portal');
    expect(VESSEL_META.interlobarVein2.system).toBe('interlobarVein');
  });
});

/**
 * Contexto clínico de los casos (decisión 82), fuera del PatientState: la viñeta, que ve el alumno (`vignettes.ts`), y
 * los confusores reales con la trampa, que solo ve el docente (`teaching.ts`).
 */
describe('Contexto clínico de los casos (decisión 82)', () => {
  it('cada caso del registro tiene su viñeta y sus notas del docente, y solo ellos', () => {
    expect(Object.keys(CASE_VIGNETTES).sort()).toEqual([...CASE_IDS].sort());
    expect(Object.keys(CASE_TEACHING).sort()).toEqual([...CASE_IDS].sort());
  });

  it('una viñeta corta por caso; las trampas llevan su explicación y su nombre lo dice', () => {
    for (const id of CASE_IDS) {
      const vignette = CASE_VIGNETTES[id];
      // corta: cabe en la pestaña Medir en unas pocas líneas (≤ 320 caracteres), y es una frase completa
      expect(vignette.length, id).toBeGreaterThan(60);
      expect(vignette.length, id).toBeLessThanOrEqual(320);
      expect(vignette.endsWith('.'), id).toBe(true);
      // dice cómo respira: la casilla «Ventilación con presión positiva» depende de ello
      expect(vignette, id).toMatch(/Respira espontáneamente|ventilación controlada/);
      const { trap } = CASE_TEACHING[id];
      const isTrap = findCase(id).label.startsWith('Trampa · ');
      expect(trap !== null, id).toBe(isTrap);
      if (trap) expect(trap.length, id).toBeGreaterThan(150);
    }
    // cuatro trampas: presión intraabdominal, IT grave, ventilación y cirrosis
    expect(CASE_IDS.filter((id) => CASE_TEACHING[id].trap !== null)).toHaveLength(4);
  });

  it('los confusores del contexto son del clasificador, marcados con true, y cada uno da su aviso', () => {
    for (const id of CASE_IDS) {
      const ctx = CASE_TEACHING[id].context;
      for (const [flag, on] of Object.entries(ctx)) {
        // el registro solo lista lo que el caso tiene (sin `false`): lo que no aparece, no lo tiene
        expect(on, `${id}.${flag}`).toBe(true);
        expect(contextWarnings({ [flag]: true }).length, `${id}.${flag} no es un confusor del clasificador`).toBeGreaterThan(0);
      }
    }
  });

  it('los confusores declarados coinciden con la fisiología del caso', () => {
    for (const id of CASE_IDS) {
      const p = findCase(id);
      const ctx = CASE_TEACHING[id].context;
      const tag = `${id}: ${JSON.stringify(ctx)}`;
      expect(ctx.atrialFibrillation === true, tag).toBe(p.rhythm === 'atrial-fibrillation');
      expect(ctx.positivePressureVentilation === true, tag).toBe(p.ventilation === 'positive-pressure');
      // hipertensión intraabdominal: presión sostenida ≥ 12 mmHg (definición de la WSACS)
      expect(ctx.raisedIntraAbdominalPressure === true, tag).toBe(p.intraAbdominalPressureMmHg >= 12);
      // la cirrosis del modelo es la resistencia intrahepática alta (el congestivo llega a 1,1; la trampa, 5)
      expect(ctx.cirrhosis === true, tag).toBe(p.liver.sinusoidalResistance >= 2);
      // el simulador siempre muestra el ECG: ningún caso puede declarar que falta
      expect(ctx.noEcg, tag).toBeUndefined();
    }
    expect(CASE_TEACHING['af-moderate-congestion'].context).toEqual({ atrialFibrillation: true });
  });
});
