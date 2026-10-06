// @tier slow
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setReferenceBody } from '../anatomy/referenceBody';
import { NORMAL_ADULT } from '../cases';
import { acquire, openSession, placeGate, probeAt, PROFILE } from './support/studentChain';
import type { VesselId } from '../physiology/vessels';
import { gateTransmission } from '../app/gateTransmission';
const b = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
beforeEach(() => setReferenceBody(profile));
afterEach(() => setReferenceBody());
describe('adulto de referencia: adquisición real desde presets recalibrados', () => {
  for (const [kind, window, vessels] of [
    ['hepatic', 'intercostal', ['hvRight']],
    ['portal', 'portalTrunk', ['pvTrunk']],
    ['renal', 'renal', ['interlobarVein1', 'interlobarVein2', 'interlobarVein3']],
  ] as const) {
    it(`${kind}: puerta, transmisión, IQ y captura interpretables sin mover órganos`, () => {
      const session = openSession(NORMAL_ADULT, 'apnea-expiratory');
      const contact = probeAt(session, window);
      const gate = placeGate(session, contact, [...vessels] as VesselId[], { acoustic: true, maxDepthMm: 175 });
      expect(gate).not.toBeNull();
      expect(gate!.cosAngle).toBeGreaterThan(0.5);
      const transmission = gateTransmission(
        session.anatomy,
        contact.frame,
        PROFILE.geometry,
        contact,
        gate!.theta,
        gate!.r,
        session.engine.sample,
        PROFILE.dopplerEffectiveMHz,
      );
      expect(transmission).toBeGreaterThan(0.01);
      const { captures } = acquire(session, contact, gate!, kind, {
        prfHz: Math.min(6000, Math.floor((0.9 * 1540000) / (2 * gate!.r))),
        seconds: 8.5,
        gateMm: Math.min(4, 2 * gate!.bd),
      });
      const result = captures.at(-1)!.m;
      expect(result).not.toBeNull();
      expect(result!.quality.issue).toBeNull();
      if (kind === 'hepatic') expect('pattern' in result! && result.pattern).toBe('normal');
      if (kind === 'portal') expect('pulsatilityFraction' in result! && result.pulsatilityFraction).toBeLessThan(30);
      if (kind === 'renal') expect('pattern' in result! && result.pattern).toBe('continuous');
    });
  }
});
