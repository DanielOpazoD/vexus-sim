import {
  IVC_NEAR_THRESHOLD_MM,
  IVC_THRESHOLD_MM,
  PF_MILD,
  PF_SEVERE,
  type HepaticPattern,
  type PortalClass,
  type RenalPattern,
  type Territory,
  type VexusContext,
  type VexusResult,
} from '../../vexus/classification';

/** Textos en español de los patrones y estados del clasificador (única fuente para consola y docente). */
export function statusText(s: VexusResult['status']): string {
  if (s === 'invalid-input') return 'entrada inválida: repetir medición';
  return s === 'complete' ? 'completo' : s === 'incomplete' ? 'incompleto' : 'VCI no medida';
}

export function renalText(p: RenalPattern): string {
  if (p === 'systolic-only') return 'solo S: fuera del esquema';
  if (p === 'indeterminate') return 'fases no resolubles';
  return p === 'continuous'
    ? 'continuo'
    : p === 'biphasic'
      ? 'bifásico (S+D)'
      : p === 'monophasic'
        ? 'monofásico (solo D)'
        : p === 'reversal-out-of-scheme'
          ? 'fuera del esquema'
          : 'no evaluado';
}

export function patternText(p: HepaticPattern): string {
  if (p === 'indeterminate') return 'indeterminado: fase no identificable';
  return p === 'normal' ? 'normal (S>D)' : p === 'mild' ? 'leve (S<D)' : p === 'severe' ? 'grave (S invertida)' : 'no evaluado';
}

export function portalText(c: PortalClass): string {
  if (c === 'invalid-input') return 'entrada inválida';
  return c === 'normal'
    ? 'normal'
    : c === 'mild'
      ? 'leve'
      : c === 'severe'
        ? 'grave'
        : c === 'not-applicable'
          ? 'no aplicable'
          : 'no evaluada';
}

/** El redondeo de presentación nunca debe cruzar un umbral de categoría. */
export function portalPulsatilityText(pf: number): string {
  if (!Number.isFinite(pf) || pf < 0) return 'n/a';
  const rounded = Number(pf.toFixed(1));
  for (const threshold of [PF_MILD, PF_SEVERE]) if (pf < threshold && rounded >= threshold) return `menos de ${threshold} %`;
  return `${pf.toFixed(1).replace('.', ',')} %`;
}

/**
 * Estado del resultado para el alumno (decisión 82): como `statusText`, salvo que con todo medido sea el contexto el que
 * deja fuera un hallazgo: «intervalo por el contexto» si el grado queda en intervalo y «con el contexto» si aun así sale
 * un grado (no «incompleto»: no falta ninguna medida). `withRenal: false` para el mVExUS, que no usa el riñón.
 */
export function resultStatusText(r: VexusResult, withRenal = true): string {
  if (r.status !== 'incomplete') return statusText(r.status);
  const unmeasured =
    r.hepaticClass === 'not-assessed' ||
    r.hepaticClass === 'indeterminate' ||
    r.portalClass === 'not-assessed' ||
    r.portalClass === 'not-applicable' ||
    (withRenal && !['continuous', 'biphasic', 'monophasic'].includes(r.renalClass));
  if (unmeasured) return 'incompleto';
  return r.grade !== null ? 'con el contexto' : 'intervalo por el contexto';
}

/** El grado o su intervalo («2», «0–2»), o «—» sin la VCI. */
export function gradeValueText(r: VexusResult): string {
  return r.grade !== null ? String(r.grade) : r.gradeRange ? `${r.gradeRange[0]}–${r.gradeRange[1]}` : '—';
}

/** Un confusor del contexto clínico: una casilla de la pestaña Medir (decisión 82). */
export type ContextFlag = keyof VexusContext;

/**
 * Rótulos de las casillas del contexto clínico, en su orden en la pestaña Medir. Es un `Record` sobre todas las claves
 * de `VexusContext`: un confusor nuevo en el clasificador sin rótulo aquí no compila.
 */
export const CONTEXT_LABELS: Readonly<Record<ContextFlag, string>> = {
  advancedCkd: 'ERC avanzada o diálisis',
  cirrhosis: 'Cirrosis',
  atrialFibrillation: 'Fibrilación auricular',
  noEcg: 'Sin ECG',
  positivePressureVentilation: 'Ventilación con presión positiva',
  raisedIntraAbdominalPressure: 'Presión intraabdominal alta',
  athlete: 'Deportista',
};
export const CONTEXT_FLAGS = Object.keys(CONTEXT_LABELS) as ContextFlag[];

/** Los confusores marcados con sus rótulos, o «ninguno». */
export function contextText(ctx: VexusContext): string {
  const on = CONTEXT_FLAGS.filter((f) => ctx[f] === true);
  return on.length ? on.map((f) => CONTEXT_LABELS[f]).join(' · ') : 'ninguno';
}

export function territoryText(t: Territory): string {
  return t === 'ivc' ? 'VCI' : t === 'hepatic' ? 'Suprahepática' : t === 'portal' ? 'Porta' : 'Renal';
}

/** Territorios que el contexto vuelve poco fiables: cuentan como no evaluados para el grado. */
export function excludedTerritories(r: VexusResult): Set<Territory> {
  return new Set(r.warnings.filter((w) => w.excluded).map((w) => w.territory));
}

/**
 * Líneas del resultado que añade el contexto clínico (decisión 82): el mVExUS sin riñón, la nota de la VCI a ±2 mm del
 * corte y un aviso por confusor con su territorio y su motivo («no fiable» si el territorio deja de contar; «aviso» si
 * solo avisa). HTML generado por el programa: los motivos son textos fijos del clasificador.
 */
export function contextResultLines(res: VexusResult, modified: VexusResult): string[] {
  const lines = [
    `<div>mVExUS (sin riñón): <b>${gradeValueText(modified)}</b> <span class="small">${resultStatusText(modified, false)}</span></div>`,
  ];
  if (res.ivcNearThreshold)
    lines.push(
      `<div class="small">VCI a ±${IVC_NEAR_THRESHOLD_MM} mm del corte de ${IVC_THRESHOLD_MM} mm: el umbral publicado no es único y el calibrador yerra ~2 mm; no la redondees.</div>`,
    );
  for (const w of res.warnings)
    lines.push(`<div class="ctx-warn"><b>${territoryText(w.territory)} · ${w.excluded ? 'no fiable' : 'aviso'}</b> — ${w.reason}</div>`);
  for (const issue of res.inputIssues)
    lines.push(`<div class="ctx-warn"><b>${territoryText(issue.territory)} · entrada inválida</b> — ${issue.reason}</div>`);
  return lines;
}
