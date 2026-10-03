/** Auditoría offline de captura suprahepática en PPV; no banco clínico. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { MECHANICAL_VENTILATION } from '../../src/cases';
import { measurePhysiologyTruth } from '../../src/vexus/measurements';
import { acquire, openSession, placeGate, probeAt } from '../../src/validation/support/studentChain';
const results = [];
for (let offset = 0; offset < 20; offset++) {
  const patient = { ...MECHANICAL_VENTILATION, seed: MECHANICAL_VENTILATION.seed + offset };
  const session = openSession(patient, 'quiet', 0, 30);
  const contact = probeAt(session, 'intercostal');
  const best = placeGate(session, contact, ['hvRight'], { acoustic: true, maxDepthMm: 170 });
  if (!best) throw new Error(`Sin puerta en semilla ${patient.seed}`);
  const { captures } = acquire(session, contact, best, 'hepatic', {
    prfHz: Math.min(6000, Math.floor((0.9 * 1540000) / (2 * best.r))),
    seconds: 26,
    captureEvery: 2,
    firstAt: 8,
    gateMm: Math.min(4, 2 * best.bd),
  });
  const comparisons = captures.map(({ t, m }) => {
    const first = m?.measuredBeats[0],
      last = m?.measuredBeats.at(-1);
    const truth = first && last ? measurePhysiologyTruth(session.engine, { fromT: first.tR - 1e-8, toT: last.tR + last.rr + 1e-8 }) : null;
    return {
      t,
      observed: m?.pattern ?? null,
      issue: m?.quality.issue ?? (m ? null : 'no-measurement'),
      truth: truth?.hepaticPattern ?? null,
    };
  });
  results.push({ seed: patient.seed, offset, comparisons });
}
const all = results.flatMap((r) => r.comparisons);
const falseAccepted = all.filter((r) => r.issue === null && r.observed !== r.truth);
const report = {
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  headTreeSha: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
  clinicalValidation: false,
  method:
    '20 consecutive seeds; quiet breathing + positive pressure; fixed intercostal gate; 10 captures/seed; truth from the same complete measured beats, not the whole simulation',
  captures: all.length,
  accepted: all.filter((r) => r.issue === null).length,
  falseAccepted: falseAccepted.length,
  results,
};
const json = JSON.stringify(report, null, 2) + '\n';
if (process.argv[2]) writeFileSync(process.argv[2], json);
else process.stdout.write(json);
if (falseAccepted.length) process.exitCode = 1;
