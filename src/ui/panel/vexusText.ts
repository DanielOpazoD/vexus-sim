import type { HepaticPattern, RenalPattern, VexusResult } from '../../vexus/classification';

/** Textos en español de los patrones y estados del clasificador (única fuente para consola y docente). */
export function statusText(s: VexusResult['status']): string {
  return s === 'complete' ? 'completo' : s === 'incomplete' ? 'incompleto' : 'VCI no medida';
}

export function renalText(p: RenalPattern): string {
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
  return p === 'normal' ? 'normal (S>D)' : p === 'mild' ? 'leve (S<D)' : p === 'severe' ? 'grave (S invertida)' : 'no evaluado';
}
