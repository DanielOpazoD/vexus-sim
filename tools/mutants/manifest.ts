/**
 * Mutantes reproducibles (decisión 322, punto 8): un manifiesto por módulo, cada mutante con su reemplazo exacto, el
 * comportamiento que rompe y las pruebas focales que deben detectarlo. Sustituye los scripts de mutantes de cada ronda.
 */

export interface Mutant {
  /** Único entre todos los manifiestos; se usa en `--only`, logs e informe. */
  name: string;
  /** Texto exacto del módulo: debe aparecer una sola vez. */
  from: string;
  to: string;
  /** Qué comportamiento rompe (lo que las focales deben ver). */
  breaks: string;
  /** Archivos de prueba (`src/**\/*.test.ts`) que deben fallar con el mutante y pasar sin él. */
  tests: string[];
  /** Ronda o revisión en que se midió a mano. */
  origin: string;
}

export interface MutantManifest {
  /** Módulo que mutan todos sus mutantes, relativo a la raíz. */
  module: string;
  mutants: Mutant[];
}

export function occurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** Aplica un mutante: exige exactamente una aparición de `from`. Sin `String.replace`, que interpreta `$&`, `$1`… */
export function applyMutant(text: string, mutant: Pick<Mutant, 'name' | 'from' | 'to'>): string {
  const n = occurrences(text, mutant.from);
  if (n !== 1) throw new Error(`${mutant.name}: «from» aparece ${n} veces (se exige una)`);
  if (mutant.from === mutant.to) throw new Error(`${mutant.name}: «to» es igual a «from»`);
  const i = text.indexOf(mutant.from);
  return text.slice(0, i) + mutant.to + text.slice(i + mutant.from.length);
}

/**
 * Errores de los manifiestos contra el árbol actual: nombres repetidos o vacíos, módulos o pruebas inexistentes,
 * `from` ausente o duplicado. `read` devuelve null si el archivo no existe.
 */
export function manifestErrors(manifests: readonly MutantManifest[], read: (path: string) => string | null): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  const modules = new Set<string>();
  for (const m of manifests) {
    if (modules.has(m.module)) errors.push(`módulo con dos manifiestos: ${m.module}`);
    modules.add(m.module);
    const text = read(m.module);
    if (text === null) errors.push(`módulo inexistente: ${m.module}`);
    if (!m.mutants.length) errors.push(`manifiesto sin mutantes: ${m.module}`);
    for (const mutant of m.mutants) {
      if (!/^[\w.-]+$/.test(mutant.name)) errors.push(`nombre inválido: «${mutant.name}»`);
      if (names.has(mutant.name)) errors.push(`nombre repetido: ${mutant.name}`);
      names.add(mutant.name);
      if (!mutant.breaks.trim() || !mutant.origin.trim()) errors.push(`${mutant.name}: falta «breaks» u «origin»`);
      if (!mutant.tests.length) errors.push(`${mutant.name}: sin pruebas focales`);
      for (const t of mutant.tests)
        if (!/^src\/.+\.test\.ts$/.test(t) || read(t) === null) errors.push(`${mutant.name}: prueba focal inexistente ${t}`);
      if (text !== null) {
        const n = occurrences(text, mutant.from);
        if (n !== 1) errors.push(`${mutant.name}: «from» aparece ${n} veces en ${m.module} (se exige una)`);
        if (mutant.from === mutant.to) errors.push(`${mutant.name}: «to» es igual a «from»`);
      }
    }
  }
  return errors;
}

/** Selección por módulo (ruta o nombre de archivo sin `.ts`) y por nombre; un filtro que no encuentra nada es un error. */
export function selectMutants(
  manifests: readonly MutantManifest[],
  filter: { module?: string; only?: string[] },
): Array<{ module: string; mutant: Mutant }> {
  const base = (p: string) => p.split('/').pop()!.replace(/\.ts$/, '');
  const chosen = manifests.filter((m) => !filter.module || m.module === filter.module || base(m.module) === filter.module);
  if (filter.module && !chosen.length) throw new Error(`Sin manifiesto para el módulo ${filter.module}`);
  const out = chosen.flatMap((m) => m.mutants.map((mutant) => ({ module: m.module, mutant })));
  const only = filter.only ?? [];
  for (const name of only) if (!out.some((s) => s.mutant.name === name)) throw new Error(`Mutante desconocido: ${name}`);
  return only.length ? out.filter((s) => only.includes(s.mutant.name)) : out;
}
