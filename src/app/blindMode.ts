import { CASES } from '../cases';

/**
 * Modo alumno ciego (guía §17): el alumno no ve el diagnóstico. Los casos se muestran como
 * «Paciente A, B, C…» (orden del registro) y el nombre clínico solo en modo docente; el corte
 * ecográfico pierde los rótulos de estructuras y el navegador 3D los vasos (el calibre de la VCI
 * delata la congestión).
 */
export function caseDisplayLabel(caseId: string, teacher: boolean): string {
  const i = CASES.findIndex((c) => c.id === caseId);
  if (i < 0) return teacher ? caseId : 'Paciente';
  return teacher ? CASES[i].label : `Paciente ${String.fromCharCode(65 + i)}`;
}

/** La casilla «Docente» solo se ofrece en desarrollo o con `?docente` en la dirección. */
export function teacherToggleAllowed(isDev: boolean, search: string): boolean {
  return isDev || new URLSearchParams(search).has('docente');
}
