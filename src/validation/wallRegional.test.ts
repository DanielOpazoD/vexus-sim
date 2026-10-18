import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { Interface } from '../anatomy/interfaces';
import { WALL, wallDepths, wallFace, wallPerimeter, wallPlaneDepth, wallPlaneGap } from '../anatomy/organs/wall';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';

describe('soporte regional de los planos musculares de la pared', () => {
  for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION])
    it(`${patient.id}: conserva la pared lateral y no prolonga planos interoblicuos por la espalda`, () => {
      const t = new AnatomyScene(patient).torso;
      const half = wallPerimeter(t) / 2;
      for (const z of [-180, -100, -40, 0, 50]) {
        for (const sign of [-1, 1]) {
          const lateral = wallDepths(t, sign * half * 0.5, z);
          for (const i of [0, 1])
            expect(wallPlaneGap(wallPlaneDepth(sign * half * 0.5, z, i, t), i, lateral)).toBeGreaterThan(WALL.planeMinMm);
          for (const fraction of [0.88, 0.94, 1]) {
            const u = sign * half * fraction;
            const w = wallDepths(t, u, z);
            for (const i of [0, 1]) expect(wallPlaneGap(wallPlaneDepth(u, z, i, t), i, w)).toBeLessThan(WALL.planeMinMm);
            // Every depth in the posterior muscle, not just the former planes.
            for (let d = w.fascia; d < w.transversalis; d += 0.2) {
              const face = wallFace(d, u, z, 1000, t, w)[0];
              expect(face).not.toBe(Interface.ObliquePlane);
              expect(face).not.toBe(Interface.TransversusPlane);
            }
          }
        }
      }
    });

  it('funde cada plano sin salto de profundidad ni pendiente en ambos extremos', () => {
    const t = new AnatomyScene(NORMAL_ADULT).torso;
    const half = wallPerimeter(t) / 2;
    const h = 0.001;
    for (const sign of [-1, 1])
      for (const fraction of WALL.posteriorFusion)
        for (const z of [-140, -60, 20])
          for (const i of [0, 1]) {
            const u = sign * half * fraction;
            const f = (x: number) => wallPlaneDepth(x, z, i, t);
            expect(Math.abs(f(u + h) - f(u - h))).toBeLessThan(0.002);
            // Finite differences in mm/mm: a C1 join must not create a kink.
            expect(Math.abs((f(u + h) - f(u)) / h - (f(u) - f(u - h)) / h)).toBeLessThan(0.001);
          }
  });
});
