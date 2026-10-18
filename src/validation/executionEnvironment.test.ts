import { expect, it } from 'vitest';
import { executionEnvironment } from '../../tools/workspace/executionEnvironment';

it('registra recursos comparables sin copiar secretos ni variables privadas del corredor', () => {
  const report = executionEnvironment({
    ImageOS: 'ubuntu24',
    ImageVersion: 'fixture-image',
    PRIVATE_TOKEN: 'secret-sentinel',
    HOME: '/private-sentinel',
  });
  expect(report.runnerImage).toEqual({ os: 'ubuntu24', version: 'fixture-image' });
  expect(report.availableParallelism).toBeGreaterThan(0);
  expect(report.cpuModels.length).toBe(new Set(report.cpuModels).size);
  expect(JSON.stringify(report)).not.toMatch(/secret-sentinel|private-sentinel|PRIVATE_TOKEN|HOME/);
  expect(executionEnvironment({}).runnerImage).toEqual({ os: null, version: null });
});
