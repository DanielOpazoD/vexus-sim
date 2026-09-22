import { AnatomyScene } from '../src/anatomy/scene';
import { CASES } from '../src/cases';
import { PhysiologyEngine } from '../src/physiology/engine';
const id = process.argv[2] ?? 'severe-congestion';
const patient = CASES.find((c) => c.id === id)!;
const scene = new AnatomyScene(patient);
const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 20 });
for (let i = 0; i < 10 / engine.clock.dt; i++) engine.step();
const s0 = engine.sample;
const beat = engine.rhythm.currentBeat(s0.t);
const tStart = beat.tR + beat.rr; // next beat
for (let i = 0; i < 2 / engine.clock.dt; i++) {
  const s = engine.step();
  if (s.t < tStart || s.t > tStart + 1.0) continue;
  if (engine.clock.step % 5 !== 0) continue;
  console.log(
    `${(s.t - tStart).toFixed(3)} ecg=${s.ecgMv.toFixed(2)} Pra=${s.pRa.toFixed(1)} Pivc=${s.pIvc.toFixed(1)} Ph=${s.pHepatic.toFixed(1)} Qhv=${s.qHepaticVein.toFixed(1)} uHV=${(s.velocities.hvRight / 10).toFixed(1)} uPV=${(s.velocities.pvTrunk / 10).toFixed(1)} Divc=${s.ivc.dApMm.toFixed(1)} v=${s.resp.volume.toFixed(2)}`,
  );
}
