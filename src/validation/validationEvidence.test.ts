import { describe, expect, it } from 'vitest';
import { assertValidationPhase, validationArgs, validationEvidence, verifyValidationEvidence } from '../../tools/ci/validationEvidence';
const sha = 'a'.repeat(40);
const report = '{"success":true}';
describe('procedencia de fases CI paralelas', () => {
  it('vincula el informe exacto con fase y commit', () => {
    for (const phase of ['core', 'matrix'] as const) {
      const evidence = validationEvidence(phase, sha, report);
      expect(evidence.reportSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(() => verifyValidationEvidence(phase, sha, report, evidence)).not.toThrow();
      expect(() => verifyValidationEvidence(phase, 'b'.repeat(40), report, evidence)).toThrow(/sourceSha/);
      expect(() => verifyValidationEvidence(phase, sha, report + ' ', evidence)).toThrow(/reportSha256/);
      expect(() => verifyValidationEvidence(phase, sha, report, { ...evidence, phase: 'other' })).toThrow(/phase/);
      expect(() => verifyValidationEvidence(phase, sha, report, { ...evidence, version: 2 })).toThrow(/version/);
    }
  });
  it('rechaza metadatos ausentes, malformados y fases o SHA inválidos', () => {
    for (const evidence of [null, undefined, [], {}, '', { version: 1 }])
      expect(() => verifyValidationEvidence('core', sha, report, evidence)).toThrow();
    for (const value of ['', 'all', undefined]) expect(() => assertValidationPhase(value)).toThrow();
    for (const value of ['', 'main', 'a'.repeat(39), 'g'.repeat(40)])
      expect(() => validationEvidence('core', value, report)).toThrow(/source SHA/);
  });
  it('conserva el plazo y los informes, instrumentando solamente core', () => {
    for (const phase of ['core', 'matrix'] as const) {
      const args = validationArgs(phase);
      expect(args).toContain('--testTimeout=180000');
      expect(args).toContain('--reporter=json');
      expect(args).toContain('--outputFile=.validation/' + phase + '.json');
      expect(args.includes('--coverage')).toBe(phase === 'core');
    }
  });
});
