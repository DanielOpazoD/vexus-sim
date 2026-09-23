// @tier slow
import { describe, expect, it } from 'vitest';
import { bestGateOnVessel } from '../app/gatePlacement';
import { START_POINTS } from '../app/startPoints';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { SampleVolumeIQ, type GateGeometry } from '../doppler/sampleVolume';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient } from '../physiology/patientState';
import type { RespiratoryPattern } from '../physiology/patientState';
import type { VesselId } from '../physiology/vessels';
import { CONVEX_C35, lineDirection, pointOnLine, probeFrame } from '../probe/probe';
import { apertureAngleSigmaRad, lateralSigmaMm } from '../ultrasound/beamModel';

/**
 * El volumen de muestra con historia (dispersores persistentes que entran y salen de la caja) debe
 * describir la MISMA geometría que una siembra nueva en ese instante: si no, la puerta «recuerda»
 * lo que hubo. Antes, sobre el tronco portal con respiración tranquila, la sangre caía del 97 % al
 * 0 % en la primera inspiración y no volvía, aunque el centro de la puerta nunca salió del vaso
 * (siembra nueva: 95–100 %). Causa: la comprobación de salida y la resiembra usaban dos
 * desplazamientos distintos y los dispersores de tejido se resembraban en bucle en las caras.
 */
function track(
  window: (typeof START_POINTS)[number]['id'],
  vessels: VesselId[],
  seconds: number,
  respiratoryPattern: RespiratoryPattern = 'quiet',
  fromSeconds = 0,
) {
  const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern };
  const scene = new AnatomyScene(patient);
  const anatomy = new AnatomyQuery(scene);
  const engine = new PhysiologyEngine(patient, scene.vesselAreas());
  for (let i = 0; i < 500; i++) engine.step();
  for (let k = 0; engine.sample.resp.volume > 0.01 && k < 5000; k++) engine.step();
  const sp = START_POINTS.find((s) => s.id === window)!;
  const frame = probeFrame({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 }, scene.torso, CONVEX_C35);
  const best = bestGateOnVessel(anatomy, frame, CONVEX_C35, engine.sample, vessels, 170)!;
  const c = Math.cos(best.theta);
  const sn = Math.sin(best.theta);
  const lateral: Vec3 = [
    frame.lateral[0] * c - frame.axial[0] * sn,
    frame.lateral[1] * c - frame.axial[1] * sn,
    frame.lateral[2] * c - frame.axial[2] * sn,
  ];
  const gate: GateGeometry = {
    center: pointOnLine(frame, CONVEX_C35, best.theta, best.r),
    beamDir: lineDirection(frame, best.theta),
    lateral,
    elevation: frame.elevation,
    lengthMm: 4,
    lateralSigmaMm: lateralSigmaMm(best.r, 90) * 1.2,
    elevationSigmaMm: 1.6,
    pulseSigmaMm: 0.5,
    apertureAngleSigmaRad: apertureAngleSigmaRad(best.r),
    transmission: 0.3,
  };
  const sv = new SampleVolumeIQ(anatomy, 7);
  const prf = 2600;
  sv.setEquipment({ prfHz: prf, f0Hz: CONVEX_C35.f0Doppler });
  sv.setGate(gate, engine.sample);
  const re = new Float32Array(64);
  const im = new Float32Array(64);
  let acc = 0;
  const samples: Array<{ t: number; resp: number; history: number; fresh: number; historyWeight: number; freshWeight: number }> = [];
  const t0 = engine.clock.t;
  for (let i = 0; i < Math.round(seconds / engine.clock.dt); i++) {
    const s = engine.step();
    acc += prf * engine.clock.dt;
    const n = Math.floor(acc);
    acc -= n;
    if (n > 0) sv.generate(s, [0, 0, 0], n, re, im);
    if (i % 60 === 0 && s.t - t0 >= fromSeconds) {
      const fresh = new SampleVolumeIQ(anatomy, 99 + i);
      fresh.setGate(gate, s);
      samples.push({
        t: s.t - t0,
        resp: s.resp.volume,
        history: sv.lastComposition.bloodFraction,
        fresh: fresh.lastComposition.bloodFraction,
        historyWeight: sv.lastComposition.bloodWeight,
        freshWeight: fresh.lastComposition.bloodWeight,
      });
    }
  }
  return samples;
}

describe('Volumen de muestra: la puerta no recuerda la geometría anterior', () => {
  it('tronco portal con respiración tranquila: la sangre sigue a una siembra nueva durante dos respiraciones', () => {
    const samples = track('flank', ['pvRight', 'pvTrunk'], 9);
    const meanAbs = samples.reduce((a, x) => a + Math.abs(x.history - x.fresh), 0) / samples.length;
    expect(meanAbs).toBeLessThan(0.05); // medido 0,017 (antes 0,6)
    // en cada fin de espiración, la puerta con historia tiene la sangre de una siembra nueva
    const endExp = samples.slice(10).filter((x) => x.resp < 0.02);
    expect(endExp.length).toBeGreaterThan(3);
    for (const x of endExp) expect(x.history).toBeGreaterThan(0.9 * x.fresh);
  });

  // Con la puerta quieta y sin respirar, la población no puede cambiar de distribución. Antes la
  // sangre derivaba hacia una esquina de la caja y quedaba atrapada en cuerdas cortas: el peso de
  // sangre caía a una fracción del de una siembra nueva y la VSH del sano acababa «sin señal».
  it('suprahepática del sano en apnea: la sangre no se va a los bordes de la caja en 20 s', () => {
    const samples = track('intercostal', ['hvRight'], 22, 'apnea-expiratory', 14);
    expect(samples.length).toBeGreaterThan(20);
    const ratio = samples.reduce((a, x) => a + x.historyWeight / x.freshWeight, 0) / samples.length;
    expect(ratio).toBeGreaterThan(0.8);
    for (const x of samples) expect(x.history).toBeGreaterThan(0.9 * x.fresh);
  });
});
