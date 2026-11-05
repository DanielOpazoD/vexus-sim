/**
 * Ejecutor de mutantes (decisión 322, punto 8): primero las focales sobre el árbol original (deben pasar), después cada
 * mutante aplicado solo, con sus focales, y la restauración byte a byte siempre (`finally`). Un diario en
 * `.cache/mutants/` guarda el original mientras el módulo está mutado: si el proceso muere, la siguiente ejecución lo
 * restaura antes de empezar. Este módulo no lanza Vitest: el ejecutor de pruebas se inyecta.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applyMutant, type Mutant } from './manifest';

export interface TestOutcome {
  exitCode: number | null;
  /** «archivo > nombre completo» de cada prueba fallida. */
  failed: string[];
  /** Archivos pedidos que no cargaron o no aparecen en el informe. */
  suiteErrors: string[];
  seconds: number;
  /** Fallo del propio ejecutor (no arrancó, interrupción, sin informe). */
  error: string | null;
}

export type MutantStatus = 'killed' | 'survived' | 'error';

export interface MutantResult {
  name: string;
  module: string;
  origin: string;
  breaks: string;
  tests: string[];
  status: MutantStatus;
  exitCode: number | null;
  seconds: number;
  failed: string[];
  error: string | null;
}

export interface JournalEntry {
  module: string;
  originalSha256: string;
  mutatedSha256: string;
  /** Bytes originales en base64. */
  backup: string;
}

export interface MutantRunnerDeps {
  read(path: string): Buffer;
  write(path: string, data: Buffer): void;
  runTests(tests: string[], label: string): Promise<TestOutcome>;
  journal: { save(entry: JournalEntry): void; clear(): void };
  log(line: string): void;
  interrupted(): boolean;
}

export const JOURNAL = '.cache/mutants/journal.json';
export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Muerto: alguna prueba falló. Sobrevive: todo pasó. Error: nada falló pero algo no cargó o el ejecutor falló. */
export function classify(o: TestOutcome): { status: MutantStatus; error: string | null } {
  if (o.error) return { status: 'error', error: o.error };
  if (o.failed.length) return { status: 'killed', error: null };
  if (o.exitCode === 0 && !o.suiteErrors.length) return { status: 'survived', error: null };
  return {
    status: 'error',
    error: o.suiteErrors.length ? `sin cargar: ${o.suiteErrors.join(', ')}` : `código ${o.exitCode} sin pruebas fallidas`,
  };
}

/** Lectura, escritura y diario sobre el disco real, relativos a `root`. */
export function fsDeps(root: string): Pick<MutantRunnerDeps, 'read' | 'write' | 'journal'> {
  const journal = join(root, JOURNAL);
  return {
    read: (path) => readFileSync(join(root, path)),
    write: (path, data) => writeFileSync(join(root, path), data),
    journal: {
      save: (entry) => {
        mkdirSync(dirname(journal), { recursive: true });
        writeFileSync(journal, JSON.stringify(entry) + '\n');
      },
      clear: () => rmSync(journal, { force: true }),
    },
  };
}

/**
 * Si una ejecución anterior murió con un módulo mutado, lo restaura. Devuelve qué hizo; lanza si el módulo ya no es ni el
 * original ni el mutado (alguien lo editó después: decide una persona).
 */
export function recoverJournal(root: string): string | null {
  const path = join(root, JOURNAL);
  if (!existsSync(path)) return null;
  const entry = JSON.parse(readFileSync(path, 'utf8')) as JournalEntry;
  const current = sha256(readFileSync(join(root, entry.module)));
  if (current === entry.mutatedSha256) {
    const original = Buffer.from(entry.backup, 'base64');
    if (sha256(original) !== entry.originalSha256) throw new Error(`Diario de mutantes corrupto: ${path}`);
    writeFileSync(join(root, entry.module), original);
    rmSync(path);
    return `restaurado ${entry.module} de una ejecución interrumpida`;
  }
  if (current === entry.originalSha256) {
    rmSync(path);
    return `diario retirado: ${entry.module} ya era el original`;
  }
  throw new Error(`${entry.module} cambió tras una ejecución interrumpida; compáralo con la copia del diario ${path}`);
}

export interface RunReport {
  baseline: { tests: string[]; passed: boolean; seconds: number; failed: string[]; error: string | null };
  results: MutantResult[];
  notRun: string[];
}

/** Línea base y mutantes en serie. Nunca deja un módulo mutado: restaura y comprueba los bytes tras cada mutante. */
export async function runMutants(selection: Array<{ module: string; mutant: Mutant }>, deps: MutantRunnerDeps): Promise<RunReport> {
  const tests = [...new Set(selection.flatMap((s) => s.mutant.tests))].sort();
  deps.log(`línea base: ${tests.length} archivos focales sobre el árbol original`);
  const b = await deps.runTests(tests, 'baseline');
  const bc = classify(b);
  const baseline = {
    tests,
    passed: bc.status === 'survived',
    seconds: b.seconds,
    failed: b.failed,
    error: bc.status === 'killed' ? `${b.failed.length} pruebas focales fallan sin mutante` : bc.error,
  };
  const report: RunReport = { baseline, results: [], notRun: [] };
  if (!baseline.passed) {
    report.notRun = selection.map((s) => s.mutant.name);
    return report;
  }
  for (const { module, mutant } of selection) {
    if (deps.interrupted()) {
      report.notRun.push(mutant.name);
      continue;
    }
    const base = { name: mutant.name, module, origin: mutant.origin, breaks: mutant.breaks, tests: mutant.tests };
    const original = deps.read(module);
    let mutated: string;
    try {
      mutated = applyMutant(original.toString('utf8'), mutant);
    } catch (error) {
      report.results.push({ ...base, status: 'error', exitCode: null, seconds: 0, failed: [], error: (error as Error).message });
      continue;
    }
    deps.journal.save({ module, originalSha256: sha256(original), mutatedSha256: sha256(mutated), backup: original.toString('base64') });
    let outcome: TestOutcome;
    try {
      deps.write(module, Buffer.from(mutated, 'utf8'));
      deps.log(`${mutant.name}: ${module} mutado; focales ${mutant.tests.join(' ')}`);
      outcome = await deps.runTests(mutant.tests, mutant.name);
    } catch (error) {
      outcome = { exitCode: null, failed: [], suiteErrors: [], seconds: 0, error: (error as Error).message };
    } finally {
      deps.write(module, original);
    }
    if (!deps.read(module).equals(original))
      throw new Error(`${module} no quedó restaurado tras ${mutant.name}; el diario conserva el original`);
    deps.journal.clear();
    const c = classify(outcome);
    report.results.push({
      ...base,
      status: c.status,
      exitCode: outcome.exitCode,
      seconds: outcome.seconds,
      failed: outcome.failed,
      error: c.error,
    });
    deps.log(`${mutant.name}: ${c.status}${outcome.failed.length ? ` (${outcome.failed.length} rojas)` : ''}`);
  }
  return report;
}
