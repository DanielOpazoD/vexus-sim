import { createHash } from 'node:crypto';
export type ValidationPhase = 'core' | 'matrix';
export function assertValidationPhase(value: unknown): asserts value is ValidationPhase {
  if (value !== 'core' && value !== 'matrix') throw new Error('Unknown validation phase');
}
export function validationArgs(phase: ValidationPhase): string[] {
  assertValidationPhase(phase);
  return [
    'node_modules/vitest/vitest.mjs',
    'run',
    ...(phase === 'core' ? ['--coverage'] : []),
    '--testTimeout=180000',
    '--reporter=default',
    '--reporter=json',
    `--outputFile=.validation/${phase}.json`,
  ];
}
export function validationEvidence(phase: ValidationPhase, sourceSha: string, report: string) {
  assertValidationPhase(phase);
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('Invalid validation source SHA');
  return { version: 1, phase, sourceSha, reportSha256: createHash('sha256').update(report).digest('hex') };
}
export function verifyValidationEvidence(phase: ValidationPhase, sourceSha: string, report: string, evidence: unknown): void {
  const expected = validationEvidence(phase, sourceSha, report);
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('Missing validation evidence');
  for (const key of Object.keys(expected) as Array<keyof typeof expected>)
    if ((evidence as Partial<typeof expected>)[key] !== expected[key]) throw new Error(`Validation evidence differs: ${key}`);
}
