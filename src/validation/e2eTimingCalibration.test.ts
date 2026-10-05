import { describe, expect, it } from 'vitest';
import { calibrateE2ETimings, type TimingRun } from '../../tools/ci/e2eTimingCalibration';
const ids = ['a/chromium', 'b/chromium', 'c/chromium'];
function run(runId: number, durations: number[]): TimingRun {
  const sourceSha = String(runId).repeat(40);
  const plan = { all: [...ids], shards: [ids.slice(0, 2), ids.slice(2)] };
  return {
    runId,
    sourceSha,
    shards: plan.shards.map((group, i) => ({
      execution: { index: i + 1, total: 2, sourceSha, plan: structuredClone(plan) },
      report: {
        errors: [],
        suites: [
          {
            suites: [
              {
                specs: group.map((id) => ({
                  id: id.split('/')[0],
                  ok: true,
                  tests: [
                    {
                      projectId: 'chromium',
                      expectedStatus: 'passed',
                      status: 'expected',
                      results: [{ status: 'passed', retry: 0, duration: durations[ids.indexOf(id)] }],
                    },
                  ],
                })),
              },
            ],
          },
        ],
      },
    })),
  };
}
const fixture = () => [run(1, [100, 600, 30]), run(2, [300, 200, 90]), run(3, [200, 400, 60])];
const firstResult = (r: TimingRun) => r.shards[0].report.suites[0].suites![0].specs![0].tests[0].results[0];
describe('recalibración E2E basada en ejecuciones completas', () => {
  it('calcula medianas exactas sin cambiar entradas, independientemente del orden de runs y shards', () => {
    const input = fixture(),
      before = structuredClone(input),
      out = calibrateE2ETimings(input, ids);
    expect(out.durationMs).toEqual({ 'a/chromium': 200, 'b/chromium': 400, 'c/chromium': 60 });
    expect(out.sources.map((s) => s.runId)).toEqual([1, 2, 3]);
    expect(
      calibrateE2ETimings(
        [...input].reverse().map((r) => ({ ...r, shards: [...r.shards].reverse() })),
        [...ids].reverse(),
      ),
    ).toEqual(out);
    expect(input).toEqual(before);
  });
  it('admite repeticiones independientes del mismo commit, nunca IDs de ejecución duplicados', () => {
    const input = fixture();
    for (const r of input) {
      r.sourceSha = input[0].sourceSha;
      for (const shard of r.shards) shard.execution.sourceSha = r.sourceSha;
    }
    expect(calibrateE2ETimings(input, ids).durationMs['a/chromium']).toBe(200);
    input[1].runId = input[0].runId;
    expect(() => calibrateE2ETimings(input, ids)).toThrow();
  });
  it('exige tres fuentes y la colección actual completa', () => {
    const input = fixture();
    for (const runs of [[], input.slice(1), [...input, run(4, [1, 1, 1])]]) expect(() => calibrateE2ETimings(runs, ids)).toThrow();
    for (const list of [[], ids.slice(1), [...ids, 'new/chromium'], [...ids, ids[0]]])
      expect(() => calibrateE2ETimings(input, list)).toThrow();
  });
  it('rechaza identidad inválida, mezcla de SHA y particiones inconsistentes', () => {
    for (const mutate of [
      (r: TimingRun) => {
        r.runId = NaN;
      },
      (r: TimingRun) => {
        r.sourceSha = 'wrong';
      },
      (r: TimingRun) => {
        r.shards[1].execution.sourceSha = 'f'.repeat(40);
      },
      (r: TimingRun) => {
        r.shards[1].execution.plan.all.reverse();
      },
      (r: TimingRun) => {
        r.shards[1].execution.plan.shards.reverse();
      },
      (r: TimingRun) => {
        r.shards[1].execution.total = 3;
      },
    ]) {
      const input = fixture();
      mutate(input[1]);
      expect(() => calibrateE2ETimings(input, ids)).toThrow();
    }
  });
  it('no acepta shards omitidos, extra, repetidos o vacíos', () => {
    for (const mutate of [
      (r: TimingRun) => {
        r.shards.pop();
      },
      (r: TimingRun) => {
        r.shards.push(structuredClone(r.shards[0]));
      },
      (r: TimingRun) => {
        r.shards[1].execution.index = 1;
      },
      (r: TimingRun) => {
        r.shards = [];
      },
      (r: TimingRun) => {
        r.shards[0].execution.plan.shards = [];
      },
    ]) {
      const input = fixture();
      mutate(input[0]);
      expect(() => calibrateE2ETimings(input, ids)).toThrow();
    }
  });
  it('un job verde no sustituye ejecución real única y sin reintento', () => {
    for (const mutate of [
      (r: TimingRun) => {
        firstResult(r).retry = 1;
      },
      (r: TimingRun) => {
        firstResult(r).status = 'skipped';
      },
      (r: TimingRun) => {
        r.shards[0].report.errors.push('browser failure');
      },
      (r: TimingRun) => {
        r.shards[0].report.suites[0].suites![0].specs!.pop();
      },
      (r: TimingRun) => {
        r.shards[0].report.suites[0].suites![0].specs!.push(structuredClone(r.shards[0].report.suites[0].suites![0].specs![0]));
      },
    ]) {
      const input = fixture();
      mutate(input[2]);
      expect(() => calibrateE2ETimings(input, ids)).toThrow();
    }
  });
  it('rechaza duraciones ausentes, no finitas o no positivas', () => {
    for (const value of [0, -1, NaN, Infinity, undefined]) {
      const input = fixture();
      firstResult(input[0]).duration = value as number;
      expect(() => calibrateE2ETimings(input, ids)).toThrow();
    }
  });
  it('no redondea una duración positiva pequeña a cero', () => {
    const input = fixture();
    input.forEach((r, i) => {
      firstResult(r).duration = 0.1 * (i + 1);
    });
    expect(calibrateE2ETimings(input, ids).durationMs['a/chromium']).toBe(0.2);
  });
});
