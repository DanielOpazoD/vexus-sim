import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { coverageFiles, EXHAUSTIVE_MATRIX_FILES, verifyReportedFiles } from '../../tools/ci/coveragePartition';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const representative = [join(root, 'src/validation/anatomy.test.ts'), join(root, 'src/validation/liverContour.test.ts')];
const files = [...EXHAUSTIVE_MATRIX_FILES.map((p) => join(root, p)), ...representative];

describe('partición de cobertura sin perder pruebas', () => {
  it('las dos particiones son disjuntas y su unión conserva cada archivo', () => {
    const core = coverageFiles(files, 'core', 'all');
    const matrix = coverageFiles(files, 'matrix', 'all');
    expect(core.filter((p) => matrix.includes(p))).toEqual([]);
    expect([...core, ...matrix].sort()).toEqual([...files].sort());
    expect(matrix).toHaveLength(4);
    expect(core).toEqual(representative);
  });
  it('una prueba nueva entra automáticamente en cobertura', () => {
    const added = join(root, 'src/validation/newPhysics.test.ts');
    expect(coverageFiles([...files, added], 'core', 'all')).toContain(added);
    expect(coverageFiles([...files, added], 'matrix', 'all')).not.toContain(added);
  });
  it('la referencia completa conserva el conjunto original', () => {
    expect(coverageFiles(files, 'all', 'all')).toEqual(files);
  });
  it('rechaza un archivo de matriz desaparecido en ambas particiones', () => {
    for (const partition of ['core', 'matrix']) expect(() => coverageFiles(files.slice(1), partition, 'all')).toThrow(/exactly one/);
  });
  it('rechaza duplicados, fases desconocidas y combinaciones que omitirían niveles', () => {
    expect(() => coverageFiles([...files, files[0]], 'core', 'all')).toThrow(/Duplicate/);
    expect(() => coverageFiles(files, 'typo', 'all')).toThrow(/Unknown/);
    for (const tier of ['fast', 'slow']) expect(() => coverageFiles(files, 'core', tier)).toThrow(/VITEST_TIER=all/);
  });
  it('rechaza informes incompletos, archivos repetidos o pruebas omitidas', () => {
    const report = { success: true, numPendingTests: 0, numTodoTests: 0, testResults: files.map((name) => ({ name, status: 'passed' })) };
    expect(() => verifyReportedFiles(files, report)).not.toThrow();
    expect(() => verifyReportedFiles(files, { ...report, success: false })).toThrow();
    expect(() => verifyReportedFiles(files, { ...report, numPendingTests: 1 })).toThrow();
    expect(() => verifyReportedFiles(files, { ...report, numTodoTests: 1 })).toThrow();
    expect(() => verifyReportedFiles(files, { ...report, testResults: report.testResults.slice(1) })).toThrow();
    expect(() => verifyReportedFiles(files, { ...report, testResults: [...report.testResults, report.testResults[0]] })).toThrow();
    expect(() =>
      verifyReportedFiles(files, { ...report, testResults: report.testResults.map((r) => ({ ...r, status: 'failed' })) }),
    ).toThrow();
  });
  it('el manifiesto señala archivos reales y no incorpora globs amplios', () => {
    for (const p of EXHAUSTIVE_MATRIX_FILES) {
      expect(existsSync(join(root, p)), p).toBe(true);
      expect(p).not.toMatch(/[*?]/);
    }
  });
  it('la ruta habitual exige ambas fases y conserva la referencia totalmente instrumentada', () => {
    const scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['test:coverage']).toBe('npm run test:coverage:core && npm run test:matrix && npm run test:coverage:verify');
    expect(scripts['test:coverage:core']).toBe('node --import tsx tools/ci/run-validation-phase.ts core');
    expect(scripts['test:matrix']).toBe('node --import tsx tools/ci/run-validation-phase.ts matrix');
    expect(scripts['test:coverage:full']).toBe('VITEST_TIER=all VITEST_COVERAGE_PARTITION=all vitest run --coverage --testTimeout=180000');
  });
  it('publica los informes de ambas fases aunque su directorio sea oculto', () => {
    const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    for (const phase of ['core', 'matrix']) {
      const upload = workflow.split('name: validation-' + phase)[1]?.split('  #')[0];
      expect(upload).toContain('.validation/' + phase + '.json');
      expect(upload).toContain('.validation/' + phase + '.source.json');
      expect(upload).toContain('include-hidden-files: true');
      expect(upload).toContain('if-no-files-found: error');
    }
    expect(workflow).toContain('merge-multiple: true');
    expect(workflow).toContain('run: npm run test:coverage:verify');
  });
});
