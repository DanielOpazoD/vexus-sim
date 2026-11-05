import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { feedbackGitEnvironment } from '../../tools/workspace/feedbackPlan';
import { applyMutant, manifestErrors, selectMutants, type MutantManifest } from '../../tools/mutants/manifest';
import { MANIFESTS } from '../../tools/mutants/manifests';
import { fsDeps, JOURNAL, recoverJournal, runMutants, sha256, type TestOutcome } from '../../tools/mutants/runner';

/** Ejecutor de mutantes de la decisión 322 (punto 8) en un repositorio temporal con un ejecutor de pruebas falso. */
const ORIGINAL = 'export const a = 1;\nexport const b = 2;\n// $& no es un patrón\n';
const mutant = (name: string, from: string, to: string) => ({
  name,
  from,
  to,
  breaks: 'algo',
  tests: ['src/m.test.ts'],
  origin: 'sintético',
});
const manifest: MutantManifest = {
  module: 'src/m.ts',
  mutants: [
    mutant('muere', 'export const a = 1;', 'export const a = 9;'),
    mutant('sobrevive', 'export const b = 2;', 'export const b = 3;'),
    mutant('explota', 'export const a = 1;', 'export const a = 7;'),
    mutant('ausente', 'export const c = 3;', ''),
    mutant('duplicado', 'export const', 'const'),
  ],
};

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'vexus-mutants-'));
  const env = feedbackGitEnvironment();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env });
  git('init', '-q');
  git('config', 'user.name', 'Mutantes');
  git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/m.ts'), ORIGINAL);
  writeFileSync(join(root, 'src/m.test.ts'), '// prueba focal sintética\n');
  writeFileSync(join(root, '.gitignore'), '.cache/\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  return { root, git, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** «Pruebas» que leen el módulo del disco: fallan si ven `a = 9`; `explota` hace fallar al propio ejecutor. */
function fakeTests(root: string, calls: string[]) {
  return (tests: string[], label: string): Promise<TestOutcome> => {
    calls.push(label);
    if (label === 'explota') return Promise.reject(new Error('el ejecutor se cayó'));
    const text = readFileSync(join(root, 'src/m.ts'), 'utf8');
    const failed = text.includes('a = 9') ? ['src/m.test.ts > a vale 1'] : [];
    return Promise.resolve({ exitCode: failed.length ? 1 : 0, failed, suiteErrors: [], seconds: 0.1, error: null });
  };
}

describe('Mutantes reproducibles', () => {
  it('aplica una sola aparición exacta, sin patrones de reemplazo, y rechaza ausente o duplicado', () => {
    expect(applyMutant(ORIGINAL, { name: 'x', from: '// $& no', to: '// $1 $& sí' })).toContain('// $1 $& sí es un patrón');
    expect(() => applyMutant(ORIGINAL, { name: 'x', from: 'export const c', to: '' })).toThrow('aparece 0 veces');
    expect(() => applyMutant(ORIGINAL, { name: 'x', from: 'export const', to: '' })).toThrow('aparece 2 veces');
    const read = (p: string) => ({ 'src/m.ts': ORIGINAL, 'src/m.test.ts': '' })[p] ?? null;
    expect(manifestErrors([manifest], read)).toEqual([
      'ausente: «from» aparece 0 veces en src/m.ts (se exige una)',
      'duplicado: «from» aparece 2 veces en src/m.ts (se exige una)',
    ]);
    const broken: MutantManifest = { module: 'src/otro.ts', mutants: [{ ...mutant('muere', 'x', 'y'), tests: ['src/nada.test.ts'] }] };
    expect(manifestErrors([manifest, broken], read)).toEqual(
      expect.arrayContaining([
        'módulo inexistente: src/otro.ts',
        'nombre repetido: muere',
        'muere: prueba focal inexistente src/nada.test.ts',
      ]),
    );
    expect(selectMutants([manifest], { module: 'm', only: ['sobrevive'] }).map((s) => s.mutant.name)).toEqual(['sobrevive']);
    expect(() => selectMutants([manifest], { module: 'otro' })).toThrow('Sin manifiesto');
    expect(() => selectMutants([manifest], { only: ['nadie'] })).toThrow('Mutante desconocido');
  });

  it('muere, sobrevive, error del ejecutor y from inválido; el módulo queda restaurado y git status limpio', async () => {
    const { root, git, cleanup } = repo();
    try {
      const calls: string[] = [];
      const report = await runMutants(selectMutants([manifest], {}), {
        ...fsDeps(root),
        runTests: fakeTests(root, calls),
        log: () => {},
        interrupted: () => false,
      });
      expect(report.baseline).toMatchObject({ tests: ['src/m.test.ts'], passed: true });
      expect(report.results.map((r) => [r.name, r.status])).toEqual([
        ['muere', 'killed'],
        ['sobrevive', 'survived'],
        ['explota', 'error'],
        ['ausente', 'error'],
        ['duplicado', 'error'],
      ]);
      expect(report.results[0].failed).toEqual(['src/m.test.ts > a vale 1']);
      expect(report.results[2].error).toBe('el ejecutor se cayó');
      expect(report.results[3].error).toContain('aparece 0 veces');
      // Ni la línea base ni un from inválido llegan a mutar: sólo corren muere, sobrevive y explota.
      expect(calls).toEqual(['baseline', 'muere', 'sobrevive', 'explota']);
      expect(readFileSync(join(root, 'src/m.ts'), 'utf8')).toBe(ORIGINAL);
      expect(git('status', '--porcelain')).toBe('');
      expect(existsSync(join(root, JOURNAL))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('una línea base roja no ejecuta mutantes; una interrupción deja el resto sin correr', async () => {
    const { root, git, cleanup } = repo();
    try {
      const red = await runMutants(selectMutants([manifest], {}), {
        ...fsDeps(root),
        runTests: () =>
          Promise.resolve({ exitCode: 1, failed: ['src/m.test.ts > roja sin mutante'], suiteErrors: [], seconds: 0, error: null }),
        log: () => {},
        interrupted: () => false,
      });
      expect(red.baseline).toMatchObject({ passed: false, error: '1 pruebas focales fallan sin mutante' });
      expect(red.results).toEqual([]);
      expect(red.notRun).toHaveLength(manifest.mutants.length);
      let stop = false;
      const calls: string[] = [];
      const tests = fakeTests(root, calls);
      const cut = await runMutants(selectMutants([manifest], { only: ['muere', 'sobrevive'] }), {
        ...fsDeps(root),
        runTests: async (t, label) => {
          const r = await tests(t, label);
          if (label === 'muere') stop = true;
          return r;
        },
        log: () => {},
        interrupted: () => stop,
      });
      expect(cut.results.map((r) => r.name)).toEqual(['muere']);
      expect(cut.notRun).toEqual(['sobrevive']);
      expect(git('status', '--porcelain')).toBe('');
    } finally {
      cleanup();
    }
  });

  it('el diario restaura un módulo que quedó mutado por un proceso muerto y no pisa una edición posterior', () => {
    const { root, git, cleanup } = repo();
    try {
      const mutated = applyMutant(ORIGINAL, manifest.mutants[0]);
      const entry = {
        module: 'src/m.ts',
        originalSha256: sha256(ORIGINAL),
        mutatedSha256: sha256(mutated),
        backup: Buffer.from(ORIGINAL).toString('base64'),
      };
      fsDeps(root).journal.save(entry);
      writeFileSync(join(root, 'src/m.ts'), mutated);
      expect(recoverJournal(root)).toBe('restaurado src/m.ts de una ejecución interrumpida');
      expect(git('status', '--porcelain')).toBe('');
      expect(recoverJournal(root)).toBeNull();
      fsDeps(root).journal.save(entry);
      writeFileSync(join(root, 'src/m.ts'), ORIGINAL + '// edición posterior\n');
      expect(() => recoverJournal(root)).toThrow('cambió tras una ejecución interrumpida');
      expect(readFileSync(join(root, 'src/m.ts'), 'utf8')).toContain('edición posterior');
    } finally {
      cleanup();
    }
  });

  it('el workflow de mutantes vigila cada módulo con manifiesto, sus focales y el ejecutor, fuera del veredicto protegido', () => {
    const root = join(import.meta.dirname, '../..');
    const workflow = readFileSync(join(root, '.github/workflows/mutants.yml'), 'utf8');
    const watched = [...workflow.matchAll(/^ {6}- '([^']+)'$/gm)].map((m) => m[1]);
    for (const p of new Set(MANIFESTS.flatMap((m) => [m.module, ...m.mutants.flatMap((x) => x.tests)]))) expect(watched, p).toContain(p);
    expect(watched).toEqual(expect.arrayContaining(['tools/mutants/**', '.github/workflows/mutants.yml']));
    expect(workflow).toContain('workflow_dispatch');
    expect(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')).not.toContain('mutants');
    const scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['mutants']).toBe('node --import tsx tools/mutants/run.ts');
  });
});
