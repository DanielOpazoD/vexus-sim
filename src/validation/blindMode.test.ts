import { describe, expect, it } from 'vitest';
import { caseDisplayLabel, teacherToggleAllowed } from '../app/blindMode';
import { CASES } from '../cases';

/** Modo alumno ciego (guía §17): el alumno no ve el diagnóstico en el nombre del caso. */
describe('Modo alumno ciego', () => {
  it('el alumno ve «Paciente A, B, C…» en el orden del registro; el docente, el nombre clínico', () => {
    CASES.forEach((c, i) => {
      const student = caseDisplayLabel(c.id, false);
      expect(student).toBe(`Paciente ${String.fromCharCode(65 + i)}`);
      // ninguna palabra del nombre clínico se filtra al alumno
      for (const word of c.label.split(/[\s·()]+/).filter((w) => w.length > 3)) expect(student).not.toContain(word);
      expect(caseDisplayLabel(c.id, true)).toBe(c.label);
    });
    expect(caseDisplayLabel('desconocido', false)).toBe('Paciente');
  });

  it('la casilla «Docente» solo se ofrece en desarrollo o con ?docente', () => {
    expect(teacherToggleAllowed(true, '')).toBe(true);
    expect(teacherToggleAllowed(false, '')).toBe(false);
    expect(teacherToggleAllowed(false, '?e2e=1')).toBe(false);
    expect(teacherToggleAllowed(false, '?e2e=1&docente')).toBe(true);
  });
});
