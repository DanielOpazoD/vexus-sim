import { CASES, isCaseId } from '../cases';
import { CASE_VIGNETTES } from '../cases/vignettes';

/**
 * Modo alumno ciego (guía §17): el alumno no ve el diagnóstico. Los casos se muestran como
 * «Paciente A, B, C…» (orden del registro) y el nombre clínico solo en modo docente; el corte
 * ecográfico pierde los rótulos de estructuras y el navegador 3D los vasos (el calibre de la VCI
 * delata la congestión). Del contexto clínico (decisión 82) el alumno ve la viñeta; el nombre del
 * caso con sus confusores reales y la trampa los da `teacherNotes.ts`, que solo carga la pestaña
 * Docente (su propio chunk, en modo docente).
 */
export function caseDisplayLabel(caseId: string, teacher: boolean): string {
  const i = CASES.findIndex((c) => c.id === caseId);
  if (i < 0) return teacher ? caseId : 'Paciente';
  return teacher ? CASES[i].label : `Paciente ${String.fromCharCode(65 + i)}`;
}

/**
 * Viñeta del caso (decisión 82): lo que el operador sabe antes de medir. La ve también el alumno; no nombra el
 * diagnóstico ni el grado (`blindMode.test.ts`). Vacía para un caso desconocido.
 */
export function caseVignette(caseId: string): string {
  return isCaseId(caseId) ? CASE_VIGNETTES[caseId] : '';
}

/** La casilla «Docente» solo se ofrece en desarrollo o con `?docente` en la dirección. */
export function teacherToggleAllowed(isDev: boolean, search: string): boolean {
  return isDev || new URLSearchParams(search).has('docente');
}
