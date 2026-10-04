/** Research only: can small physical probe adjustments recover a reference-body hepatic window? */
import { readFileSync, writeFileSync } from 'node:fs';
import { NORMAL_ADULT, TRICUSPID_REGURGITATION } from '../../src/cases';
import { AnatomyScene } from '../../src/anatomy/scene';
import { AnatomyQuery } from '../../src/anatomy/query';
import { setReferenceBody } from '../../src/anatomy/referenceBody';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { startPointsFor } from '../../src/app/startPoints';
import { bestGateOnVessel } from '../../src/app/gatePlacement';
import { acousticWindowWeight } from '../../src/app/gateTransmission';
import { pwGate } from '../../src/app/pwGate';
import { probeContact } from '../../src/probe/contact';
import { CONVEX_C35_PROFILE as PROFILE } from '../../src/ultrasound/transducerProfile';
import { DEFAULT_BMODE } from '../../src/ultrasound/renderer';
const b = readFileSync('src/anatomy/reference-body.bin');
setReferenceBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
const results = [];
for (const base of [NORMAL_ADULT, TRICUSPID_REGURGITATION]) {
  const p = { ...base, respiratoryPattern: 'quiet' as const };
  const query = new AnatomyQuery(new AnatomyScene(p)),
    engine = new PhysiologyEngine(p, query.scene.vesselAreas());
  while (engine.clock.t < 2 - 1e-9) engine.step();
  const sp = startPointsFor(query.scene.torso).find((s) => s.id === 'intercostal')!;
  for (const [rock, tilt] of [
    [0, 0],
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
    [4, 0],
    [-4, 0],
    [0, 4],
    [0, -4],
  ]) {
    const contact = probeContact(
      {
        phi: sp.phi,
        z: sp.z,
        yaw: sp.yaw,
        rock: (sp.rock ?? 0) + (rock * Math.PI) / 180,
        tilt: (sp.tilt ?? 0) + (tilt * Math.PI) / 180,
        lift: 0,
      },
      PROFILE.geometry,
      query.scene.torso,
    );
    query.setProbeCompression(contact);
    const w = acousticWindowWeight(
      query,
      contact.frame,
      PROFILE.geometry,
      contact,
      engine.sample,
      DEFAULT_BMODE.depthMm,
      PROFILE.dopplerEffectiveMHz,
    );
    const best = bestGateOnVessel(query, contact.frame, PROFILE.geometry, engine.sample, ['hvRight'], 175, 1.2, w);
    const info = best
      ? pwGate(
          query,
          contact.frame,
          contact,
          PROFILE,
          DEFAULT_BMODE.focusMm,
          { theta: best.theta, depthMm: best.r, gateMm: 4 },
          engine.sample,
        ).info
      : null;
    results.push({ case: p.id, rock, tilt, best, info });
  }
}
setReferenceBody();
writeFileSync('/tmp/virtual-window-pose-audit.json', JSON.stringify(results, null, 2));
for (const r of results) console.log(r.case, r.rock, r.tilt, r.best?.cosAngle ?? null, r.info?.transmission ?? null);
