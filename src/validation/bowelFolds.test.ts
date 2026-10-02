import { describe, expect, it } from 'vitest';
import {
  BOWEL_ARC,
  BOWEL_NODES,
  BOWEL_RADII,
  BOWEL_REST_RADII,
  BOWEL_FOLD_MM,
  BOWEL_WALL_MM,
  bowelQuery,
  bowelRadii,
} from '../anatomy/organs/bowel';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, type ProbePose } from '../probe/probe';
import type { Vec3 } from '../core/vec3';
import { Tissue } from '../anatomy/tissues';
const at = (z: number, radius: number): Vec3 => [-48 + radius, 22, z];
const gradient = (p: Vec3, face: 'd' | 'lumen', radii = BOWEL_REST_RADII): Vec3 =>
  [0, 1, 2].map((j) => {
    const a = [...p] as Vec3,
      b = [...p] as Vec3;
    a[j] += 1e-4;
    b[j] -= 1e-4;
    return (bowelQuery(a, radii)[face] - bowelQuery(b, radii)[face]) / 2e-4;
  }) as Vec3;
const pose: ProbePose = { phi: Math.PI / 2, z: -112, lift: 0, yaw: Math.PI / 2, rock: 0, tilt: 0 };
describe('pliegues y calibre intestinal local', () => {
  it('radio variable acotado sin crecer fuera de la envolvente de 10 mm', () => {
    expect(Math.max(...BOWEL_RADII)).toBeLessThanOrEqual(10);
    expect(Math.min(...BOWEL_RADII)).toBeGreaterThanOrEqual(7.6);
    expect(Math.max(...BOWEL_RADII) - Math.min(...BOWEL_RADII)).toBeGreaterThan(2);
    BOWEL_ARC.slice(1).forEach((s, i) =>
      expect(s - BOWEL_ARC[i]).toBeCloseTo(Math.hypot(...BOWEL_NODES[i + 1].map((x, j) => x - BOWEL_NODES[i][j])), 10),
    );
  });
  it('pliegues modifican la luz física sin ondular la serosa ni depender de semilla', () => {
    const crest = bowelQuery(at(-250, 7)),
      trough = bowelQuery(at(-246, 7));
    expect(crest.lumen - crest.d).toBeCloseTo(BOWEL_WALL_MM + BOWEL_FOLD_MM, 8);
    expect(trough.lumen - trough.d).toBeCloseTo(BOWEL_WALL_MM, 8);
    const scene = new AnatomyScene(NORMAL_ADULT);
    const p = at(-250, crest.radius - 2.6);
    expect(scene.classify(p, BASELINE_CALIBER).tissue).toBe(Tissue.Bowel);
    expect(crest.radius).toBeLessThan(10);
  });
  it('gradientes analíticos de serosa y mucosa coinciden con diferencias finitas', () => {
    for (const z of [-291.3, -270.7, -253.1, -250.2, -239.7, -218.1])
      for (const radius of [6.3, 7.4, 9.2]) {
        const p = at(z, radius),
          q = bowelQuery(p);
        for (const [face, n] of [
          ['d', q.normal],
          ['lumen', q.lumenNormal],
        ] as const) {
          const g = gradient(p, face);
          n.forEach((x, j) => expect(x).toBeCloseTo(g[j], 6));
          expect(Math.hypot(...g)).toBeLessThan(2);
        }
      }
  });
  it('luz contenida en serosa incluso con pliegues y calibre mínimo', () => {
    const radii = Float32Array.from(BOWEL_REST_RADII, (r) => r * 0.82);
    for (let z = -205; z <= -85; z += 3)
      for (let x = -65; x <= 85; x += 3)
        for (const y of [18, 22, 26, 30]) {
          const q = bowelQuery([x, y, z], radii);
          expect(q.lumen).toBeGreaterThanOrEqual(q.d + BOWEL_WALL_MM - 1e-10);
        }
  });
  it('presión real de sonda reduce localmente el calibre y al liberar restaura exactamente', () => {
    const scene = new AnatomyScene(NORMAL_ADULT),
      anatomy = new AnatomyQuery(scene);
    const gentle = probeContact(pose, CONVEX_C35, scene.torso),
      pressed = probeContact({ ...pose, lift: -6 }, CONVEX_C35, scene.torso);
    const a = bowelRadii(gentle),
      b = bowelRadii(pressed);
    expect(a.some((r, i) => b[i] < r - 0.02)).toBe(true);
    expect(b.some((r, i) => r === BOWEL_REST_RADII[i])).toBe(true);
    b.forEach((r, i) => {
      expect(r).toBeLessThanOrEqual(BOWEL_REST_RADII[i]);
      expect(r).toBeGreaterThanOrEqual(BOWEL_REST_RADII[i] * 0.82 - 1e-6);
    });
    anatomy.setProbeCompression(pressed);
    expect(scene.bowelRadii).toEqual(b);
    anatomy.setProbeCompression(null);
    expect(scene.bowelRadii).toEqual(BOWEL_REST_RADII);
  });
  it('dos escenas no comparten una carga intestinal mutable', () => {
    const a = new AnatomyScene(NORMAL_ADULT),
      b = new AnatomyScene(NORMAL_ADULT);
    new AnatomyQuery(a).setProbeCompression(probeContact({ ...pose, lift: -6 }, CONVEX_C35, a.torso));
    expect(b.bowelRadii).toEqual(BOWEL_REST_RADII);
    expect(a.bowelRadii).not.toEqual(b.bowelRadii);
  });
});
