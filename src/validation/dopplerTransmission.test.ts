import { describe, expect, it } from 'vitest';
import { Tissue, attenuationDbPerCm } from '../anatomy/tissues';
import { dopplerTransmission } from '../ultrasound/dopplerTransmission';
import { BONE_ENTRY_DB, GAS_DB_PER_CM, rayAttenuationDb, rayFixedAttenuationDb } from '../ultrasound/transmission';

describe('Doppler frequency conversion preserves fixed acoustic barriers', () => {
  it('agrees with a direct PW integration at Doppler frequency through layered tissues', () => {
    const soft = [Tissue.Air, Tissue.Air, Tissue.VesselWallPortal, Tissue.VesselWallThin, Tissue.Liver, Tissue.Liver];
    for (const tissues of [
      soft,
      [...soft, Tissue.Bone, Tissue.Bone, Tissue.Liver],
      [...soft, Tissue.BowelGas, Tissue.BowelGas, Tissue.Liver],
    ])
      for (const bMHz of [2.5, 3.5, 5])
        for (const dMHz of [1.5, 2.5, 4]) {
          const totalB = rayAttenuationDb(tissues, 2, bMHz);
          const fixed =
            (tissues.includes(Tissue.Bone) ? BONE_ENTRY_DB : 0) + tissues.filter((t) => t === Tissue.BowelGas).length * GAS_DB_PER_CM * 0.2;
          expect(rayFixedAttenuationDb(tissues, 2)).toBeCloseTo(fixed, 12);
          const expected = Math.pow(10, -rayAttenuationDb(tissues, 2, dMHz) / 20);
          expect(dopplerTransmission(totalB, fixed, dMHz / bMHz)).toBeCloseTo(expected, 12);
        }
  });
  it('retains the entire bone-entry and gas losses without a 60 dB transmission floor', () => {
    const fixed = BONE_ENTRY_DB + GAS_DB_PER_CM * 2;
    for (const ratio of [0.4, 1, 1.6]) {
      const convertedDb = -20 * Math.log10(dopplerTransmission(fixed + 35, fixed, ratio));
      expect(convertedDb).toBeCloseTo(fixed + 35 * ratio, 10);
      expect(convertedDb).toBeGreaterThan(220);
    }
    const softDb = 2 * attenuationDbPerCm(Tissue.Liver, 3.5) * 10;
    expect(dopplerTransmission(softDb, 0, 2.5 / 3.5)).toBeCloseTo(Math.pow(Math.pow(10, -softDb / 20), 2.5 / 3.5), 12);
  });
});
