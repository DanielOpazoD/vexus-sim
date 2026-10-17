// @tier slow
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setAbdominalBody, setReferenceBody } from '../anatomy/referenceBody';
import { startPointsFor } from '../app/startPoints';
import { gateTransmission } from '../app/gateTransmission';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { acquire, openSession, placeGate, probeAt, PROFILE, TR } from './support/studentChain';

const profile = (name: string): Float32Array => {
  const bytes = readFileSync(new URL('../anatomy/' + name, import.meta.url));
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};
const reference = profile('reference-body.bin');
const abdominal = profile('abdominal-body.bin');
const raw = gunzipSync(readFileSync(new URL('../anatomy/abdominal-atlas.gzip.bin', import.meta.url)));
const atlas = new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
afterEach(() => {
  setReferenceBody();
  setAbdominalBody();
  setAbdominalAtlas();
});

describe('Porta subcostal: adquisición anterior real (212)', () => {
  for (const model of ['legacy', 'reference', 'atlas'] as const)
    for (const base of [NORMAL_ADULT, SEVERE_CONGESTION])
      it(`${model}, ${base.id}: tronco, transmisión e IQ útiles sin desplazar órganos`, () => {
        setReferenceBody(model === 'reference' ? reference : undefined);
        setAbdominalBody(model === 'atlas' ? abdominal : undefined);
        setAbdominalAtlas(model === 'atlas' ? atlas : undefined);
        const session = openSession(base, 'apnea-expiratory');
        const sp = startPointsFor(session.scene.torso).find((point) => point.id === 'portalSubcostal')!;
        // Dominio anterior explorado para este preset; nunca limita el movimiento libre de la sonda.
        expect(sp.phi).toBeGreaterThanOrEqual(1.4);
        expect(sp.phi).toBeLessThanOrEqual(2.2);
        expect(sp.z).toBeGreaterThanOrEqual(-100);
        expect(sp.z).toBeLessThanOrEqual(-45);
        const contact = probeAt(session, sp.id);
        const gate = placeGate(session, contact, ['pvTrunk'], { maxDepthMm: 145 });
        expect(gate).not.toBeNull();
        // Mismos contratos de ángulo/transmisión que referenceAcquisition; no se cambia el equipo para aprobarlos.
        expect(gate!.cosAngle).toBeGreaterThanOrEqual(0.5);
        expect(
          gateTransmission(
            session.anatomy,
            contact.frame,
            TR,
            contact,
            gate!.theta,
            gate!.r,
            session.engine.sample,
            PROFILE.dopplerEffectiveMHz,
          ),
        ).toBeGreaterThan(0.01);
        const { captures, track } = acquire(session, contact, gate!, 'portal', {
          prfHz: 6000,
          focusMm: 100,
          seconds: 8.5,
          gateMm: Math.min(4, 2 * gate!.bd),
          wallFilterHz: 15,
        });
        let trunk = 0,
          total = 0;
        for (const sample of track)
          for (const [id, weight] of Object.entries(sample.vessels)) {
            total += weight;
            if (id === 'pvTrunk') trunk += weight;
          }
        // Contrato existente de tronco dominante (portalTrunkWindow), aplicado también al acceso nuevo.
        expect(trunk / total).toBeGreaterThan(0.9);
        const result = captures.at(-1)!.m;
        expect(result).not.toBeNull();
        expect(result!.quality.issue).toBeNull();
        if (base.id === NORMAL_ADULT.id) expect(result!.pulsatilityFraction).toBeLessThan(30);
        else expect(result!.pulsatilityFraction).toBeGreaterThan(50);
        expect(result!.vMin).toBeGreaterThan(0);
      });
});
