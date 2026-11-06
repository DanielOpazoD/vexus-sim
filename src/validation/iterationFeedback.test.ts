import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { feedbackFiles, feedbackFingerprint, feedbackGitEnvironment, feedbackPlan } from '../../tools/workspace/feedbackPlan';

describe('Feedback focalizado sin confundirse con aceptación', () => {
  it('incluye cambios confirmados, preparados, sin preparar, nuevos con espacios y borrados', () => {
    const root = mkdtempSync(join(tmpdir(), 'vexus-feedback-'));
    // Punteros deliberadamente inválidos: si vuelven a heredarse, falla sin tocar otro repo.
    const env = feedbackGitEnvironment({
      ...process.env,
      GIT_DIR: join(root, 'foreign.git'),
      GIT_WORK_TREE: join(root, 'foreign-tree'),
      GIT_INDEX_FILE: join(root, 'foreign-index'),
    });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe', env });
    try {
      git('init');
      expect(git('rev-parse', '--show-toplevel').toString().trim()).toBe(realpathSync(root));
      git('config', 'user.name', 'Feedback fixture');
      git('config', 'user.email', 'fixture@example.invalid');
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src/a.ts'), 'initial');
      writeFileSync(join(root, 'src/b.ts'), 'initial');
      git('add', '.');
      git('commit', '-m', 'baseline');
      const base = git('rev-parse', 'HEAD').toString().trim();
      expect(() => feedbackFiles(root, 'origin/main', [])).toThrow('Falta la base Git origin/main');
      writeFileSync(join(root, 'src/a.ts'), 'committed');
      git('add', '.');
      git('commit', '-m', 'change');
      writeFileSync(join(root, 'src/a.ts'), 'staged');
      git('add', '.');
      writeFileSync(join(root, 'src/a.ts'), 'working');
      rmSync(join(root, 'src/b.ts'));
      writeFileSync(join(root, 'src/new file.ts'), 'new');
      expect(feedbackFiles(root, base, [])).toEqual(['src/a.ts', 'src/b.ts', 'src/new file.ts']);
      expect(feedbackPlan(root, feedbackFiles(root, base, [])).mode).toBe('fast');
      const status = git('status', '--short').toString(),
        before = feedbackFingerprint(root, '/unrelated-output');
      writeFileSync(join(root, 'src/a.ts'), 'edited again');
      expect(git('status', '--short').toString()).toBe(status);
      expect(feedbackFingerprint(root, '/unrelated-output')).not.toBe(before);
      // Una tabla/modelo puede superar el búfer por defecto de execFileSync (1 MiB).
      writeFileSync(join(root, 'src/a.ts'), 'x'.repeat(2 * 1024 * 1024));
      expect(feedbackFingerprint(root, '/unrelated-output')).not.toBe(before);
      const beforeStage = feedbackFingerprint(root, '/unrelated-output');
      git('add', 'src/a.ts');
      expect(feedbackFingerprint(root, '/unrelated-output')).not.toBe(beforeStage);
      expect(() => feedbackFiles(root, base, ['../elsewhere.ts'])).toThrow();
      expect(() => feedbackFiles(root, base, ['node_modules/dependency.ts'])).toThrow();
      expect(() => feedbackFiles(root, base, ['src'])).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it.each(['none', 'head', 'index', 'config'])('el hook real detecta contaminación Git: %s', (mutation) => {
    const root = mkdtempSync(join(tmpdir(), 'vexus-hook-'));
    const env = feedbackGitEnvironment();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe', env }).toString().trim();
    try {
      git('init');
      git('config', 'user.name', 'Hook fixture');
      git('config', 'user.email', 'fixture@example.invalid');
      writeFileSync(join(root, 'seed'), 'one');
      git('add', '.');
      git('commit', '-m', 'one');
      const baseline = git('rev-parse', 'HEAD');
      writeFileSync(join(root, 'seed'), 'two');
      git('commit', '-am', 'two');
      const next = git('rev-parse', 'HEAD');
      git('update-ref', 'HEAD', baseline);
      git('read-tree', baseline);
      mkdirSync(join(root, 'bin'));
      writeFileSync(
        join(root, 'bin/npm'),
        '#!/bin/sh\ncase "$FIXTURE_MUTATION" in\nhead) git update-ref HEAD "$FIXTURE_NEXT";;\nindex) echo changed >> seed; git add seed;;\nconfig) git config fixture.changed true;;\nesac\nexit 0\n',
        { mode: 0o755 },
      );
      const result = spawnSync('sh', [join(import.meta.dirname, '../../.githooks/pre-push')], {
        cwd: root,
        encoding: 'utf8',
        env: { ...env, PATH: join(root, 'bin') + ':' + (env.PATH ?? ''), FIXTURE_MUTATION: mutation, FIXTURE_NEXT: next },
      });
      expect(result.status).toBe(mutation === 'none' ? 0 : 1);
      if (mutation !== 'none') expect(result.stderr).toContain('publicación detenida');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const ZERO = '0'.repeat(40),
    SHA = 'a'.repeat(40);
  it.each([
    ['sólo borrados', `(delete) ${ZERO} refs/heads/x ${SHA}\n(delete) ${ZERO} refs/heads/y ${SHA}\n`, false, '999'],
    ['borrado y publicación', `(delete) ${ZERO} refs/heads/x ${SHA}\nrefs/heads/feat ${SHA} refs/heads/feat ${ZERO}\n`, true, '999'],
    ['publicación y borrado', `refs/heads/feat ${SHA} refs/heads/feat ${ZERO}\n(delete) ${ZERO} refs/heads/x ${SHA}\n`, true, '999'],
    ['publicación', `refs/heads/feat ${SHA} refs/heads/feat ${ZERO}\n`, true, '999'],
    ['publicación con tres trabajadores', `refs/heads/feat ${SHA} refs/heads/feat ${ZERO}\n`, true, '3'],
    ['sin líneas', '', true, '999'],
  ])('el gancho real con un push de %s corre la capa rápida: %s', (_case, stdin, runs, requestedWorkers) => {
    // `git push --delete` no publica código: con todas las sha locales en ceros el gancho no corre las ~1.900 pruebas.
    const root = mkdtempSync(join(tmpdir(), 'vexus-hook-delete-'));
    const env = feedbackGitEnvironment();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe', env });
    try {
      git('init');
      git('config', 'user.name', 'Hook fixture');
      git('config', 'user.email', 'fixture@example.invalid');
      writeFileSync(join(root, 'seed'), 'one');
      git('add', '.');
      git('commit', '-m', 'one');
      mkdirSync(join(root, 'bin'));
      writeFileSync(
        join(root, 'bin/npm'),
        '#!/bin/sh\necho "$@" >> "$FIXTURE_CALLS"\necho "$VITEST_MAX_WORKERS" >> "$FIXTURE_CALLS"\nexit 0\n',
        { mode: 0o755 },
      );
      const calls = join(root, 'calls');
      const result = spawnSync('sh', [join(import.meta.dirname, '../../.githooks/pre-push'), 'origin', 'https://example.invalid/x.git'], {
        cwd: root,
        encoding: 'utf8',
        input: stdin,
        env: { ...env, PATH: join(root, 'bin') + ':' + (env.PATH ?? ''), FIXTURE_CALLS: calls, VITEST_MAX_WORKERS: requestedWorkers },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(calls)).toBe(runs);
      if (!runs) expect(result.stdout).toContain('sólo borra ramas');
      else {
        const workers = Number(readFileSync(calls, 'utf8').trim().split('\n')[1]);
        expect(workers).toBeGreaterThanOrEqual(1);
        expect(workers).toBeLessThanOrEqual(Math.max(1, Math.floor(availableParallelism() / 2)));
        expect(workers).toBeLessThanOrEqual(4);
        expect(workers).toBeLessThanOrEqual(Number(requestedWorkers));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('el gancho de push corre sólo la capa rápida (decisión 322): el feedback completo de la capa rápida', () => {
    const root = join(import.meta.dirname, '../..');
    const code = readFileSync(join(root, '.githooks/pre-push'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(code.filter((l) => /^npm /.test(l))).toEqual(['npm run feedback --silent -- --all-fast']);
    for (const heavy of ['test:slow', 'test:all', 'test:coverage', 'npm run check', 'npm run build', 'e2e', 'calibrate', 'VITEST_TIER'])
      expect(code.join('\n'), heavy).not.toContain(heavy);
    // --all-fast: formato y lint de lo cambiado, tipos y toda la capa rápida, sin la lenta.
    expect(feedbackPlan(root, [], true)).toMatchObject({ mode: 'fast', slow: false });
    const scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['feedback']).toBe('node --import tsx tools/workspace/feedback.ts');
  });
  it('elige feedback proporcionado y no declara el navegador ni las matrices como aprobados', () => {
    const root = join(import.meta.dirname, '../..');
    expect(feedbackPlan(root, ['anatomy/unused.md']).mode).toBe('docs');
    expect(feedbackPlan(root, ['anatomy/unused.md'], true).mode).toBe('fast');
    expect(feedbackPlan(root, ['src/core/clock.ts']).mode).toBe('related');
    expect(feedbackPlan(root, ['src/bootstrap.ts']).mode).toBe('fast');
    expect(feedbackPlan(root, ['src/validation/workspaceTools.test.ts']).mode).toBe('tests');
    expect(feedbackPlan(root, ['src/validation/workspaceTools.test.ts', 'src/deleted-source.ts']).mode).toBe('fast');
    expect(() => feedbackPlan(root, [])).toThrow('No hay cambios');
    const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(scripts.scripts.check).toContain('npm run test:coverage');
    expect(scripts.scripts.check).not.toContain('feedback');
    expect(scripts.scripts.check.indexOf('vite build')).toBeLessThan(scripts.scripts.check.indexOf('npm run test:coverage'));
    expect(scripts.scripts.check.indexOf('bundle-budget.ts')).toBeLessThan(scripts.scripts.check.indexOf('npm run test:coverage'));
    const config = readFileSync(join(root, 'playwright.config.ts'), 'utf8');
    expect(config).toContain('retries: 0');
    expect(config).toContain('failOnFlakyTests: !!process.env.CI');
  });
});
