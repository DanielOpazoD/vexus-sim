import { describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { feedbackGitEnvironment } from '../../tools/workspace/feedbackPlan';
import { applyMutant, manifestErrors, selectMutants, type MutantManifest } from '../../tools/mutants/manifest';
import { MANIFESTS } from '../../tools/mutants/manifests';
import { exitCodeFor, mutantsCli } from '../../tools/mutants/cli';
import {
  acquireLock,
  classify,
  fsDeps,
  JOURNAL,
  LOCK,
  outcomeFromReport,
  recoverJournal,
  RESCUED,
  runMutants,
  sha256,
  type TestOutcome,
} from '../../tools/mutants/runner';

/** Ejecutor de mutantes de la decisión 322 (punto 8) en un repositorio temporal con un ejecutor de pruebas falso. */
const REPO = join(import.meta.dirname, '../..');
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
const valid: MutantManifest = { module: 'src/m.ts', mutants: manifest.mutants.slice(0, 2) };
const PASS: TestOutcome = { exitCode: 0, failed: [], failureMessages: [], suiteErrors: [], seconds: 0.1, error: null };

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
    const failureMessages = failed.map(() => 'AssertionError: expected 9 to be 1');
    return Promise.resolve({ ...PASS, exitCode: failed.length ? 1 : 0, failed, failureMessages });
  };
}
const quiet = { log: () => {}, interrupted: () => false };

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

  it('los manifiestos reales siguen el código: cada from aparece una vez y cada focal existe', () => {
    // Un PR que mueve el texto bajo un mutante falla aquí, en la capa rápida, sin esperar al workflow de mutantes.
    const read = (p: string) => (existsSync(join(REPO, p)) ? readFileSync(join(REPO, p), 'utf8') : null);
    expect(manifestErrors(MANIFESTS, read)).toEqual([]);
  });

  it('muere, sobrevive, error del ejecutor y from inválido; el módulo queda restaurado y git status limpio', async () => {
    const { root, git, cleanup } = repo();
    try {
      const calls: string[] = [];
      const report = await runMutants(selectMutants([manifest], {}), { ...fsDeps(root), runTests: fakeTests(root, calls), ...quiet });
      expect(report.baseline).toMatchObject({ tests: ['src/m.test.ts'], passed: true });
      expect(report.results.map((r) => [r.name, r.status])).toEqual([
        ['muere', 'killed'],
        ['sobrevive', 'survived'],
        ['explota', 'error'],
        ['ausente', 'error'],
        ['duplicado', 'error'],
      ]);
      expect(report.results[0]).toMatchObject({
        failed: ['src/m.test.ts > a vale 1'],
        failureMessages: ['AssertionError: expected 9 to be 1'],
      });
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

  it('informe de Vitest ausente, truncado o sin estructura: error del ejecutor, nunca una excepción, y el módulo se restaura', async () => {
    const tests = ['src/m.test.ts'];
    expect(outcomeFromReport(null, 1, tests, '/r').error).toBe('Vitest no escribió su informe');
    expect(outcomeFromReport('{"testResults": [{"name": "/r/src/m', 1, tests, '/r').error).toMatch(/^informe de Vitest ilegible: /);
    expect(outcomeFromReport('{"testResults": [{"name": 3}]}', 1, tests, '/r').error).toBe('informe de Vitest sin la estructura esperada');
    const report = JSON.stringify({
      testResults: [
        {
          name: '/r/src/m.test.ts',
          status: 'failed',
          assertionResults: [
            { status: 'failed', fullName: 'a vale 1', failureMessages: ['AssertionError: expected 9 to be 1\n    at m.test.ts:3:1'] },
            { status: 'passed', fullName: 'b vale 2', failureMessages: [] },
          ],
        },
      ],
    });
    expect(outcomeFromReport(report, 1, tests, '/r')).toEqual({
      exitCode: 1,
      failed: ['src/m.test.ts > a vale 1'],
      failureMessages: ['AssertionError: expected 9 to be 1'],
      suiteErrors: [],
      error: null,
    });
    expect(outcomeFromReport(report, 1, [...tests, 'src/otra.test.ts'], '/r').suiteErrors).toEqual(['src/otra.test.ts']);
    const { root, git, cleanup } = repo();
    try {
      const r = await runMutants(selectMutants([valid], { only: ['muere'] }), {
        ...fsDeps(root),
        runTests: (t, label) =>
          Promise.resolve(label === 'baseline' ? PASS : { ...outcomeFromReport('{"testResults": [', 1, t, root), seconds: 0 }),
        ...quiet,
      });
      expect(r.results[0]).toMatchObject({ status: 'error', error: expect.stringMatching(/^informe de Vitest ilegible/) as string });
      expect(readFileSync(join(root, 'src/m.ts'), 'utf8')).toBe(ORIGINAL);
      expect(git('status', '--porcelain')).toBe('');
    } finally {
      cleanup();
    }
  });

  it('una focal que sólo cae por excepciones de ejecución (TypeError…) no cuenta como muerto', async () => {
    const red = (...failureMessages: string[]): TestOutcome => ({
      ...PASS,
      exitCode: 1,
      failed: failureMessages.map((_, i) => `f > ${i}`),
      failureMessages,
    });
    expect(classify(red('TypeError: q.depthMm is undefined'))).toEqual({
      status: 'error',
      error: 'sólo excepciones de ejecución en las focales (TypeError): no se comprobó ninguna aserción',
    });
    expect(classify(red('ReferenceError: x is not defined', 'RangeError: bad'))).toMatchObject({ status: 'error' });
    // Una aserción roja basta; un Error del propio código (validación) es comportamiento comprobado.
    expect(classify(red('TypeError: a', 'AssertionError: expected 1 to be 2')).status).toBe('killed');
    expect(classify(red('Error: Paquete P3 s0028 no cargado')).status).toBe('killed');
    const { root, cleanup } = repo();
    try {
      const r = await runMutants(selectMutants([valid], { only: ['muere'] }), {
        ...fsDeps(root),
        runTests: (_t, label) => Promise.resolve(label === 'baseline' ? PASS : red('TypeError: Cannot read properties of undefined')),
        ...quiet,
      });
      expect(r.results.map((x) => [x.name, x.status])).toEqual([['muere', 'error']]);
    } finally {
      cleanup();
    }
  });

  it('una edición del módulo durante un mutante no se pisa: queda rescatada, el diario conserva el original y la corrida se detiene', async () => {
    const { root, cleanup } = repo();
    try {
      const EDITED = ORIGINAL.replace('a = 1', 'a = 9') + '// edición durante la corrida\n';
      const report = await runMutants(selectMutants([valid], {}), {
        ...fsDeps(root),
        runTests: (_t, label) => {
          if (label === 'muere') writeFileSync(join(root, 'src/m.ts'), EDITED);
          return Promise.resolve(PASS);
        },
        ...quiet,
      });
      expect(report.aborted).toMatch(/^src\/m\.ts cambió durante «muere»: no se sobrescribe/);
      expect(report.results.map((r) => [r.name, r.status])).toEqual([['muere', 'error']]);
      expect(report.notRun).toEqual(['sobrevive']);
      expect(readFileSync(join(root, 'src/m.ts'), 'utf8')).toBe(EDITED);
      const rescued = readdirSync(join(root, RESCUED));
      expect(rescued).toHaveLength(1);
      expect(readFileSync(join(root, RESCUED, rescued[0]), 'utf8')).toBe(EDITED);
      expect(Buffer.from((JSON.parse(readFileSync(join(root, JOURNAL), 'utf8')) as { backup: string }).backup, 'base64').toString()).toBe(
        ORIGINAL,
      );
      expect(() => recoverJournal(root)).toThrow('cambió tras una ejecución interrumpida');
      // Si el módulo vuelve al original durante el mutante (un checkout ajeno), el resultado no vale.
      writeFileSync(join(root, 'src/m.ts'), ORIGINAL);
      rmSync(join(root, JOURNAL));
      const back = await runMutants(selectMutants([valid], { only: ['muere'] }), {
        ...fsDeps(root),
        runTests: (_t, label) => {
          if (label === 'muere') writeFileSync(join(root, 'src/m.ts'), ORIGINAL);
          return Promise.resolve(PASS);
        },
        ...quiet,
      });
      expect(back.results[0]).toMatchObject({
        status: 'error',
        error: 'src/m.ts volvió al original durante la corrida: el resultado no vale',
      });
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
          Promise.resolve({ ...PASS, exitCode: 1, failed: ['src/m.test.ts > roja sin mutante'], failureMessages: ['AssertionError: x'] }),
        ...quiet,
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

  it('cerrojo: una ejecución a la vez; --list no toca el diario de otra; con el cerrojo ocupado sale con 2', async () => {
    const { root, cleanup } = repo();
    try {
      const release111 = acquireLock(root, 111, () => true);
      expect(() => acquireLock(root, 222, () => true)).toThrow('Otra ejecución de mutantes sigue en curso en este checkout (pid 111)');
      // El cerrojo de un proceso muerto se retira.
      const release333 = acquireLock(root, 333, (pid) => pid !== 111);
      release111();
      expect(existsSync(join(root, LOCK))).toBe(true);
      release333();
      expect(existsSync(join(root, LOCK))).toBe(false);
      // Otra corrida en curso: módulo mutado, su diario y su cerrojo (un proceso vivo distinto de éste).
      const mutated = applyMutant(ORIGINAL, manifest.mutants[0]);
      fsDeps(root).journal.save({
        module: 'src/m.ts',
        originalSha256: sha256(ORIGINAL),
        mutatedSha256: sha256(mutated),
        backup: Buffer.from(ORIGINAL).toString('base64'),
      });
      writeFileSync(join(root, 'src/m.ts'), mutated);
      mkdirSync(dirname(join(root, LOCK)), { recursive: true });
      writeFileSync(join(root, LOCK), JSON.stringify({ pid: process.ppid }));
      const ctx = { root, manifests: [valid], makeRunTests: () => () => Promise.reject(new Error('no debe correr')) };
      expect(await mutantsCli(['--list'], ctx)).toBe(0);
      expect(await mutantsCli([], ctx)).toBe(2);
      expect(readFileSync(join(root, 'src/m.ts'), 'utf8')).toBe(mutated);
      expect(existsSync(join(root, JOURNAL))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('códigos de salida: 0 todos muertos, 1 alguno sobrevive, 2 si la corrida no es fiable', () => {
    const ok = { baselinePassed: true, errors: 0, notRun: 0, survived: 0, treeUnchanged: true, restored: true, stopped: false };
    expect(exitCodeFor(ok)).toBe(0);
    expect(exitCodeFor({ ...ok, survived: 2 })).toBe(1);
    for (const bad of [
      { baselinePassed: false },
      { errors: 1 },
      { errors: 1, survived: 1 },
      { notRun: 1 },
      { treeUnchanged: false },
      { restored: false },
      { stopped: true },
    ])
      expect(exitCodeFor({ ...ok, ...bad }), JSON.stringify(bad)).toBe(2);
  });

  it('SIGHUP en mitad de un mutante (cerrar la terminal): mata el hijo, restaura, suelta el cerrojo y sale con 2', async () => {
    const { root, git, cleanup } = repo();
    const dir = mkdtempSync(join(tmpdir(), 'vexus-mutants-hup-'));
    try {
      const out = join(root, '.cache/mutants/hup');
      const script = join(dir, 'hup.mts');
      writeFileSync(
        script,
        [
          "import { spawn } from 'node:child_process';",
          `import { mutantsCli } from ${JSON.stringify(pathToFileURL(join(REPO, 'tools/mutants/cli.ts')).href)};`,
          `const m = { name: 'muere', from: 'export const a = 1;', to: 'export const a = 9;', breaks: 'x', tests: ['src/m.test.ts'], origin: 'x' };`,
          'const ok = { exitCode: 0, failed: [], failureMessages: [], suiteErrors: [], seconds: 0, error: null };',
          `const code = await mutantsCli(['--out', ${JSON.stringify(out)}], {`,
          `  root: ${JSON.stringify(root)},`,
          "  manifests: [{ module: 'src/m.ts', mutants: [m] }],",
          '  makeRunTests: (_o, _t, track, stopping) => (_tests, label) => new Promise((done) => {',
          "    if (label === 'baseline') return done(ok);",
          "    const child = spawn('sleep', ['30'], { stdio: 'ignore' });",
          '    track(child);',
          "    child.once('close', (c, s) => { track(null); done({ ...ok, exitCode: c, error: stopping() ? 'interrumpida (' + s + ')' : null }); });",
          "    console.log('MUTADO');",
          '  }),',
          '});',
          'process.exit(code);',
        ].join('\n'),
      );
      const child = spawn(process.execPath, ['--import', 'tsx', script], {
        cwd: REPO,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: feedbackGitEnvironment(),
      });
      const exited = new Promise<number | null>((done) => child.once('close', (code) => done(code)));
      let stdout = '';
      await new Promise<void>((ready, fail) => {
        child.stdout.on('data', (d: Buffer) => {
          stdout += d.toString();
          if (stdout.includes('MUTADO')) ready();
        });
        child.once('close', () => fail(new Error(`salió antes de mutar: ${stdout}`)));
      });
      expect(readFileSync(join(root, 'src/m.ts'), 'utf8')).toContain('a = 9');
      child.kill('SIGHUP');
      expect(await exited).toBe(2);
      expect(readFileSync(join(root, 'src/m.ts'), 'utf8')).toBe(ORIGINAL);
      expect(git('status', '--porcelain')).toBe('');
      expect(existsSync(join(root, JOURNAL))).toBe(false);
      expect(existsSync(join(root, LOCK))).toBe(false);
      expect(JSON.parse(readFileSync(join(out, 'mutants.json'), 'utf8'))).toMatchObject({
        exitCode: 2,
        aborted: 'interrumpida por una señal',
      });
    } finally {
      cleanup();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('el workflow de mutantes vigila cada módulo con manifiesto, sus focales y el ejecutor, fuera del veredicto protegido', () => {
    const workflow = readFileSync(join(REPO, '.github/workflows/mutants.yml'), 'utf8');
    const watched = [...workflow.matchAll(/^ {6}- '([^']+)'$/gm)].map((m) => m[1]);
    for (const p of new Set(MANIFESTS.flatMap((m) => [m.module, ...m.mutants.flatMap((x) => x.tests)]))) expect(watched, p).toContain(p);
    // La selección de pruebas (vite.config.ts) y los scripts (package.json) también deciden qué corre.
    expect(watched).toEqual(
      expect.arrayContaining(['tools/mutants/**', '.github/workflows/mutants.yml', 'vite.config.ts', 'package.json']),
    );
    expect(workflow).toContain('workflow_dispatch');
    expect(readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8')).not.toContain('mutants');
    const scripts = (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['mutants']).toBe('node --import tsx tools/mutants/run.ts');
  });
});
