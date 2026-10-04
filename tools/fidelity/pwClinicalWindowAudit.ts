import { readFileSync, writeFileSync } from 'node:fs';
import { NORMAL_ADULT } from '../../src/cases';
import { openSession, probeAt, placeGate, acquire, PROFILE, TR } from '../../src/validation/support/studentChain';
import { setReferenceBody } from '../../src/anatomy/referenceBody';
import { pwGate } from '../../src/app/pwGate';
import { DEFAULT_BMODE } from '../../src/ultrasound/renderer';
const bytes = readFileSync('src/anatomy/reference-body.bin');
setReferenceBody(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
const results = [];
for (const [kind, window, vessels, prf] of [
  ['hepatic', 'intercostal', ['hvRight'], 2500],
  ['portal', 'portal', ['pvTrunk'], 1600],
  ['renal', 'renal', ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'], 1300],
] as const) {
  const session = openSession(NORMAL_ADULT, 'apnea-expiratory', 0, 12);
  for (let k = 0; k < 7000; k++) session.engine.step();
  const contact = probeAt(session, window),
    best = placeGate(session, contact, vessels, { acoustic: true, maxDepthMm: 175 });
  if (!best) throw Error('No gate');
  const gateMm = kind === 'renal' ? 2 : 4;
  const geometry = pwGate(
    session.anatomy,
    contact.frame,
    contact,
    PROFILE,
    DEFAULT_BMODE.focusMm,
    { theta: best.theta, depthMm: best.r, gateMm },
    session.engine.sample,
  );
  const result = acquire(session, contact, best, kind, { prfHz: prf, seconds: 6.5, gateMm, wallFilterHz: 15 });
  const measurement = result.captures.at(-1)!.m;
  results.push({
    kind,
    gate: geometry,
    f0Hz: TR.f0Doppler,
    prf,
    measurement,
    columns: session.chain.spectral.columns.map((c) => ({ ...c, powerDb: [...c.powerDb] })),
  });
  console.log(kind, geometry.gate, geometry.info, measurement?.quality);
}
setReferenceBody();
writeFileSync('/tmp/pw-clinical-windows.json', JSON.stringify(results));
