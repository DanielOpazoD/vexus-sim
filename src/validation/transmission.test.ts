import { describe, expect, it } from 'vitest';
import { Tissue, attenuationDbPerCm } from '../anatomy/tissues';
import { BONE_ENTRY_DB, GAS_DB_PER_CM, rayAttenuationDb, rayTransmission } from '../ultrasound/transmission';

/** Regla de atenuación compartida por la puerta PW y la pasada A (GLSL). */
describe('Atenuación a lo largo del rayo', () => {
  const f = 2.5;
  it('el gel previo a la piel no atenúa; el tejido blando atenúa 2·α·paso', () => {
    const db = rayAttenuationDb([Tissue.Air, Tissue.Air, Tissue.Liver, Tissue.Liver], 2.5, f);
    expect(db).toBeCloseTo(2 * 2 * attenuationDbPerCm(Tissue.Liver, f) * 0.25, 9);
  });

  it('el hueso cobra la reflexión de entrada UNA sola vez, no en cada paso (antes 6 dB por paso en CPU)', () => {
    const one = rayAttenuationDb([Tissue.Bone], 2.5, f);
    const four = rayAttenuationDb([Tissue.Bone, Tissue.Bone, Tissue.Bone, Tissue.Bone], 2.5, f);
    const alphaStep = 2 * attenuationDbPerCm(Tissue.Bone, f) * 0.25;
    expect(one).toBeCloseTo(BONE_ENTRY_DB + alphaStep, 9);
    expect(four).toBeCloseTo(BONE_ENTRY_DB + 4 * alphaStep, 9);
    // una segunda costilla tras tejido blando no vuelve a cobrar la entrada (igual que la GPU)
    const two = rayAttenuationDb([Tissue.Bone, Tissue.Muscle, Tissue.Bone], 2.5, f);
    expect(two).toBeCloseTo(BONE_ENTRY_DB + 2 * alphaStep + 2 * attenuationDbPerCm(Tissue.Muscle, f) * 0.25, 9);
  });

  it('el gas atenúa 60 dB/cm sin absorción añadida y la transmisión es 10^(−dB/20)', () => {
    expect(rayAttenuationDb([Tissue.BowelGas, Tissue.BowelGas], 5, f)).toBeCloseTo(GAS_DB_PER_CM, 9);
    expect(rayTransmission([Tissue.BowelGas, Tissue.BowelGas], 5, f)).toBeCloseTo(1e-3, 12);
    expect(rayTransmission([], 5, f)).toBe(1);
  });
});
