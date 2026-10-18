import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { torsoNormal, torsoSkinPoint, type Torso } from '../anatomy/primitives';
import { wallArc, wallDepths } from '../anatomy/organs/wall';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import type { Vec3 } from '../core/vec3';
import { fatSeptum } from '../ultrasound/wallTexture';

const bytes = readFileSync('src/anatomy/abdominal-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

// La normal del septo material debe seguir el gradiente de su campo escalar existente.
// Las muestras interiores evitan el corte angular, donde wallArc no tiene derivada única.
// Se prueba la orientación; se conservan posiciones, pesos y propiedades tisulares.
function alignment(t: Torso): number[] {
  const values: number[] = [];
  for (const z of [-150, -125, -100, -75, -25, 25])
    for (let a = 0; a < 32; a++) {
      const skin = torsoSkinPoint((2 * Math.PI * (a + 0.17)) / 32, z, t);
      const n = torsoNormal(skin, t);
      const w = wallDepths(t, wallArc(skin, t), z);
      for (const fraction of [0.25, 0.5, 0.75]) {
        const depth = w.skin + fraction * (w.fascia - w.skin);
        const p = skin.map((v, i) => v - depth * n[i]) as Vec3;
        const septum = fatSeptum(p, t);
        // Fuera de picos (gradiente nulo), colas y fronteras de pertenencia.
        if (septum[3] < 0.1 || septum[3] > 0.8) continue;
        const h = 1e-4;
        const gradient = [0, 1, 2].map((axis) => {
          const q = [...p] as Vec3;
          q[axis] += h;
          const plus = fatSeptum(q, t)[3];
          q[axis] -= 2 * h;
          return (plus - fatSeptum(q, t)[3]) / (2 * h);
        });
        const norm = Math.hypot(...gradient);
        expect(norm).toBeGreaterThan(1e-5);
        values.push(Math.abs(gradient.reduce((sum, v, i) => sum + v * septum[i], 0) / norm));
      }
    }
  return values;
}

describe('normales del medio septal sobre perfiles corporales, contrato 221', () => {
  for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION])
    it(`${patient.id}: sigue el gradiente de la lámina en tres dimensiones`, () => {
      const t: Torso = { ...new AnatomyScene(patient).torso, profile };
      const dots = alignment(t);
      expect(dots.length).toBeGreaterThan(80);
      // Contrato de geometría numérica, sin nuevo umbral clínico o de apariencia.
      // 0,999 son ~2,6°; el marco elíptico/anulado en z se desvía decenas de grados.
      for (const dot of dots) expect(dot).toBeGreaterThan(0.999);
    });
});
