import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { browserShardCount, listedTestIds, verifyShardPlans, type ListedReport } from '../../tools/ci/e2eShardPlan';
const workflow = (axis = '[1, 2]') =>
  `jobs:\n  e2e:\n    strategy:\n      matrix:\n        shard: ${axis}\n    steps:\n      - run: node --import tsx tools/ci/run-e2e-shard.ts \${{ matrix.shard }} \${{ strategy.job-total }}\n  veredicto:\n`;
describe('reparto E2E íntegro y sin concurrencia dentro de SwiftShader', () => {
  it('el número de fragmentos procede de una sola matriz literal', () => {
    expect(browserShardCount(workflow())).toBe(2);
    for (const axis of ['[]', '[0, 1]', '[1, 1]', '[1, 3]', '[1, "2"]']) expect(() => browserShardCount(workflow(axis))).toThrow();
    expect(() => browserShardCount(workflow().replace('        shard:', '        os: [linux, windows]\n        shard:'))).toThrow();
    expect(() => browserShardCount(workflow().replace('${{ strategy.job-total }}', '5'))).toThrow();
    expect(() => browserShardCount(workflow().replace('run-e2e-shard.ts', 'another-command.ts'))).toThrow();
    expect(() => browserShardCount(workflow().replace('run-e2e-shard.ts ', 'run-e2e-shard.ts --grep only '))).toThrow();
  });
  it('extrae pruebas anidadas y distingue proyectos', () => {
    const report: ListedReport = {
      errors: [],
      suites: [
        {
          suites: [
            {
              specs: [
                {
                  id: 'param-a',
                  tests: [
                    { projectId: 'chromium', expectedStatus: 'passed' },
                    { projectId: 'other', expectedStatus: 'passed' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(listedTestIds(report)).toEqual(['param-a/chromium', 'param-a/other']);
    expect(() => listedTestIds({ ...report, errors: ['collection failed'] })).toThrow();
    expect(() =>
      listedTestIds({ errors: [], suites: [{ specs: [{ id: 'x', tests: [{ projectId: 'chromium', expectedStatus: 'skipped' }] }] }] }),
    ).toThrow();
  });
  it('no permite pruebas ausentes, duplicadas, inventadas ni fragmentos vacíos', () => {
    const all = ['a', 'b', 'c'];
    expect(() => verifyShardPlans(all, [['b'], ['c', 'a']])).not.toThrow();
    for (const shards of [
      [['a'], ['b']],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
      [
        ['a', 'b'],
        ['c', 'x'],
      ],
      [all, []],
      [],
    ])
      expect(() => verifyShardPlans(all, shards)).toThrow();
    expect(() => verifyShardPlans([], [])).toThrow();
    expect(() => verifyShardPlans(['a', 'a'], [['a'], ['a']])).toThrow();
  });
  it('las pruebas nuevas entran en la unión exigida', () => {
    expect(() => verifyShardPlans(['a', 'new'], [['a']])).toThrow();
    expect(() => verifyShardPlans(['a', 'new'], [['a'], ['new']])).not.toThrow();
  });
  it('CI usa ocho runners y mantiene un worker, todos los gates y la política anti-flaky', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8'),
      config = readFileSync('playwright.config.ts', 'utf8');
    expect(browserShardCount(ci)).toBe(8);
    expect(ci).toContain('node --import tsx tools/ci/verify-e2e-shards.ts');
    expect(ci).toContain('needs: [check, matrix-validation, e2e]');
    expect(ci).toContain('needs.matrix-validation.result');
    expect(config).toContain('workers: process.env.CI ? 1 : undefined');
    expect(config).toContain('failOnFlakyTests: !!process.env.CI');
  });
});
