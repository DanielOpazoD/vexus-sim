import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { e2eOptions } from '../../tools/workspace/e2eOptions';

describe('Reproducción local sin destruir la evidencia', () => {
  it('no permite redirigir salida, informes ni debilitar controles mediante argumentos Playwright', () => {
    for (const flag of [
      '--output=/historical',
      '-o/historical',
      '--reporter=line',
      '--config=other.ts',
      '-cother.ts',
      '--workers=8',
      '-j8',
      '--retries=2',
      '--timeout=999999',
      '--debug',
      '--ui',
      '--trace=off',
      '-u',
    ]) {
      expect(() => e2eOptions(['--backend', 'swiftshader', '--out', 'new-run', '--', flag], '/repo')).toThrow();
    }
    const result = e2eOptions(
      ['--backend', 'swiftshader', '--out', 'new-run', '--', 'e2e/renalCutTracking.spec.ts', '--grep', 'renal'],
      '/repo',
    );
    expect(result.help).toBe(false);
    if (!result.help) expect(result.tests).toEqual(['e2e/renalCutTracking.spec.ts', '--grep', 'renal']);
  });
  it('rechaza fuentes remotas o con credenciales antes de abrir un navegador', () => {
    for (const url of [
      'https://example.org',
      'http://user:secret@localhost:6609',
      'http://localhost:6609/other',
      'http://localhost:6609/?e2e=1',
    ])
      expect(() => e2eOptions(['--backend', 'swiftshader', '--url', url, '--out', 'new-run'], '/repo')).toThrow();
  });
  it('conserva una carpeta de evidencia existente y su contenido al rechazar la ejecución real del CLI', () => {
    const temp = mkdtempSync(join(tmpdir(), 'vexus-workspace-'));
    const out = join(temp, 'existing');
    mkdirSync(out);
    writeFileSync(join(out, 'run.json'), 'original evidence\n');
    try {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/workspace/e2e.ts', '--backend', 'swiftshader', '--out', out], {
        cwd: resolve(import.meta.dirname, '../..'),
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('EEXIST');
      expect(readFileSync(join(out, 'run.json'), 'utf8')).toBe('original evidence\n');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
