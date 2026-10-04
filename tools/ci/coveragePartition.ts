/** Exhaustive IQ/pose matrices run without V8 instrumentation; representative anatomy still contributes coverage. */
export const EXHAUSTIVE_MATRIX_FILES = [
  'src/validation/examChain.test.ts',
  'src/validation/examChainScale.test.ts',
  'src/validation/examChainScalePatterns.test.ts',
  'src/validation/liverContourPoseMatrix.test.ts',
] as const;

export type CoveragePartition = 'all' | 'core' | 'matrix';

/** Exact file partition, fail-closed on missing matrix files, duplicates or incompatible selection. */
export function coverageFiles(files: readonly string[], partition: string, tier: string): string[] {
  if (!['all', 'core', 'matrix'].includes(partition)) throw new Error(`Unknown coverage partition: ${partition}`);
  if (partition !== 'all' && tier !== 'all') throw new Error('Coverage partitions require VITEST_TIER=all');
  if (new Set(files).size !== files.length) throw new Error('Duplicate validation file');
  if (partition === 'all') return [...files];
  const matrix = new Set<string>();
  for (const target of EXHAUSTIVE_MATRIX_FILES) {
    const matches = files.filter((file) => file.replaceAll('\\', '/').endsWith('/' + target) || file.replaceAll('\\', '/') === target);
    if (matches.length !== 1) throw new Error(`Expected exactly one validation file: ${target}`);
    matrix.add(matches[0]);
  }
  return files.filter((file) => (partition === 'matrix' ? matrix.has(file) : !matrix.has(file)));
}

export interface ValidationReport {
  success: boolean;
  numPendingTests: number;
  numTodoTests: number;
  testResults: Array<{ name: string; status: string }>;
}

/** Successful exit alone is not enough: every planned suite must be present, once, with no skipped tests. */
export function verifyReportedFiles(expected: readonly string[], report: ValidationReport): void {
  if (!report.success || report.numPendingTests !== 0 || report.numTodoTests !== 0 || !Array.isArray(report.testResults))
    throw new Error('Incomplete validation report');
  const actual = report.testResults.map((r) => r.name.replaceAll('\\', '/')).sort();
  const wanted = expected.map((p) => p.replaceAll('\\', '/')).sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted) || report.testResults.some((r) => r.status !== 'passed'))
    throw new Error('Validation report does not match the planned files');
}
