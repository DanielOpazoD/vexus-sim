import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { FIRST_WALL_INTERFACE, LAST_WALL_INTERFACE } from '../anatomy/interfaces';
import type { Torso } from '../anatomy/primitives';
import { wallArc, wallPerimeter } from '../anatomy/organs/wall';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { valueNoise } from '../ultrasound/speckleField';
import { WALL_TEXTURE_GLSL, wallFaceGain, WALL_TEXTURE as T } from '../ultrasound/wallTexture';

function expectOriginalInterior(t: Torso) {
  for (let f = FIRST_WALL_INTERFACE; f <= LAST_WALL_INTERFACE; f++)
    for (let angle = -2.7; angle < 2.7; angle += 0.17) {
      const p: [number, number, number] = [t.a * Math.sin(angle), t.b * Math.cos(angle) + (t.y0 ?? 0), angle * 19];
      const index = f - FIRST_WALL_INTERFACE;
      const expected = Math.exp(
        T.faceVariation[index] *
          Math.min(
            valueNoise([wallArc(p, t) / T.faceVariationMm, p[2] / T.faceVariationMm, (index + 1) * 3.7], 37.3) - 0.5,
            T.faceVariationMax,
          ),
      );
      expect(wallFaceGain(p, f, t)).toBeCloseTo(expected, 10);
      expect(wallFaceGain(p, f, t)).toBe(wallFaceGain([...p], f, t));
    }
}

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
      // Los perímetros reales no son un número entero de células: cerrarlos no debe
      // desplazar el ruido en el resto del abdomen ni alterar el contraste de sus caras.
      expectOriginalInterior(t);
    });

  it.each([200, 200.49, 200.51, 201.49])('con %s células nominales conserva el interior y cierra la costura', (cells) => {
    const base = new AnatomyScene(NORMAL_ADULT).torso;
    const radius = (cells * T.faceVariationMm) / (2 * Math.PI);
    const t: Torso = { ...base, a: radius, b: radius };
    expect(wallPerimeter(t) / T.faceVariationMm).toBeCloseTo(cells, 12);
    expectOriginalInterior(t);
    // Periodos pares e impares, redondeando hacia ambos lados: valor y pendiente
    // deben coincidir también cuando la costura pasa por el centro de una célula.
    for (let f = FIRST_WALL_INTERFACE; f <= LAST_WALL_INTERFACE; f++)
      for (const z of [-100, -17, 21]) {
        const logGain = (x: number) => Math.log(wallFaceGain([x, -t.b + (t.y0 ?? 0), z], f, t));
        expect(Math.abs(logGain(-0.00001) - logGain(0.00001))).toBeLessThan(0.0001);
        const h = 0.001;
        expect(Math.abs((logGain(-h) - logGain(-2 * h) - logGain(2 * h) + logGain(h)) / h)).toBeLessThan(0.01);
      }
  });
});

it('la GPU aplica el mismo tope a la variación de las caras: sin él, el pico de una fascia sube 5 dB y se satura (revisión de la decisión 310)', () => {
  expect(WALL_TEXTURE_GLSL).toContain('min(wallFaceNoise(wallArc(m), m.z, float(face - IF_FIRST_WALL + 1)) - 0.5, WT_FACE_VAR_MAX)');
  expect(WALL_TEXTURE_GLSL).toContain(`#define WT_FACE_VAR_MAX ${T.faceVariationMax.toFixed(4)}`);
});
