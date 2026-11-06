import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Capas de prueba (decisión 322, punto 7). Un archivo cuya PRIMERA línea es `// @tier slow` queda fuera de
 * `npm test` (la capa rápida, la que corre el gancho de push) y entra en `test:slow` / `test:all`. Así una prueba
 * pesada no se cuela en la capa rápida por omisión. `vite.config.ts` y las herramientas leen la misma regla.
 */
export const SLOW_MARKER = '// @tier slow';
export type TestTier = 'fast' | 'slow';

/** Gancho de push completo (formato, lint, tipos y capa rápida), medido en el equipo de trabajo sin carga ajena. */
export const HOOK_BUDGET_SECONDS = 180;
/** El informe está completo pero la carga no permite acreditar su presupuesto. Distinto de un fallo de pruebas. */
export const BUDGET_UNAVAILABLE_EXIT_CODE = 3;

/**
 * Carga máxima (media de 1 o 5 min) con la que un tiempo de pared vale para un presupuesto. El equipo de trabajo tiene 4
 * núcleos de rendimiento y 6 de eficiencia: con más carga, un proceso serial pasa parte del tiempo en núcleos de
 * eficiencia (la capa rápida con un trabajador tardó 541 s con carga media 12, frente a 395 s con carga 4,9). Por encima,
 * el presupuesto se declara no evaluable; nunca se da por cumplido ni por incumplido.
 */
export const TIMING_MAX_LOAD = 5;

/**
 * Un archivo de la capa rápida con un trabajador: el doble del más lento medido sobre `main` 8555a2c (decisión 322,
 * punto 7): `equivalenceSweep.test.ts`, 24,5 s, carga media 4,9, modo de bajo consumo. Por encima, la prueba es lenta:
 * se etiqueta `// @tier slow` o se aligera.
 */
export const FAST_FILE_BUDGET_MS = 49_000;

/** Todos los `*.test.ts` bajo `dir`, en rutas absolutas y orden estable. */
export function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...testFiles(p));
    else if (/\.test\.ts$/.test(f)) out.push(p);
  }
  return out;
}

export function tierOf(source: string): TestTier {
  return source.split('\n')[0].trim() === SLOW_MARKER ? 'slow' : 'fast';
}

export function testTierFiles(dir: string): Record<TestTier, string[]> {
  const tiers: Record<TestTier, string[]> = { fast: [], slow: [] };
  for (const file of testFiles(dir)) tiers[tierOf(readFileSync(file, 'utf8'))].push(file);
  return tiers;
}

/** Lo que usa este módulo del informe JSON de Vitest (`--reporter=json`). */
export interface VitestJsonReport {
  testResults: Array<{
    name: string;
    status: string;
    startTime: number;
    endTime: number;
    assertionResults: Array<{ status: string; duration?: number | null }>;
  }>;
}

export interface FileTiming {
  file: string;
  ms: number;
  tests: number;
  /** La prueba individual más lenta del archivo (el plazo de 60 s es por prueba). */
  slowestTestMs: number;
}

export interface TierTimings {
  files: FileTiming[];
  tests: number;
  /** Suma de las duraciones por archivo. */
  totalMs: number;
  /** Del primer inicio al último final. */
  wallMs: number;
  /** Ningún par de archivos se solapa: un solo trabajador, la condición en la que se mide el presupuesto por archivo. */
  serial: boolean;
}

/** Tiempos por archivo, del más lento al más rápido, con rutas relativas a `root`. */
export function tierTimings(report: VitestJsonReport, root: string): TierTimings {
  const files = report.testResults
    .map((r) => ({
      file: relative(root, r.name).replaceAll('\\', '/'),
      ms: r.endTime - r.startTime,
      tests: r.assertionResults.length,
      slowestTestMs: Math.max(0, ...r.assertionResults.map((a) => a.duration ?? 0)),
    }))
    .sort((a, b) => b.ms - a.ms || a.file.localeCompare(b.file));
  const spans = report.testResults.map((r) => [r.startTime, r.endTime] as const).sort((a, b) => a[0] - b[0]);
  // Holgura de 1 ms: Vitest redondea de forma distinta el final de un archivo y el inicio del siguiente.
  const serial = spans.every((s, i) => i === 0 || s[0] >= spans[i - 1][1] - 1);
  return {
    files,
    tests: files.reduce((n, f) => n + f.tests, 0),
    totalMs: files.reduce((n, f) => n + f.ms, 0),
    wallMs: spans.length ? Math.max(...spans.map((s) => s[1])) - spans[0][0] : 0,
    serial,
  };
}

/**
 * Violaciones de una capa sobre su informe completo: archivos que faltan o sobran respecto a la capa y, si se da
 * `fileBudgetMs` (capa rápida), informes paralelos (sus tiempos por archivo dependen del reparto entre núcleos
 * rendimiento/eficiencia) y archivos por encima del presupuesto.
 */
export function tierBudgetViolations(timings: TierTimings, expected: readonly string[], fileBudgetMs: number | null): string[] {
  const out: string[] = [];
  const seen = new Set(timings.files.map((f) => f.file));
  for (const file of expected) if (!seen.has(file)) out.push(`falta en el informe: ${file}`);
  const wanted = new Set(expected);
  for (const file of seen) if (!wanted.has(file)) out.push(`no pertenece a la capa: ${file}`);
  if (seen.size !== timings.files.length) out.push('archivo repetido en el informe');
  if (fileBudgetMs === null) return out;
  if (!timings.serial) out.push('informe paralelo: el presupuesto por archivo se mide con un trabajador (VITEST_MAX_WORKERS=1)');
  if (!(fileBudgetMs > 0)) return [...out, 'presupuesto por archivo sin medir'];
  for (const f of timings.files)
    if (f.ms > fileBudgetMs) out.push(`${f.file}: ${(f.ms / 1000).toFixed(1)} s > ${(fileBudgetMs / 1000).toFixed(1)} s por archivo`);
  return out;
}
