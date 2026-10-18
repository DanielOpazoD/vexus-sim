import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { feedbackFiles, feedbackFingerprint, feedbackPlan } from '../../tools/workspace/feedbackPlan';

describe('Feedback focalizado sin confundirse con aceptación', () => {
  it('incluye cambios confirmados, preparados, sin preparar, nuevos con espacios y borrados', () => {
    const root = mkdtempSync(join(tmpdir(), 'vexus-feedback-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    try {
      git('init');
      git('config', 'user.name', 'Feedback fixture');
      git('config', 'user.email', 'fixture@example.invalid');
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src/a.ts'), 'initial');
      writeFileSync(join(root, 'src/b.ts'), 'initial');
      git('add', '.');
      git('commit', '-m', 'baseline');
      const base = git('rev-parse', 'HEAD').toString().trim();
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
      expect(() => feedbackFiles(root, base, ['../elsewhere.ts'])).toThrow();
      expect(() => feedbackFiles(root, base, ['node_modules/dependency.ts'])).toThrow();
      expect(() => feedbackFiles(root, base, ['src'])).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
