import { AnatomyQuery } from '../src/anatomy/query';
import { AnatomyScene } from '../src/anatomy/scene';
import { NORMAL_ADULT } from '../src/cases';
import type { Vec3 } from '../src/core/vec3';
import { PwDopplerChain } from '../src/doppler/pwChain';
import type { GateGeometry } from '../src/doppler/sampleVolume';
import { measureObservedHepatic, observedTrace } from '../src/doppler/spectralMeasure';
import { PhysiologyEngine } from '../src/physiology/engine';
import { clonePatient } from '../src/physiology/patientState';
import { CONVEX_C35, lineDirection, pointOnLine, probeFrame, type ProbePose } from '../src/probe/probe';
import { beatWindows } from '../src/vexus/measurements';

const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-expiratory' as const };
const scene = new AnatomyScene(patient);
const anatomy = new AnatomyQuery(scene);
const engine = new PhysiologyEngine(patient, scene.vesselAreas());
const chain = new PwDopplerChain(anatomy, patient.seed);
const pose: ProbePose = { phi: Math.PI * 0.92, z: 20, lift: 0, yaw: 0, rock: 0, tilt: -0.12 };
const frame = probeFrame(pose, scene.torso, CONVEX_C35);
const gateAt = (theta: number, r: number): GateGeometry => {
  const dir = lineDirection(frame, theta);
  const c = Math.cos(theta),
    sn = Math.sin(theta);
  const lateral: Vec3 = [
    frame.lateral[0] * c - frame.axial[0] * sn,
    frame.lateral[1] * c - frame.axial[1] * sn,
    frame.lateral[2] * c - frame.axial[2] * sn,
  ];
  return {
    center: pointOnLine(frame, CONVEX_C35, theta, r),
    beamDir: dir,
    lateral,
    elevation: frame.elevation,
    lengthMm: 4,
    lateralSigmaMm: 2.2,
    elevationSigmaMm: 2.0,
    pulseSigmaMm: 0.5,
    transmission: 0.3,
  };
};
let best: { theta: number; r: number; bd: number } | null = null;
for (let th = -0.5; th <= 0.5; th += 0.02)
  for (let r = 20; r <= 150; r += 2) {
    const q = anatomy.classifyWorld(gateAt(th, r).center, engine.sample);
    if (q.vessel === 'hvRight' && (!best || q.boundaryDistance > best.bd)) best = { theta: th, r, bd: q.boundaryDistance };
  }
const gate = gateAt(best!.theta, best!.r);
console.log(
  'gate',
  best,
  'center',
  gate.center.map((v) => v.toFixed(1)),
);
const steps = Math.round(4 / engine.clock.dt);
chain.begin(2600, CONVEX_C35.f0Doppler, 0, 25, engine.clock.t + engine.clock.dt);
for (let i = 0; i < steps; i++) {
  const s = engine.step();
  if (i % 8 === 0) chain.setGate(gate, s);
  chain.step(s, [0, 0, 0], engine.clock.dt);
}
chain.flush();
const opts = { f0Hz: CONVEX_C35.f0Doppler, angleCorrectionRad: 0, invert: false, fftSize: 128 };
const trace = observedTrace(chain.spectral.columns, opts);
const tNow = engine.clock.t;
const beats = engine.rhythm.beatsAround(tNow - 2).filter((b) => b.tR > tNow - 3.5 && b.tR + b.rr < tNow);
const m = measureObservedHepatic(chain.spectral.columns, beats, opts);
console.log('measured', m && { s: m.sPeak, d: m.dPeak, a: m.aPeak, pattern: m.pattern, sign: m.anterogradeSign, beats: m.beats });
const b = beats[beats.length - 1];
const w = beatWindows(b);
console.log('windows', {
  tR: b.tR.toFixed(3),
  s: w.sWindow.map((x) => x.toFixed(3)),
  d: w.dWindow.map((x) => x.toFixed(3)),
  a: w.aWindow.map((x) => x.toFixed(3)),
});
const seg = trace.filter((p) => p.t >= b.tR - 0.1 && p.t <= b.tR + b.rr);
console.log(seg.map((p) => `${(p.t - b.tR).toFixed(2)}:${p.vScreen.toFixed(0)}`).join(' '));
// verdad
const truth = engine.samples
  .filter((s) => s.t >= b.tR - 0.1 && s.t <= b.tR + b.rr && Math.round(s.t * 250) % 10 === 0)
  .map((s) => `${(s.t - b.tR).toFixed(2)}:${(s.velocities.hvRight / 10).toFixed(0)}`)
  .join(' ');
console.log('truth uHV', truth);
console.log('comp', chain.sampleVolume.lastComposition);
