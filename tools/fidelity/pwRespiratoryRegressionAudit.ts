/** Reproduce existing respiratory matrix failures with acquisition provenance. */
import { writeFileSync } from 'node:fs';
import { SEVERE_CONGESTION } from '../../src/cases';
import { openSession, probeAt, placeGate, acquire } from '../../src/validation/support/studentChain';
import { measurePhysiologyTruth } from '../../src/vexus/measurements';
const results = [];
for (const [kind, vessels] of [
  ['portal', ['pvTrunk']],
  ['renal', ['interlobarVein1', 'interlobarVein2', 'interlobarVein3']],
] as const) {
  const session = openSession(SEVERE_CONGESTION, 'quiet');
  const contact = probeAt(session, kind),
    best = placeGate(session, contact, vessels, { acoustic: false, maxDepthMm: 170 })!;
  const prfHz = Math.min(6000, Math.floor((0.9 * 1_540_000) / (2 * best.r)));
  const captured = acquire(session, contact, best, kind, { prfHz, seconds: 8.5, gateMm: Math.min(4, 2 * best.bd) });
  const truth = measurePhysiologyTruth(session.engine, { fromT: session.engine.clock.t - 10, toT: session.engine.clock.t });
  results.push({
    kind,
    best,
    prfHz,
    truth,
    ...captured,
    columns: session.chain.spectral.columns.map((c) => ({ ...c, powerDb: [...c.powerDb] })),
  });
  const m = captured.captures.at(-1)?.m;
  console.log(kind, JSON.stringify({ truthPF: truth.portalPF, quality: m?.quality }));
}
writeFileSync('/tmp/pw-respiratory-regression.json', JSON.stringify(results));
