import { readFileSync, writeFileSync } from 'node:fs';
import { NORMAL_ADULT } from '../../src/cases';
import { setReferenceBody } from '../../src/validation/support/legacyPerson/referenceBody';
import { openSession, placeGate, probeAt } from '../../src/validation/support/studentChain';
const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const results = [];
for (const reference of [false, true]) {
  setReferenceBody(reference ? profile : undefined);
  for (const [window, vessels] of [
    ['intercostal', ['hvRight']],
    ['portal', ['pvTrunk']],
    ['renal', ['interlobarVein1', 'interlobarVein2', 'interlobarVein3']],
  ] as const) {
    const session = openSession(NORMAL_ADULT, 'apnea-expiratory');
    const contact = probeAt(session, window),
      gate = placeGate(session, contact, vessels, { acoustic: true, maxDepthMm: 175 });
    const result = { reference, window, gate, angleDegrees: gate ? (Math.acos(gate.cosAngle) * 180) / Math.PI : null };
    results.push(result);
    console.log(result);
  }
}
setReferenceBody();
writeFileSync('/tmp/pw-preset-geometry.json', JSON.stringify(results, null, 2));
