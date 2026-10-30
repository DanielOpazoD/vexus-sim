import { describe, expect, it } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { pwGate } from '../app/pwGate';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import type { Vec3 } from '../core/vec3';
import { SampleVolumeIQ, type GateGeometry } from '../doppler/sampleVolume';
import { PhysiologyEngine, type PhysiologySample } from '../physiology/engine';
import type { VesselId } from '../physiology/vessels';
import { DEFAULT_BMODE } from '../ultrasound/renderer';
import { openSession, placeGate, probeAt, PROFILE } from './support/studentChain';

/** Lo que estas pruebas leen de la población (decisión 294): identidad, punto material, peso y dominio de cada dispersor. */
interface Particle {
  m: Vec3;
  g: Vec3;
  amp: number;
  isBlood: boolean;
  vessel: VesselId | null;
  imp: number;
  stream: { def: object } | null;
}
interface Internals {
  scatterers: Particle[];
  weightAt(g: Vec3): number;
  ownsPoint(stream: object, m: Vec3): boolean;
}

/** Escena y fisiología del sano en apnea, sin respiración, con el flujo original o nulo (aísla la geometría). */
function fixedScene(flow: boolean) {
  const patient = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
  const scene = new AnatomyScene(patient);
  const anatomy = new AnatomyQuery(scene);
  const raw = new PhysiologyEngine(patient, scene.vesselAreas()).sample;
  const velocities = flow ? raw.velocities : (Object.fromEntries(Object.keys(raw.velocities).map((k) => [k, 0])) as typeof raw.velocities);
  const base: PhysiologySample = { ...raw, resp: { ...raw.resp, diaphragmCaudalMm: 0, diaphragmVelocityMmS: 0 }, velocities };
  return { scene, anatomy, base };
}

function smallGate(center: Vec3, sigma: number): GateGeometry {
  return {
    center,
    beamDir: [0, 0, 1],
    lateral: [1, 0, 0],
    elevation: [0, 1, 0],
    lengthMm: 1,
    pulseSigmaMm: 0.2,
    lateralSigmaMm: sigma,
    elevationSigmaMm: sigma,
    transmission: 1,
  };
}

describe('identidad de la población PW cuando la luz cambia (decisión 294)', () => {
  it('la luz que crece hacia una puerta de tejido se llena de sangre y el tejido de dentro se apaga', () => {
    // Revisión r1: la suprahepática se dilata (calibre 0,75 → 1,4 en 1 s, flujo original) sobre una puerta que solo veía
    // tejido. Antes la población seguía sin sangre (peso 0 frente a 0,124 de una siembra nueva) y 240 de 320 dispersores
    // de tejido seguían sonando dentro de la luz.
    const { scene, anatomy, base } = fixedScene(true);
    const at = (scale: number): PhysiologySample => ({ ...base, hvRadiusScale: scale });
    const def = scene.vesselById.get('hvRight')!;
    let checked = 0;
    for (let j = 0; j < def.tube.nodes.length - 1; j++) {
      const p = def.tube.nodes[j].p,
        q = def.tube.nodes[j + 1].p;
      const r = (def.tube.nodes[j].r + def.tube.nodes[j + 1].r) / 2;
      const gate = smallGate([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + 1.08 * r, (p[2] + q[2]) / 2], 0.2);
      const volume = new SampleVolumeIQ(anatomy, 47);
      volume.setGate(gate, at(0.75));
      const fresh = new SampleVolumeIQ(anatomy, 47);
      fresh.setGate(gate, at(1.4));
      if (volume.lastComposition.bloodFraction > 0.001 || fresh.lastComposition.bloodFraction < 0.9) continue;
      checked++;
      const re = new Float32Array(16),
        im = new Float32Array(16);
      for (let k = 0; k < 250; k++) volume.generate(at(0.75 + (0.65 * (k + 1)) / 250), [0, 0, 0], k % 5 < 2 ? 11 : 10, re, im);
      const after = at(1.4);
      for (let k = 0; k < 64; k++) volume.generate(after, [0, 0, 0], 8, re, im);
      const tag = `segmento ${j}`;
      expect(volume.lastComposition.bloodWeight / fresh.lastComposition.bloodWeight, tag).toBeGreaterThan(0.8);
      const internals = volume as unknown as Internals;
      let inLumen = 0;
      let loudTissue = 0;
      for (const s of internals.scatterers) {
        const c = anatomy.classifyMaterial(s.m, after);
        if (c.tissue !== Tissue.Blood) continue;
        inLumen++;
        if (!s.isBlood && s.amp > 1e-3) loudTissue++;
      }
      expect(loudTissue / inLumen, tag).toBeLessThan(0.05);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('el colapso AP de la cava no deja sangre fuera de su luz', () => {
    // Revisión r1: la relación AP/lateral de la cava infrahepática pasa de 0,9 a 0,35 sin flujo. Antes las 320 partículas
    // de sangre seguían su sección vieja: el 100 % del peso sanguíneo emitido quedaba fuera de la luz.
    const { scene, anatomy, base } = fixedScene(false);
    const at = (ap: number): PhysiologySample => {
      const supra = base.ivcSupra ?? base.ivc;
      return { ...base, ivc: { ...base.ivc, dApMm: base.ivc.dLatMm * ap }, ivcSupra: { ...supra, dApMm: supra.dLatMm * ap } };
    };
    const before = at(0.9),
      after = at(0.35);
    const def = scene.vesselById.get('ivcInfra')!;
    let checked = 0;
    for (let j = 0; j < def.tube.nodes.length - 1; j++) {
      const p = def.tube.nodes[j].p,
        q = def.tube.nodes[j + 1].p;
      const r = ((def.tube.nodes[j].r + def.tube.nodes[j + 1].r) / 2) * anatomy.caliberFor(before).radiusScale(def.id);
      const gate = smallGate([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + 0.65 * r, (p[2] + q[2]) / 2], 0.4);
      const volume = new SampleVolumeIQ(anatomy, 47);
      volume.setGate(gate, before);
      if (volume.lastComposition.bloodFraction < 0.5) continue;
      checked++;
      const re = new Float32Array(8),
        im = new Float32Array(8);
      for (let k = 0; k < 96; k++) volume.generate(after, [0, 0, 0], 8, re, im);
      const internals = volume as unknown as Internals;
      let blood = 0;
      let outside = 0;
      for (const s of internals.scatterers) {
        if (!s.isBlood) continue;
        const w = internals.weightAt(s.g) * s.imp;
        blood += w;
        const c = anatomy.classifyMaterial(s.m, after);
        if (c.tissue !== Tissue.Blood || c.vessel !== s.vessel) outside += w;
      }
      expect(outside / Math.max(blood, 1e-12), `segmento ${j}`).toBeLessThan(0.02);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('en la confluencia portal la sangre solo vale donde su tubo gana la clasificación', () => {
    // Revisión r1: con una distancia propia aproximada, la puerta portal del caso grave aceptaba en su dominio un 6,3 % del
    // peso sanguíneo que la clasificación da a otra rama. La prueba lenta del dominio corre cada 8 pulsos; aquí se exige
    // que el predicado coincida con la clasificación en las posiciones que acepta.
    const session = openSession(SEVERE_CONGESTION, 'apnea-expiratory');
    const { anatomy, engine } = session;
    const contact = probeAt(session, 'portalTrunk');
    const best = placeGate(session, contact, ['pvTrunk'])!;
    const gate = pwGate(
      anatomy,
      contact.frame,
      contact,
      PROFILE,
      DEFAULT_BMODE.focusMm,
      { theta: best.theta, depthMm: best.r, gateMm: 4 },
      engine.sample,
    ).gate;
    const volume = new SampleVolumeIQ(anatomy, 47);
    volume.setEquipment({ prfHz: 2600 });
    volume.setGate(gate, engine.sample);
    const internals = volume as unknown as Internals;
    const re = new Float32Array(16),
      im = new Float32Array(16);
    let worst = 0;
    for (let k = 0; k < 500; k++) {
      const sample = engine.step();
      volume.generate(sample, [0, 0, 0], k % 5 < 2 ? 11 : 10, re, im);
      if (k % 10 !== 9) continue;
      const caliber = anatomy.caliberFor(sample);
      let total = 0;
      let wrongAccepted = 0;
      for (const s of internals.scatterers) {
        if (!s.isBlood || !s.stream) continue;
        const w = internals.weightAt(s.g) * s.imp;
        total += w;
        const found = anatomy.scene.vesselTubeAt(s.m, caliber);
        if (found?.def === s.stream.def && found.hit.d < 0) continue;
        if (internals.ownsPoint(s.stream, s.m)) wrongAccepted += w;
      }
      worst = Math.max(worst, wrongAccepted / Math.max(total, 1e-12));
    }
    expect(worst).toBeLessThan(0.005);
  });
});
