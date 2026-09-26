import { isCaseId } from '../cases';
import { CASE_TEACHING } from '../cases/teaching';
import type { VexusContext } from '../vexus/classification';
import { caseDisplayLabel } from './blindMode';

/** Lo que solo ve el docente de un caso: su nombre, los confusores reales y la explicación de la trampa. */
export interface CaseTeacherNotes {
  label: string;
  context: VexusContext;
  trap: string | null;
}

/**
 * Notas del docente (decisión 82); `null` para el alumno o para un caso desconocido. Solo la importa la pestaña
 * Docente, que se carga en su propio chunk en modo docente: el JS del alumno no lleva los confusores reales ni las
 * trampas (`codeSplitting.test.ts`).
 */
export function caseTeacherNotes(caseId: string, teacher: boolean): CaseTeacherNotes | null {
  if (!teacher || !isCaseId(caseId)) return null;
  const { context, trap } = CASE_TEACHING[caseId];
  return { label: caseDisplayLabel(caseId, true), context, trap };
}
