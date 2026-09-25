import { describe, expect, it } from 'vitest';
import { bestGateOnVessel } from '../app/gatePlacement';
import { gateTransmission } from '../app/gateTransmission';
import { START_POINTS } from '../app/startPoints';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { contactForPose } from '../probe/contact';
import { CONVEX_C35, probeFrame, type ProbePose } from '../probe/probe';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';

/**
 * Invariante nueva (§23 de la guía, «vasos que aparecen con la sonda mal situada»): sin contacto no
 * hay eco Doppler. Antes la transmisión de la puerta ignoraba el acoplamiento sonda–piel: con la
 * sonda levantada 10 mm el modo B se apagaba pero el espectro renal seguía 13,8 dB sobre el ruido.
 */
describe('Transmisión hasta la puerta PW', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  const anatomy = new AnatomyQuery(scene);
  const sample = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas()).step();
  const sp = START_POINTS.find((s) => s.id === 'renal')!;
  const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
  const frame = probeFrame(pose, scene.torso, CONVEX_C35);
  const gate = bestGateOnVessel(anatomy, frame, CONVEX_C35, sample, ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'], 170)!;
  const t = (p: ProbePose) =>
    gateTransmission(
      anatomy,
      frame,
      CONVEX_C35,
      contactForPose(p, CONVEX_C35, scene.torso),
      gate.theta,
      gate.r,
      sample,
      CONVEX_C35_PROFILE.dopplerEffectiveMHz,
    );

  it('en contacto llega eco a la interlobar; separada 10 mm de la piel, nada', () => {
    expect(gate).not.toBeNull();
    const contact = t(pose);
    expect(contact).toBeGreaterThan(0.01);
    expect(t({ ...pose, lift: 10 })).toBe(0);
    // el acoplamiento parcial atenúa sin apagar (misma ley que el modo B)
    const partial = t({ ...pose, lift: 3 });
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(contact);
  });
});
