import { describe, expect, it } from 'vitest';
import { CASES, CASE_IDS, findCase, isCaseId } from '../cases';
import { validatePatient } from '../physiology/patientState';
import { VESSEL_IDS, VESSEL_META } from '../physiology/vessels';

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
