import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { torsoDepth, torsoNormal, torsoSkinPoint, type Torso } from '../anatomy/primitives';
import { wallArc, wallDepths, wallWavenumber } from '../anatomy/organs/wall';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import type { Vec3 } from '../core/vec3';
import { valueNoise } from '../ultrasound/speckleField';
import { muscleStriation, WALL_TEXTURE as T } from '../ultrasound/wallTexture';

const bytes = readFileSync('src/anatomy/abdominal-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

// Oráculo escalar independiente: fase anterior a 248, sin usar las nuevas derivadas.
function phase(p: Vec3, t: Torso): number {
  const u = wallArc(p, t),
    z = p[2];
  const undulation = 1.1 * Math.sin(wallWavenumber(7, t) * u + 0.8 * Math.sin(z / 11)) + 0.5 * Math.sin(z / 9 + wallWavenumber(17, t) * u);
  const jitter = T.striationJitter * T.striationSpacingMm * (valueNoise([u / T.striationJitterMm, z / T.striationJitterMm, 0], 71.3) - 0.5);
  return -torsoDepth(p, t) - wallDepths(t, u, z).fascia + undulation + jitter;
}
function gradient(p: Vec3, t: Torso): Vec3 {
  const h = 0.001;
  return [0, 1, 2].map((axis) => {
    const q = [...p] as Vec3;
    q[axis] += h;
    const plus = phase(q, t);
    q[axis] -= 2 * h;
    return (plus - phase(q, t)) / (2 * h);
  }) as Vec3;
}
function samples(t: Torso): Vec3[] {
  const points: Vec3[] = [];
  for (const z of [-150, -125, -100, -75, -25, 25])
    for (let a = 0; a < 32; a++) {
      const skin = torsoSkinPoint((2 * Math.PI * (a + 0.17)) / 32, z, t),
        n = torsoNormal(skin, t);
      const w = wallDepths(t, wallArc(skin, t), z);
      for (const fraction of [0.25, 0.5, 0.75]) {
        const depth = w.fascia + fraction * (w.transversalis - w.fascia);
        const p = skin.map((v, i) => v - depth * n[i]) as Vec3;
        if (muscleStriation(p, t)[3] > 0.05) points.push(p);
      }
    }
  return points;
}

describe('normal material de las estrías musculares, 248', () => {
  for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION])
    for (const atlas of [false, true]) {
      const t: Torso = { ...new AnatomyScene(patient).torso, ...(atlas ? { profile } : {}) };
      it(`${patient.id}, ${atlas ? 'atlas' : 'elipse'}: normal alineada con fase, incluida fascia y jitter`, () => {
        const points = samples(t);
        expect(points.length).toBeGreaterThan(70);
        for (const p of points) {
          const g = gradient(p, t),
            s = muscleStriation(p, t);
          const alignment = Math.abs(g.reduce((sum, v, i) => sum + v * s[i], 0)) / Math.hypot(...g);
          // Tolerancia numérica (0,081°), no un umbral de ecogenicidad humana.
          expect(alignment).toBeGreaterThan(0.999999);
        }
      });
    }
});
