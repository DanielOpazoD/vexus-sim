import { describe, expect, it } from 'vitest';
import { Tissue, attenuationDbPerCm } from '../anatomy/tissues';
import { IFACE_REACH_MM } from '../ultrasound/interfaceEcho';
import { COARSE_DEPTH } from '../ultrasound/renderer';
import { FRAG_RAWFIELD, FRAG_TRANS_HITS, FRAG_TRANS_PREFIX } from '../ultrasound/shaders/passes.glsl';
import {
  BONE_ENTRY_DB,
  GAS_DB_PER_CM,
  MIRROR_BISECTION_STEPS,
  mirrorCrossing,
  rayAttenuationDb,
  rayTransmission,
} from '../ultrasound/transmission';

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

/** Espejo diafragmático de la pasada A en el cruce exacto (decisión 57). */
describe('Espejo en el cruce exacto con el pulmón', () => {
  it('la bisección de A0 deja el espejo a ≤ paso/2⁷ de la pleura, esté donde esté dentro del segmento', () => {
    for (const depth of [120, 180, 240]) {
      const step = depth / COARSE_DEPTH;
      for (let j = 0; j < 200; j++) {
        const pleura = 60 + (j / 200) * 7 * step;
        // A0: el primer centro de segmento que ya es pulmón
        const isLung = (r: number) => r >= pleura;
        const s = Math.ceil(pleura / step - 0.5);
        const rLung = (s + 0.5) * step;
        expect(isLung(rLung) && !isLung(rLung - step)).toBe(true);
        const r = mirrorCrossing(isLung, rLung, step);
        expect(Math.abs(r - pleura), `${depth} mm, pleura a ${pleura.toFixed(3)}`).toBeLessThanOrEqual(
          step / 2 ** (MIRROR_BISECTION_STEPS + 1) + 1e-12,
        );
        // antes: el centro del primer segmento, hasta un paso dentro del pulmón
        expect(rLung - pleura).toBeLessThanOrEqual(step);
      }
    }
    // 6 pasos: ≤ 0,009 mm a 18 cm, bajo la puerta de 0,05 mm del banco
    expect(180 / COARSE_DEPTH / 2 ** (MIRROR_BISECTION_STEPS + 1)).toBeLessThan(0.01);
  });

  it('A0 hace la bisección con el número de pasos de TS y A2 publica el espejo exacto desde su alcance', () => {
    expect(FRAG_TRANS_HITS).toContain(`for (int it = 0; it < ${MIRROR_BISECTION_STEPS}; it++)`);
    expect(FRAG_TRANS_HITS).toContain('mirrorSeg = float(s); hitR = 0.5 * (lo + hi);');
    // la pasada B necesita el espejo desde r_m − alcance del eco pleural, y lo refleja solo tras r_m
    expect(FRAG_TRANS_PREFIX).toContain(`h1.w < (kf + 1.0) * step + ${IFACE_REACH_MM.toFixed(4)} ? h1.w : -1.0`);
    expect(FRAG_TRANS_PREFIX).toContain('(h0.y == h0.x ? h1.w : (h0.y + 0.5) * step)');
    expect(FRAG_RAWFIELD).toContain('if (mirrorHit >= 0.0 && r > mirrorHit)');
    expect(FRAG_RAWFIELD).toContain('pleuraEcho(r - mirrorHit, dir0, normalize(t1.xyz))');
  });
});
