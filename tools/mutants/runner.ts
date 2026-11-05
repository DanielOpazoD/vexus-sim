/**
 * Ejecutor de mutantes (decisión 322, punto 8): primero las focales sobre el árbol original (deben pasar), después cada
 * mutante aplicado solo, con sus focales, y la restauración byte a byte. Un diario en `.cache/mutants/` guarda el original
 * mientras el módulo está mutado: si el proceso muere, la siguiente ejecución lo restaura antes de empezar. Un cerrojo con
 * el pid impide dos ejecuciones a la vez en el mismo checkout. Si alguien edita el módulo durante un mutante, no se pisa
 * la edición: se guarda en `.cache/mutants/rescued/` y la corrida se detiene. Este módulo no lanza Vitest: el ejecutor de
 * pruebas se inyecta.
 */
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { applyMutant, type Mutant } from './manifest';

export interface TestOutcome {
  exitCode: number | null;
  /** «archivo > nombre completo» de cada prueba fallida. */
  failed: string[];
  /** Primera línea del primer mensaje de error de cada prueba fallida, en el orden de `failed`. */
  failureMessages: string[];
  /** Archivos pedidos que no cargaron o no aparecen en el informe. */
  suiteErrors: string[];
  seconds: number;
  /** Fallo del propio ejecutor (no arrancó, interrupción, informe ausente o ilegible). */
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
  failureMessages: string[];
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
  /** Guarda una edición ajena del módulo y devuelve dónde quedó. */
  rescue(path: string, data: Buffer): string;
  runTests(tests: string[], label: string): Promise<TestOutcome>;
  journal: { save(entry: JournalEntry): void; clear(): void };
  log(line: string): void;
  interrupted(): boolean;
}

export const JOURNAL = '.cache/mutants/journal.json';
export const LOCK = '.cache/mutants/lock.json';
export const RESCUED = '.cache/mutants/rescued';
export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Errores de ejecución de JavaScript: una focal que sólo cae por uno de éstos no ha probado ninguna aserción. */
export const RUNTIME_ERROR = /^(TypeError|ReferenceError|RangeError|SyntaxError|EvalError|URIError)\b/;

/**
 * Muerto: alguna aserción falló. Sobrevive: todo pasó. Error: el ejecutor falló, algo no cargó, o todas las pruebas rojas
 * cayeron por excepciones de ejecución (el mutante rompe la ejecución, no un comportamiento comprobado).
 */
export function classify(o: TestOutcome): { status: MutantStatus; error: string | null } {
  if (o.error) return { status: 'error', error: o.error };
  if (o.failed.length) {
    const runtime = o.failureMessages.length === o.failed.length && o.failureMessages.every((m) => RUNTIME_ERROR.test(m));
    if (runtime)
      return {
        status: 'error',
        error: `sólo excepciones de ejecución en las focales (${o.failureMessages[0].split(':')[0]}): no se comprobó ninguna aserción`,
      };
    return { status: 'killed', error: null };
  }
  if (o.exitCode === 0 && !o.suiteErrors.length) return { status: 'survived', error: null };
  return {
    status: 'error',
    error: o.suiteErrors.length ? `sin cargar: ${o.suiteErrors.join(', ')}` : `código ${o.exitCode} sin pruebas fallidas`,
  };
}

interface VitestReport {
  testResults: Array<{
    name: string;
    status: string;
    assertionResults: Array<{ status: string; fullName: string; failureMessages?: string[] }>;
  }>;
}

/**
 * Del informe JSON de Vitest al resultado de una corrida. Nunca lanza: un informe ausente, ilegible o sin la estructura
 * esperada es un error del ejecutor, y el módulo se restaura igual.
 */
export function outcomeFromReport(
  raw: string | null,
  exitCode: number | null,
  tests: string[],
  root: string,
): Omit<TestOutcome, 'seconds'> {
  const fail = (error: string) => ({ exitCode, failed: [], failureMessages: [], suiteErrors: [], error });
  if (raw === null) return fail('Vitest no escribió su informe');
  let json: VitestReport;
  try {
    json = JSON.parse(raw) as VitestReport;
  } catch (error) {
    return fail(`informe de Vitest ilegible: ${(error as Error).message}`);
  }
  if (!Array.isArray(json?.testResults) || json.testResults.some((r) => !Array.isArray(r?.assertionResults) || typeof r.name !== 'string'))
    return fail('informe de Vitest sin la estructura esperada');
  const rel = (p: string) => relative(root, p).replaceAll('\\', '/');
  const failed: string[] = [],
    failureMessages: string[] = [];
  for (const r of json.testResults)
    for (const a of r.assertionResults)
      if (a.status === 'failed') {
        failed.push(`${rel(r.name)} > ${a.fullName}`);
        failureMessages.push((a.failureMessages?.[0] ?? '').split('\n')[0].slice(0, 300));
      }
  const seen = new Set(json.testResults.map((r) => rel(r.name)));
  const suiteErrors = [
    ...json.testResults
      .filter((r) => r.status === 'failed' && !r.assertionResults.some((a) => a.status === 'failed'))
      .map((r) => rel(r.name)),
    ...tests.filter((t) => !seen.has(t)),
  ];
  return { exitCode, failed, failureMessages, suiteErrors, error: null };
}

/** Lectura, escritura, rescate y diario sobre el disco real, relativos a `root`. */
export function fsDeps(root: string): Pick<MutantRunnerDeps, 'read' | 'write' | 'rescue' | 'journal'> {
  const journal = join(root, JOURNAL);
  return {
    read: (path) => readFileSync(join(root, path)),
    write: (path, data) => writeFileSync(join(root, path), data),
    rescue: (path, data) => {
      const target = join(root, RESCUED, `${path.replaceAll('/', '__')}.${Date.now()}.rescued`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
      return relative(root, target);
    },
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

/** ¿Sigue vivo el proceso? EPERM también es vivo (de otro usuario). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** pid del cerrojo, o null si falta o no se puede leer (un cerrojo ilegible se trata como abandonado). */
function lockHolder(path: string): number | null {
  if (!existsSync(path)) return null;
  try {
    const pid = (JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown }).pid;
    return typeof pid === 'number' ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Una sola ejecución con mutaciones a la vez por checkout: crea el cerrojo de forma exclusiva con el pid. Un cerrojo de un
 * proceso muerto se retira; uno vivo hace fallar. Devuelve la liberación (sólo borra un cerrojo propio).
 */
export function acquireLock(root: string, pid = process.pid, alive = pidAlive): () => void {
  const path = join(root, LOCK);
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, JSON.stringify({ pid, startedUtc: new Date().toISOString() }) + '\n');
      closeSync(fd);
      return () => {
        if (lockHolder(path) === pid) rmSync(path, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = lockHolder(path);
      if (holder !== null && holder !== pid && alive(holder))
        throw new Error(`Otra ejecución de mutantes sigue en curso en este checkout (pid ${holder}); si no es así, borra ${LOCK}`, {
          cause: error,
        });
      rmSync(path, { force: true });
    }
  }
  throw new Error(`No se pudo tomar el cerrojo ${LOCK}`);
}

export interface RunReport {
  baseline: { tests: string[]; passed: boolean; seconds: number; failed: string[]; error: string | null };
  results: MutantResult[];
  notRun: string[];
  /** La corrida se detuvo antes de terminar (módulo editado durante un mutante). */
  aborted: string | null;
}

/**
 * Línea base y mutantes en serie. Nunca deja un módulo mutado: tras cada mutante restaura el original y comprueba los
 * bytes. Si el módulo ya no es el mutante aplicado (alguien lo editó), no lo pisa: guarda la edición, conserva el diario
 * con el original y se detiene.
 */
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
  const report: RunReport = { baseline, results: [], notRun: [], aborted: null };
  if (!baseline.passed) {
    report.notRun = selection.map((s) => s.mutant.name);
    return report;
  }
  for (const [index, { module, mutant }] of selection.entries()) {
    if (deps.interrupted()) {
      report.notRun.push(mutant.name);
      continue;
    }
    const base = { name: mutant.name, module, origin: mutant.origin, breaks: mutant.breaks, tests: mutant.tests };
    const original = deps.read(module);
    let mutated: Buffer;
    try {
      mutated = Buffer.from(applyMutant(original.toString('utf8'), mutant), 'utf8');
    } catch (error) {
      report.results.push({
        ...base,
        status: 'error',
        exitCode: null,
        seconds: 0,
        failed: [],
        failureMessages: [],
        error: (error as Error).message,
      });
      continue;
    }
    deps.journal.save({ module, originalSha256: sha256(original), mutatedSha256: sha256(mutated), backup: original.toString('base64') });
    let outcome: TestOutcome;
    let wrote = false;
    try {
      deps.write(module, mutated);
      wrote = true;
      deps.log(`${mutant.name}: ${module} mutado; focales ${mutant.tests.join(' ')}`);
      outcome = await deps.runTests(mutant.tests, mutant.name);
    } catch (error) {
      outcome = { exitCode: null, failed: [], failureMessages: [], suiteErrors: [], seconds: 0, error: (error as Error).message };
    }
    let current: Buffer | null;
    try {
      current = deps.read(module);
    } catch {
      current = null;
    }
    if (current === null || (!current.equals(mutated) && !current.equals(original))) {
      // Una edición ajena durante el mutante: no se pisa. El diario conserva el original sin mutante.
      const rescued = current === null ? null : deps.rescue(module, current);
      report.aborted =
        `${module} cambió durante «${mutant.name}»: no se sobrescribe. ` +
        (rescued ? `La edición queda en el módulo y en ${rescued}; ` : 'El módulo ya no existe; ') +
        `el original sin mutante está en ${JOURNAL}. Revisa git diff antes de seguir.`;
      report.results.push({
        ...base,
        status: 'error',
        exitCode: outcome.exitCode,
        seconds: outcome.seconds,
        failed: [],
        failureMessages: [],
        error: report.aborted,
      });
      report.notRun.push(...selection.slice(index + 1).map((s) => s.mutant.name));
      return report;
    }
    if (!current.equals(original)) deps.write(module, original);
    if (!deps.read(module).equals(original))
      throw new Error(`${module} no quedó restaurado tras ${mutant.name}; el diario conserva el original`);
    deps.journal.clear();
    // Escrito el mutante, el módulo volvió al original durante la corrida (p. ej. un checkout ajeno): las focales no
    // probaron el mutante entero; el resultado no vale.
    if (wrote && current.equals(original) && !outcome.error)
      outcome = { ...outcome, error: `${module} volvió al original durante la corrida: el resultado no vale` };
    const c = classify(outcome);
    report.results.push({
      ...base,
      status: c.status,
      exitCode: outcome.exitCode,
      seconds: outcome.seconds,
      failed: outcome.failed,
      failureMessages: outcome.failureMessages,
      error: c.error,
    });
    deps.log(`${mutant.name}: ${c.status}${outcome.failed.length ? ` (${outcome.failed.length} rojas)` : ''}`);
  }
  return report;
}
