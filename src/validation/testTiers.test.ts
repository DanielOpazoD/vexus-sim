import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EXHAUSTIVE_MATRIX_FILES } from '../../tools/ci/coveragePartition';
import {
  SLOW_MARKER,
  testFiles,
  testTierFiles,
  tierOf,
  tierBudgetViolations,
  tierTimings,
  type VitestJsonReport,
} from '../../tools/ci/testTiers';

/** Capas de prueba y gancho de push de la decisión 322 (punto 7). */
const root = join(import.meta.dirname, '../..');
const rel = (f: string) => relative(root, f).replaceAll('\\', '/');

describe('Capas de prueba', () => {
  it('el marcador de capa sólo cuenta en la primera línea y con un valor conocido', () => {
    // Un marcador en la segunda línea, con otro espaciado o con otro valor dejaría la prueba en la capa rápida en silencio.
    const misplaced: string[] = [];
    for (const file of testFiles(join(root, 'src'))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/@tier\b/.test(line)) return;
        if (i !== 0 || !['// @tier slow', '// @tier fast'].includes(line.trim())) misplaced.push(`${rel(file)}:${i + 1}`);
      });
    }
    // Este archivo nombra el marcador en sus pruebas, no en su primera línea.
    expect(misplaced.filter((m) => !m.startsWith('src/validation/testTiers.test.ts:'))).toEqual([]);
    expect(SLOW_MARKER).toBe('// @tier slow');
    expect(tierOf('// @tier slow\nconst test = 1;')).toBe('slow');
    expect(tierOf('  // @tier slow\r\nconst test = 1;')).toBe('slow');
    expect(tierOf('// explicación\n// @tier slow\n')).toBe('fast');
    expect(tierOf('\n// @tier slow\n')).toBe('fast');
    expect(tierOf('// @tier slower\n')).toBe('fast');
  });

  it('las dos capas parten la colección y las matrices exhaustivas quedan fuera de la capa rápida', () => {
    const all = testFiles(join(root, 'src')).map(rel);
    const tiers = testTierFiles(join(root, 'src'));
    const fast = tiers.fast.map(rel),
      slow = tiers.slow.map(rel);
    expect([...fast, ...slow].sort()).toEqual([...all].sort());
    expect(fast.filter((f) => slow.includes(f))).toEqual([]);
    for (const matrix of EXHAUSTIVE_MATRIX_FILES) expect(slow, matrix).toContain(matrix);
  });

  it('informe de capa: exige un trabajador para el presupuesto por archivo, la capa completa y sin repetidos', () => {
    const file = (name: string, start: number, end: number, durations: number[]) => ({
      name: join(root, name),
      status: 'passed',
      startTime: start,
      endTime: end,
      assertionResults: durations.map((duration) => ({ status: 'passed', duration })),
    });
    const serial: VitestJsonReport = {
      testResults: [file('src/b.test.ts', 1000, 1500, [100, 300]), file('src/a.test.ts', 0, 1000, [900])],
    };
    const t = tierTimings(serial, root);
    expect(t).toMatchObject({ tests: 3, totalMs: 1500, wallMs: 1500, serial: true });
    expect(t.files.map((f) => [f.file, f.ms, f.slowestTestMs])).toEqual([
      ['src/a.test.ts', 1000, 900],
      ['src/b.test.ts', 500, 300],
    ]);
    expect(tierBudgetViolations(t, ['src/a.test.ts', 'src/b.test.ts'], 1000)).toEqual([]);
    expect(tierBudgetViolations(t, ['src/a.test.ts', 'src/b.test.ts'], 600)).toEqual(['src/a.test.ts: 1.0 s > 0.6 s por archivo']);
    expect(tierBudgetViolations(t, ['src/a.test.ts', 'src/c.test.ts'], 1000)).toEqual([
      'falta en el informe: src/c.test.ts',
      'no pertenece a la capa: src/b.test.ts',
    ]);
    // Dos archivos a la vez: tiempos de un reparto entre núcleos, no del archivo.
    const parallel = tierTimings({ testResults: [file('src/a.test.ts', 0, 1000, [1]), file('src/b.test.ts', 400, 900, [1])] }, root);
    expect(parallel.serial).toBe(false);
    expect(tierBudgetViolations(parallel, ['src/a.test.ts', 'src/b.test.ts'], 5000)).toEqual([
      'informe paralelo: el presupuesto por archivo se mide con un trabajador (VITEST_MAX_WORKERS=1)',
    ]);
    // La capa lenta sólo comprueba que el informe es completo.
    expect(tierBudgetViolations(parallel, ['src/a.test.ts', 'src/b.test.ts'], null)).toEqual([]);
    const twice = tierTimings({ testResults: [file('src/a.test.ts', 0, 10, [1]), file('src/a.test.ts', 10, 20, [1])] }, root);
    expect(tierBudgetViolations(twice, ['src/a.test.ts'], 100)).toEqual(['archivo repetido en el informe']);
  });
});
