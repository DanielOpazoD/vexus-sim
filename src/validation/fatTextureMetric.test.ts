import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { torsoNormal, torsoSkinPoint, type Torso } from '../anatomy/primitives';
import { wallArc, wallDepths } from '../anatomy/organs/wall';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import type { Vec3 } from '../core/vec3';
import { fatSeptum, WALL_TEXTURE as T } from '../ultrasound/wallTexture';

const bytes = readFileSync('src/anatomy/abdominal-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const move = (p: Vec3, n: readonly number[], d: number): Vec3 => p.map((v, i) => v + d * n[i]) as Vec3;

describe('espesor normal de septos grasos sobre el atlas, 251', () => {
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
