// @tier slow
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { CASES, NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { setReferenceBody } from '../anatomy/referenceBody';
import { AnatomyScene } from '../anatomy/scene';
import { AnatomyQuery } from '../anatomy/query';
import { PhysiologyEngine } from '../physiology/engine';
import { AcousticWindowUnavailableError, VenousSpectralAcquisition } from '../app/venousSpectral';
import { DEFAULT_BMODE } from '../ultrasound/renderer';
import { captureProtocolVessel } from '../doppler/capture';
import { bestGateOnVessel } from '../app/gatePlacement';
import { pointOnLine } from '../probe/probe';
import { openSession, placeGate, probeAt, TR } from './support/studentChain';
const bytes = readFileSync(new URL('../anatomy/reference-body.bin', import.meta.url));
const body = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
afterEach(() => setReferenceBody());

describe('puerta virtual portal dentro del tronco', () => {
  it('distingue una ventana ausente de una avería numérica y puede recuperarla en apnea', () => {
    setReferenceBody(body);
    const quiet = { ...NORMAL_ADULT, respiratoryPattern: 'quiet' as typeof NORMAL_ADULT.respiratoryPattern };
    const query = new AnatomyQuery(new AnatomyScene(quiet));
    const engine = new PhysiologyEngine(quiet, query.scene.vesselAreas());
    for (let i = 0; i < 500; i++) engine.step();
    expect(() => new VenousSpectralAcquisition(query, engine.sample, quiet.seed, quiet, DEFAULT_BMODE)).toThrow(
      AcousticWindowUnavailableError,
    );
    try {
      new VenousSpectralAcquisition(query, engine.sample, quiet.seed, quiet, DEFAULT_BMODE);
    } catch (error) {
      expect((error as AcousticWindowUnavailableError).window).toBe('intercostal');
    }
    quiet.respiratoryPattern = 'apnea-expiratory';
    for (let i = 0; i < 750; i++) engine.step();
    expect(() => new VenousSpectralAcquisition(query, engine.sample, quiet.seed, quiet, DEFAULT_BMODE)).not.toThrow();
  });

  it('la técnica mide en el tronco, lejos de la bifurcación, en todos los casos y en cualquier fase', () => {
    // Decisión 294: la puerta quedaba a la entrada de la bifurcación, donde el mejor ángulo. Al respirar cabalgaba tronco y ramas, la
    // envolvente saltaba entre sus velocidades (la rama derecha se proyecta ×1,5 mejor sobre el haz) y la PF salía falsa: 52 frente
    // a 19 en el sano.
    for (const base of CASES)
      for (const respiration of ['quiet', 'apnea-expiratory'] as const) {
        const session = openSession(base, respiration);
        const contact = probeAt(session, 'portalTrunk');
        const best = placeGate(session, contact, ['pvTrunk'])!;
        const nodes = session.scene.vesselById.get('pvTrunk')!.tube.nodes;
        const fork = nodes[nodes.length - 1].p;
        const m = session.anatomy.deformation.toMaterial(pointOnLine(contact.frame, TR, best.theta, best.r), session.engine.sample.resp);
        expect(Math.hypot(m[0] - fork[0], m[1] - fork[1], m[2] - fork[2]), `${base.id} ${respiration}`).toBeGreaterThanOrEqual(20);
      }
  });

  it('una restricción imposible devuelve null, no el candidato de puntuación cero', () => {
    const s = openSession(NORMAL_ADULT, 'apnea-expiratory');
    const contact = probeAt(s, 'portalTrunk');
    const args = [s.anatomy, contact.frame, TR, s.engine.sample, ['pvTrunk'], 175] as const;
    expect(bestGateOnVessel(...args)).not.toBeNull();
    expect(bestGateOnVessel(...args, 1.2, undefined, () => false)).toBeNull();
  });
  it('todos los casos mantienen una ventana disponible en ambos cuerpos', () => {
    for (const ref of [false, true]) {
      setReferenceBody(ref ? body : undefined);
      for (const base of CASES) {
        const p = { ...base, respiratoryPattern: 'apnea-expiratory' as const };
        const query = new AnatomyQuery(new AnatomyScene(p));
        const engine = new PhysiologyEngine(p, query.scene.vesselAreas());
        for (let i = 0; i < 7500; i++) engine.step();
        const a = new VenousSpectralAcquisition(query, engine.sample, p.seed, p, DEFAULT_BMODE);
        expect(a.gateInfo[1].vessel, p.id).toBe('pvTrunk');
        expect(a.gate(1, engine.sample).lengthMm).toBe(6);
      }
    }
  });
  for (const ref of [false, true])
    for (const base of [NORMAL_ADULT, SEVERE_CONGESTION])
      it(`${base.id}, reference=${ref}: la IQ conserva el patrón sin mezclar ramas dominantes`, () => {
        setReferenceBody(ref ? body : undefined);
        const patient = { ...base, respiratoryPattern: 'apnea-expiratory' as const };
        const query = new AnatomyQuery(new AnatomyScene(patient));
        const engine = new PhysiologyEngine(patient, query.scene.vesselAreas());
        for (let i = 0; i < 7500; i++) engine.step();
        const a = new VenousSpectralAcquisition(query, engine.sample, patient.seed, patient, DEFAULT_BMODE);
        const samples = Array.from({ length: 1625 }, () => engine.step());
        const unchanged = JSON.stringify(samples);
        a.push(samples, engine.clock.dt);
        expect(JSON.stringify(samples)).toBe(unchanged);
        let trunk = 0,
          total = 0;
        for (const s of a.gateTracks[1])
          for (const [id, w] of Object.entries(s.vessels)) {
            total += w;
            if (id === 'pvTrunk') trunk += w;
          }
        expect(trunk / total).toBeGreaterThan(0.9);
        const m = captureProtocolVessel(
          'portal',
          a.chains[1].readCapture(),
          engine.rhythm,
          engine.clock.t,
          { angleCorrectionRad: 0, invert: false },
          a.gateTracks[1],
        );
        expect(m).not.toBeNull();
        expect(m!.quality.issue).toBeNull();
        if (base.id === NORMAL_ADULT.id) expect(m!.pulsatilityFraction).toBeLessThan(30);
        else expect(m!.pulsatilityFraction).toBeGreaterThan(50);
        expect(m!.vMin).toBeGreaterThan(0);
      });
});
