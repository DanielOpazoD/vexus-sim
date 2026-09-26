import { describe, expect, it } from 'vitest';
import { caseDisplayLabel, caseVignette, teacherToggleAllowed } from '../app/blindMode';
import { caseTeacherNotes } from '../app/teacherNotes';
import { CASES, CASE_IDS } from '../cases';
import { CASE_TEACHING } from '../cases/teaching';
import { CASE_VIGNETTES } from '../cases/vignettes';

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

/**
 * Casos trampa (decisión 82): la viñeta la ve el alumno; el nombre del caso, los confusores reales y la explicación de
 * la trampa, solo el docente.
 */
describe('Modo alumno ciego: viñeta y notas del docente (decisión 82)', () => {
  it('la viñeta no nombra el diagnóstico ni el grado ni la trampa', () => {
    // lo que respondería la pregunta del caso: el grado, la congestión (o su ausencia), la trampa o la PAD
    const answers = /vexus|grado|congesti|trampa|falso|sobreestim|subestim|euvol|\bPAD\b|presión auricular|presión venosa central/i;
    for (const id of CASE_IDS) {
      const v = caseVignette(id);
      expect(v, id).toBe(CASE_VIGNETTES[id]);
      expect(v, id).not.toMatch(answers);
    }
    expect(caseVignette('desconocido')).toBe('');
  });

  it('el nombre, los confusores reales y la trampa solo llegan al docente', () => {
    for (const c of CASES) {
      expect(caseTeacherNotes(c.id, false), c.id).toBeNull();
      const notes = caseTeacherNotes(c.id, true)!;
      const teaching = CASE_TEACHING[c.id as keyof typeof CASE_TEACHING];
      expect(notes).toEqual({ label: c.label, context: teaching.context, trap: teaching.trap });
    }
    expect(caseTeacherNotes('desconocido', true)).toBeNull();
  });
});
