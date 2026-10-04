import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { balanceTests, selectorsOf, verifyExecutedReport, type ExecutedReport } from '../../tools/ci/e2eWeightedPlan';
const tests = (ids: string[]) => ids.map((id) => ({ id, selector: `[chromium] › a.spec.ts › ${id}` }));
const report = (): ExecutedReport => ({
  errors: [],
  suites: [
    {
      specs: [
        {
          id: 'a',
          ok: true,
          tests: [{ projectId: 'chromium', expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0 }] }],
        },
      ],
    },
  ],
});
describe('asignación por coste sin seleccionar menos pruebas', () => {
  it('reduce el máximo previsto con el mismo total de trabajo y de pruebas', () => {
    const weights = { a: 900, b: 800, c: 700, d: 600, e: 500, f: 400 };
    const plan = balanceTests(tests(Object.keys(weights)), weights, 2);
    expect(plan.shards.map((s) => s.estimatedMs)).toEqual([2000, 1900]);
    expect(plan.shards.flatMap((s) => s.tests.map((t) => t.id)).sort()).toEqual(Object.keys(weights));
    expect(plan.shards.reduce((sum, s) => sum + s.estimatedMs, 0)).toBe(3900);
  });
  it('incluye nuevas pruebas sin pesos y los pesos obsoletos no crean pruebas', () => {
    const p = balanceTests(tests(['known', 'new']), { known: 300, obsolete: 900 }, 2);
    expect(p.shards.flatMap((s) => s.tests.map((t) => t.id)).sort()).toEqual(['known', 'new']);
    expect(p.fallbackMs).toBe(900);
    expect(balanceTests(tests(['new']), {}, 1).shards[0].estimatedMs).toBe(120000);
  });
  it('el plan es determinista aunque se enumere al revés', () => {
    const t = tests(['d', 'b', 'a', 'c']);
    expect(balanceTests(t, {}, 2)).toEqual(balanceTests([...t].reverse(), {}, 2));
  });
  it('rechaza datos inválidos y duplicados antes de abrir navegadores', () => {
    for (const count of [0, 1.5, 3]) expect(() => balanceTests(tests(['a', 'b']), {}, count)).toThrow();
    for (const cost of [0, -1, NaN, Infinity]) expect(() => balanceTests(tests(['a']), { a: cost }, 1)).toThrow();
    expect(() => balanceTests(tests(['a', 'a']), {}, 1)).toThrow();
  });
  it('construye selectores nativos completos, también con grupos y proyectos', () => {
    const r = {
      errors: [],
      suites: [
        {
          title: 'a.spec.ts',
          suites: [
            {
              title: 'grupo',
              specs: [
                {
                  id: 'a',
                  file: 'a.spec.ts',
                  title: 'caso θ',
                  tests: [
                    { projectId: 'chromium', projectName: 'chromium', expectedStatus: 'passed' },
                    { projectId: 'webkit', expectedStatus: 'passed' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(selectorsOf(r)).toEqual([
      { id: 'a/chromium', selector: '[chromium] › a.spec.ts › grupo › caso θ' },
      { id: 'a/webkit', selector: '[webkit] › a.spec.ts › grupo › caso θ' },
    ]);
    expect(() =>
      selectorsOf({ errors: [], suites: [{ specs: [{ id: 'a', tests: [{ projectId: 'chromium', expectedStatus: 'passed' }] }] }] }),
    ).toThrow();
  });
});
describe('veredicto basado en ejecución real', () => {
  it('acepta únicamente el conjunto esperado, pasado una sola vez', () => {
    expect(verifyExecutedReport(report(), ['a/chromium'])).toEqual(['a/chromium']);
    expect(() => verifyExecutedReport(report(), ['missing/chromium'])).toThrow();
    expect(() => verifyExecutedReport(report(), ['a/chromium', 'missing/chromium'])).toThrow();
  });
  it('rechaza fallos, omisiones y pases tras reintento', () => {
    for (const mutate of [
      (r: ExecutedReport) => {
        r.errors.push('runner failed');
      },
      (r: ExecutedReport) => {
        r.suites[0].specs![0].ok = false;
      },
      (r: ExecutedReport) => {
        r.suites[0].specs![0].tests[0].expectedStatus = 'skipped';
      },
      (r: ExecutedReport) => {
        r.suites[0].specs![0].tests[0].status = 'flaky';
      },
      (r: ExecutedReport) => {
        r.suites[0].specs![0].tests[0].results[0].status = 'failed';
      },
      (r: ExecutedReport) => {
        r.suites[0].specs![0].tests[0].results[0].retry = 1;
      },
      (r: ExecutedReport) => {
        r.suites[0].specs![0].tests[0].results.push({ status: 'passed', retry: 1 });
      },
      (r: ExecutedReport) => {
        r.suites.push(structuredClone(r.suites[0]));
      },
    ]) {
      const r = report();
      mutate(r);
      expect(() => verifyExecutedReport(r, ['a/chromium'])).toThrow();
    }
  });
  it('CI conserva el veredicto protegido y exige informes de ejecución, incluso los metadatos ocultos', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow).toContain('name: CI verde (check + e2e)');
    expect(workflow).toContain('needs: [check, e2e]');
    expect(workflow).toContain('include-hidden-files: true');
    expect(workflow).toContain('tools/ci/verify-e2e-execution.ts e2e-evidence');
    expect(readFileSync('tools/ci/run-e2e-shard.ts', 'utf8')).toContain("'--forbid-only'");
  });
});
