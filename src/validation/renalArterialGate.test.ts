// @tier slow
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { setReferenceBody } from '../anatomy/referenceBody';
import { startPointsFor } from '../app/startPoints';
import { bestGateOnVessel } from '../app/gatePlacement';
import { acousticWindowWeight } from '../app/gateTransmission';
import { probeContact } from '../probe/contact';
import { DEFAULT_BMODE } from '../ultrasound/renderer';
import { PwDopplerChain } from '../doppler/pwChain';
import { dominantGateSystem } from '../doppler/vesselIdentity';
import { captureColumns } from '../doppler/capture';
import { measureObservedRenal } from '../doppler/spectralMeasure';
import { prfFromNyquistCms } from '../core/units';
import { acquire, openSession, PROFILE, TR } from './support/studentChain';

const bytes = readFileSync(new URL('../anatomy/reference-body.bin', import.meta.url));
const reference = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
afterEach(() => setReferenceBody());
describe('captura renal real con puerta centrada en arteria', () => {
  for (const ref of [false, true])
    for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION]) {
      it(`${patient.id}, reference=${ref}: evita que la arteria se acepte como vena continua`, () => {
        setReferenceBody(ref ? reference : undefined);
        const s = openSession(patient, 'apnea-expiratory');
        s.chain = new PwDopplerChain(s.anatomy, patient.seed + 7919 * 3);
        for (let i = 0; i < 7000; i++) s.engine.step();
        const sp = startPointsFor(s.scene.torso).find((p) => p.id === 'renal')!;
        const contact = probeContact(
          { phi: sp.phi, z: sp.z, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: (sp.tilt ?? 0) - ((ref ? 3.5 : 2) * Math.PI) / 180, lift: 0 },
          TR,
          s.scene.torso,
        );
        s.anatomy.setProbeCompression(contact);
        const weight = acousticWindowWeight(
          s.anatomy,
          contact.frame,
          TR,
          contact,
          s.engine.sample,
          DEFAULT_BMODE.depthMm,
          PROFILE.dopplerEffectiveMHz,
        );
        const best = bestGateOnVessel(
          s.anatomy,
          contact.frame,
          TR,
          s.engine.sample,
          ['interlobarArtery1', 'interlobarArtery2', 'interlobarArtery3'],
          175,
          0.2,
          weight,
        );
        expect(best).not.toBeNull();
        const { captures, track } = acquire(s, contact, best!, 'renal', {
          prfHz: prfFromNyquistCms(50, TR.f0Doppler),
          wallFilterHz: 15,
          seconds: 8,
        });
        const m = captures.at(-1)!.m!;
        expect(m).not.toBeNull();
        const first = m.measuredBeats[0],
          last = m.measuredBeats.at(-1)!;
        expect(dominantGateSystem(track, first.tR, last.tR + last.rr)).toBe('interlobarArtery');
        // Reproduce the former isolated estimator failure on the SAME acquired IQ:
        // dominant arterial power was accepted as continuous venous flow.
        const raw = measureObservedRenal(captureColumns(s.chain.spectral.columns, s.engine.clock.t - 7), m.measuredBeats, {
          f0Hz: TR.f0Doppler,
          angleCorrectionRad: 0,
          invert: false,
          fftSize: 128,
          wallFilterHz: 15,
          gainDb: 0,
        })!;
        expect(raw.quality.issue).toBeNull();
        expect(raw.pattern).toBe('continuous');
        expect(raw.anterogradeSign).toBe(1);
        expect(m.quality.issue).toBe('renal-identity');
      });
    }
});
