import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { torsoNormal, torsoSkinPoint, type Torso } from '../anatomy/primitives';
import { wallArc, wallDepths } from '../anatomy/organs/wall';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import type { Vec3 } from '../core/vec3';
import { fatSeptum, WALL_TEXTURE as T } from '../ultrasound/wallTexture';
import { hash13 } from '../ultrasound/speckleField';

const bytes = readFileSync('src/anatomy/abdominal-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const move = (p: Vec3, n: readonly number[], d: number): Vec3 => p.map((v, i) => v + d * n[i]) as Vec3;

describe('espesor normal de septos grasos sobre el atlas, 251', () => {
  it('elige la mediatriz más cercana en mm materiales sin saltar al empatar en u,z', () => {
    const t = new AnatomyScene(NORMAL_ADULT).torso;
    // Misma columna (-43,-7), dos mediatrices empatadas en la métrica u,z.
    // Sus gradientes materiales tienen normas distintas (1,179 y 1,001).
    // Normalizar solo la ganadora antigua hacía saltar el peso 0,2865→0,1765
    // entre estos puntos separados 2,34e-8 mm, sin cruzar ninguna lámina.
    const points: Vec3[] = [
      [-104.57045038627037, -63.80958714502685, -40],
      [-104.57045040473149, -63.80958713070056, -40],
    ];
    const seed = (u: number, z: number) => [u + hash13([u, z, 41.7]), z + hash13([u, z, 63.1])];
    const owner = seed(-43, -7),
      neighbours = [seed(-44, -6), seed(-43, -6)];
    const results = points.map((p) => {
      const distances = neighbours.map((next) => {
        // Campo escalar de la mediatriz original; gradiente por diferencias
        // centrales, independiente del denominador analítico de producción.
        const du = next[0] - owner[0],
          dz = next[1] - owner[1];
        const phase = (q: Vec3) =>
          (T.lobuleMm *
            (((next[0] + owner[0]) / 2 - wallArc(q, t) / T.lobuleMm) * du + ((next[1] + owner[1]) / 2 - q[2] / T.lobuleMm) * dz)) /
          Math.hypot(du, dz);
        const h = 1e-4;
        const gradient = [0, 1, 2].map((axis) => {
          const q = [...p] as Vec3;
          q[axis] += h;
          const plus = phase(q);
          q[axis] -= 2 * h;
          return (plus - phase(q)) / (2 * h);
        });
        return Math.abs(phase(p)) / Math.hypot(...gradient);
      });
      const expected = Math.exp(-0.5 * (Math.min(...distances) / T.septumSigmaMm) ** 2);
      const actual = fatSeptum(p, t)[3];
      expect(Math.abs(actual - expected)).toBeLessThan(1e-6);
      return actual;
    });
    expect(Math.abs(results[0] - results[1])).toBeLessThan(1e-6);
  });

  for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION])
    it(patient.id, () => {
      const t: Torso = { ...new AnatomyScene(patient).torso, profile };
      let checked = 0;
      for (const z of [-150, -125, -100, -75, -25, 25])
        for (let angle = 0; angle < 32; angle++) {
          const skin = torsoSkinPoint((2 * Math.PI * (angle + 0.17)) / 32, z, t),
            normal = torsoNormal(skin, t);
          const w = wallDepths(t, wallArc(skin, t), z);
          for (const fraction of [0.25, 0.5, 0.75]) {
            let p = move(skin, normal, -(w.skin + fraction * (w.fascia - w.skin)));
            let septum = fatSeptum(p, t);
            if (septum[3] < 0.1 || septum[3] > 0.8) continue;
            // Localizar la superficie por su máximo, sin usar el gradiente nuevo ni un ancho esperado.
            // Se converge con diferencias centrales de log(peso) y un paso acotado.
            for (let step = 0; step < 8 && septum[3] < 0.999999; step++) {
              const h = 0.002;
              const plus = fatSeptum(move(p, septum, h), t)[3],
                minus = fatSeptum(move(p, septum, -h), t)[3];
              const d = (Math.log(plus) - Math.log(minus)) / (2 * h);
              const dd = (Math.log(plus) - 2 * Math.log(septum[3]) + Math.log(minus)) / (h * h);
              if (!Number.isFinite(dd) || dd >= 0) break;
              p = move(p, septum, Math.max(-0.4, Math.min(0.4, -d / dd)));
              septum = fatSeptum(p, t);
            }
            if (septum[3] < 0.999999) continue;
            const sides = [-1, 1].map((sign) => fatSeptum(move(p, septum, sign * T.septumSigmaMm), t));
            // Intersecciones de láminas no tienen un espesor único: detectar el cambio de dueño geométrico.
            if (sides.some((s) => Math.abs(s[0] * septum[0] + s[1] * septum[1] + s[2] * septum[2]) < 0.999)) continue;
            for (const side of sides) {
              // A sigma mm normales, exp(-1/2); 0,01 cubre curvatura local de la aproximación F/|∇F|.
              // El candidato anterior llega a errores>0,1 por usar la métrica plana.
              expect(Math.abs(side[3] - Math.exp(-0.5))).toBeLessThan(0.01);
            }
            checked++;
          }
        }
      expect(checked).toBeGreaterThan(60);
    });
});
