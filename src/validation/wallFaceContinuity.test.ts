import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { FIRST_WALL_INTERFACE, LAST_WALL_INTERFACE } from '../anatomy/interfaces';
import type { Torso } from '../anatomy/primitives';
import { wallArc, wallPerimeter } from '../anatomy/organs/wall';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { valueNoise } from '../ultrasound/speckleField';
import { wallFaceGain, WALL_TEXTURE as T } from '../ultrasound/wallTexture';

// El salto angular es topológico: debe desaparecer para cada fascia, altura y hábito.
describe('reflectividad parietal continua alrededor del paciente, 252', () => {
  for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION])
    it(patient.id, () => {
      const t = new AnatomyScene(patient).torso;
      for (let face = FIRST_WALL_INTERFACE; face <= LAST_WALL_INTERFACE; face++)
        for (let z = -160; z <= 50; z += 7) {
          const logGain = (x: number) => Math.log(wallFaceGain([x, -t.b + (t.y0 ?? 0), z], face, t));
          expect(Math.abs(logGain(-0.00001) - logGain(0.00001))).toBeLessThan(0.0001);
          // C1 del smoothstep: no basta pegar el valor conservando un quiebre en su pendiente.
          const h = 0.001,
            left = (logGain(-h) - logGain(-2 * h)) / h,
            right = (logGain(2 * h) - logGain(h)) / h;
          expect(Math.abs(left - right)).toBeLessThan(0.01);
        }
    });

  it('con perímetro entero conserva exactamente el ruido interior y sus niveles originales', () => {
    const base = new AnatomyScene(NORMAL_ADULT).torso;
    const radius = (200 * T.faceVariationMm) / (2 * Math.PI);
    const t: Torso = { ...base, a: radius, b: radius };
    expect(wallPerimeter(t) / T.faceVariationMm).toBeCloseTo(200, 12);
    for (let f = FIRST_WALL_INTERFACE; f <= LAST_WALL_INTERFACE; f++)
      for (let angle = -2.7; angle < 2.7; angle += 0.17) {
        const p: [number, number, number] = [radius * Math.sin(angle), radius * Math.cos(angle), angle * 19];
        const index = f - FIRST_WALL_INTERFACE;
        const expected = Math.exp(
          T.faceVariation[index] *
            (valueNoise([wallArc(p, t) / T.faceVariationMm, p[2] / T.faceVariationMm, (index + 1) * 3.7], 37.3) - 0.5),
        );
        expect(wallFaceGain(p, f, t)).toBeCloseTo(expected, 10);
        expect(wallFaceGain(p, f, t)).toBe(wallFaceGain([...p], f, t));
      }
  });
});
