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
  vBlood: Vec3;
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

/** Cava con la relación AP/lateral `ap` en sus dos tramos. */
function ivcAt(base: PhysiologySample, ap: number): PhysiologySample {
  const supra = base.ivcSupra ?? base.ivc;
  return { ...base, ivc: { ...base.ivc, dApMm: base.ivc.dLatMm * ap }, ivcSupra: { ...supra, dApMm: supra.dLatMm * ap } };
}

/** Centro de una puerta desplazado `offset` radios en +y desde el punto medio del segmento `j` del tubo. */
function besideSegment(def: { tube: { nodes: Array<{ p: Vec3; r: number }> } }, j: number, offset: number, scale = 1): Vec3 {
  const p = def.tube.nodes[j],
    q = def.tube.nodes[j + 1];
  const r = ((p.r + q.r) / 2) * scale;
  return [(p.p[0] + q.p[0]) / 2, (p.p[1] + q.p[1]) / 2 + offset * r, (p.p[2] + q.p[2]) / 2];
}

/**
 * Censo directo en las posiciones actuales (no el de `lastComposition`, que se actualiza cada 384 pulsos): peso sanguíneo
 * por dispersor, el de la sangre fuera de la luz de su vaso, dispersores dentro de una luz y tejido audible entre ellos.
 */
function census(volume: SampleVolumeIQ, anatomy: AnatomyQuery, phys: PhysiologySample) {
  const internals = volume as unknown as Internals;
  let blood = 0;
  let outside = 0;
  let inLumen = 0;
  let loudTissue = 0;
  for (const s of internals.scatterers) {
    const c = anatomy.classifyMaterial(s.m, phys);
    const lumen = c.tissue === Tissue.Blood;
    if (lumen) {
      inLumen++;
      if (!s.isBlood && s.amp > 1e-3) loudTissue++;
    }
    if (!s.isBlood) continue;
    const w = internals.weightAt(s.g) * s.imp;
    blood += w;
    if (!lumen || c.vessel !== s.vessel) outside += w;
  }
  const n = internals.scatterers.length;
  return { blood: blood / n, outside: outside / n, inLumen, loudTissue };
}

/** Peso sanguíneo directo de una siembra nueva con la misma puerta y la misma fisiología. */
function freshBlood(anatomy: AnatomyQuery, gate: GateGeometry, phys: PhysiologySample): number {
  const fresh = new SampleVolumeIQ(anatomy, 47);
  fresh.setGate(gate, phys);
  return census(fresh, anatomy, phys).blood;
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
  it('una luz que sigue cambiando se llena de sangre sin esperar a que el calibre se detenga', () => {
    // Revisión r2: la conversión usaba la base de flujo de su visita y un calibre que cambiaba durante la rampa la rechazaba
    // (7212 de 7212 intentos): la suprahepática que crece y luego oscila sobre una puerta de tejido seguía sin sangre, con
    // sus 320 dispersores de tejido sonando dentro de la luz, hasta que el calibre se detenía.
    const { scene, anatomy, base } = fixedScene(true);
    const at = (scale: number): PhysiologySample => ({ ...base, hvRadiusScale: scale });
    const gate = smallGate(besideSegment(scene.vesselById.get('hvRight')!, 2, 1.08), 0.2);
    const volume = new SampleVolumeIQ(anatomy, 47);
    volume.setGate(gate, at(0.75));
    expect(volume.lastComposition.bloodFraction).toBeLessThan(0.001);
    const re = new Float32Array(16),
      im = new Float32Array(16);
    // 1 s de crecimiento 0,75 → 1,35 y 1 s de oscilación 1,35 ± 0,05 a 1 Hz, en llamadas de 10 pulsos (2,5 kHz)
    let phys = at(0.75);
    for (let k = 0; k < 500; k++) {
      phys = at(k < 250 ? 0.75 + (0.6 * (k + 1)) / 250 : 1.35 + 0.05 * Math.sin((2 * Math.PI * (k + 1 - 250)) / 250));
      volume.generate(phys, [0, 0, 0], 10, re, im);
    }
    const now = census(volume, anatomy, phys);
    expect(now.inLumen).toBeGreaterThan(0.9 * 320);
    expect(now.blood / freshBlood(anatomy, gate, phys)).toBeGreaterThan(0.8);
    expect(now.loudTissue / now.inLumen).toBeLessThan(0.05);
  });

  it('una conversión que se revierte antes de terminar su rampa no enciende tejido dentro de la sangre', () => {
    // Revisión r2: la conversión sangre → tejido se aplicaba con la clasificación de su visita aunque la luz ya hubiera
    // vuelto. La cava se aplana (AP 0,9 → 0,35) durante 16 pulsos y recupera su sección: 0,1 s después seguían sonando
    // 80 dispersores de tejido dentro de su sangre.
    const { scene, anatomy, base } = fixedScene(false);
    const before = ivcAt(base, 0.9),
      after = ivcAt(base, 0.35);
    const def = scene.vesselById.get('ivcInfra')!;
    const gate = smallGate(besideSegment(def, 2, 0.65, anatomy.caliberFor(before).radiusScale(def.id)), 0.4);
    const volume = new SampleVolumeIQ(anatomy, 47);
    volume.setGate(gate, before);
    expect(volume.lastComposition.bloodFraction).toBeGreaterThan(0.99);
    const re = new Float32Array(512),
      im = new Float32Array(512);
    volume.generate(before, [0, 0, 0], 384, re, im);
    volume.generate(after, [0, 0, 0], 16, re, im);
    volume.generate(before, [0, 0, 0], 305, re, im);
    const now = census(volume, anatomy, before);
    expect(now.loudTissue).toBe(0);
    expect(now.blood / freshBlood(anatomy, gate, before)).toBeGreaterThan(0.9);
  });

  it('la cava que se aplana con su flujo no conserva sangre fuera de la luz', () => {
    // Revisión r2: con el flujo original, la reentrada renovaba la sangre de la sección vieja antes de que terminara su
    // conversión (1231 y 1379 cancelaciones): 6 s después del aplanamiento, de golpe o en 1 s, quedaban 10 partículas de
    // sangre, todas fuera de la luz (peso 0,0066 y 0,0019 frente a 0 de una siembra nueva).
    const { scene, anatomy, base } = fixedScene(true);
    const before = ivcAt(base, 0.9),
      after = ivcAt(base, 0.35);
    const def = scene.vesselById.get('ivcInfra')!;
    const gate = smallGate(besideSegment(def, 2, 0.65, anatomy.caliberFor(before).radiusScale(def.id)), 0.4);
    for (const gradual of [false, true]) {
      const volume = new SampleVolumeIQ(anatomy, 47);
      volume.setGate(gate, before);
      const initial = census(volume, anatomy, before).blood;
      expect(initial).toBeGreaterThan(0.05);
      const re = new Float32Array(128),
        im = new Float32Array(128);
      if (gradual) for (let k = 0; k < 20; k++) volume.generate(ivcAt(base, 0.9 - (0.55 * (k + 1)) / 20), [0, 0, 0], 128, re, im);
      for (let k = 0; k < 40; k++) volume.generate(after, [0, 0, 0], 128, re, im);
      const now = census(volume, anatomy, after);
      expect(now.outside / initial, gradual ? 'gradual' : 'de golpe').toBeLessThan(1e-3);
    }
  });

  it('la velocidad de la sangre sigue el perfil de la sección del instante al dilatarse y al contraerse la luz', () => {
    // Revisión r2: el factor radial quedaba fijado con el calibre de la siembra; tras dilatar la suprahepática 0,75 → 1,4,
    // la velocidad ponderada de las partículas era 0,59 de la del campo oficial en sus mismos puntos.
    const { scene, anatomy, base } = fixedScene(true);
    const at = (scale: number): PhysiologySample => ({ ...base, hvRadiusScale: scale });
    const gate = smallGate(besideSegment(scene.vesselById.get('hvRight')!, 2, 0.58), 0.2);
    const volume = new SampleVolumeIQ(anatomy, 47);
    volume.setGate(gate, at(0.75));
    const internals = volume as unknown as Internals;
    const re = new Float32Array(128),
      im = new Float32Array(128);
    /** Rapidez ponderada de la sangre frente a la del campo oficial en los mismos puntos materiales. */
    const speedRatio = (phys: PhysiologySample) => {
      let got = 0;
      let want = 0;
      for (const s of internals.scatterers) {
        if (!s.isBlood) continue;
        const c = anatomy.classifyMaterial(s.m, phys);
        if (c.tissue !== Tissue.Blood || c.vessel !== s.vessel || !c.bloodVelocity) continue;
        const w = internals.weightAt(s.g) * s.imp;
        got += w * Math.hypot(s.vBlood[0], s.vBlood[1], s.vBlood[2]);
        want += w * Math.hypot(c.bloodVelocity[0], c.bloodVelocity[1], c.bloodVelocity[2]);
      }
      expect(want).toBeGreaterThan(0);
      return got / want;
    };
    volume.generate(at(0.75), [0, 0, 0], 128, re, im);
    const steps: Array<[string, number, number]> = [
      ['dilatada', 0.75, 1.4],
      ['contraída', 1.4, 0.9],
    ];
    expect(speedRatio(at(0.75))).toBeCloseTo(1, 1);
    for (const [label, from, to] of steps) {
      for (let k = 0; k < 20; k++) volume.generate(at(from + ((to - from) * (k + 1)) / 20), [0, 0, 0], 128, re, im);
      for (let k = 0; k < 4; k++) volume.generate(at(to), [0, 0, 0], 128, re, im);
      const ratio = speedRatio(at(to));
      expect(ratio, label).toBeGreaterThan(0.97);
      expect(ratio, label).toBeLessThan(1.03);
    }
  });
});
