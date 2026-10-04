import { describe, expect, it } from 'vitest';
import { NORMAL_ADULT } from '../cases';
import { SampleVolumeIQ } from '../doppler/sampleVolume';
import { pwGate } from '../app/pwGate';
import { openSession, placeGate, probeAt, PROFILE } from './support/studentChain';

describe('caché espacial: IQ idéntica bit a bit a la ruta por pulso', () => {
  for (const respiratory of ['apnea-expiratory', 'quiet'] as const)
    for (const renal of [false, true])
      it(`${respiratory}, ${renal ? 'vaso pequeño' : 'porta'}: señal y composición intactas`, () => {
        const s = openSession(NORMAL_ADULT, respiratory);
        const contact = probeAt(s, renal ? 'renal' : 'portal');
        const best = placeGate(s, contact, renal ? ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'] : ['pvTrunk'])!;
        expect(best).not.toBeNull();
        const cached = new SampleVolumeIQ(s.anatomy, 47, true),
          reference = new SampleVolumeIQ(s.anatomy, 47, false);
        const a = new Float32Array(64),
          b = new Float32Array(64),
          c = new Float32Array(64),
          d = new Float32Array(64);
        for (let i = 0; i < 96; i++) {
          const sample = s.engine.step();
          // Includes changing gate length/focus/transmission, offsets, and live motion.
          const { gate } = pwGate(
            s.anatomy,
            contact.frame,
            contact,
            PROFILE,
            i < 48 ? 65 : 80,
            { theta: best.theta, depthMm: best.r + (i >= 64 ? 0.6 : 0), gateMm: i < 32 ? 4 : 5 },
            sample,
          );
          cached.setGate(gate, sample);
          reference.setGate(gate, sample);
          const equipment = { prfHz: i < 48 ? 2600 : 3900, gain: i < 72 ? 1 : 2 };
          cached.setEquipment(equipment);
          reference.setEquipment(equipment);
          const velocity: [number, number, number] = i < 80 ? [0, 0, 0] : [0.1, -0.2, 0.3];
          cached.generate(sample, velocity, 32, a, b, 4);
          reference.generate(sample, velocity, 32, c, d, 4);
          expect(a).toEqual(c);
          expect(b).toEqual(d);
          expect(cached.lastComposition).toEqual(reference.lastComposition);
        }
        expect(cached.particleCount).toBe(renal ? 1280 : 320);
      });
});
