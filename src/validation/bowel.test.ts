import { rayAttenuationDb } from '../ultrasound/transmission';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Interface } from '../anatomy/interfaces';
import {
  BOWEL_RADIUS_MM,
  BOWEL_REST_RADII,
  BOWEL_WALL_MM,
  BOWEL_NODES,
  BOWEL_GAS,
  BOWEL_BOUNDS,
  BOWEL_GROUP_SIZE,
  bowelQuery,
  bowelGasSdf,
} from '../anatomy/organs/bowel';
import { setReferenceBody } from '../anatomy/referenceBody';
import { Tissue } from '../anatomy/tissues';
import { CASES, NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
const unit = (v: Vec3): Vec3 => v.map((x) => x / Math.hypot(...v)) as Vec3;
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

describe('asas intestinales con luz propia', () => {
  it('distingue mesenterio, pared y luz con radio variable y pliegue mucoso', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const t = 80 / 125,
      r = BOWEL_REST_RADII[0] + (BOWEL_REST_RADII[1] - BOWEL_REST_RADII[0]) * t * t * (3 - 2 * t);
    const at = (depth: number) => scene.classify([-48 + r - depth, 22, -250], BASELINE_CALIBER);
    expect(2 * BOWEL_RADIUS_MM).toBeLessThan(25);
    expect(BOWEL_WALL_MM).toBe(2);
    expect(at(-1).tissue).toBe(Tissue.MesentericFat);
    expect(at(0.5).tissue).toBe(Tissue.Bowel);
    expect(at(0.5).interface).toBe(Interface.BowelSerosa);
    expect(at(1.8).tissue).toBe(Tissue.Bowel);
    expect(at(1.8).interface).toBe(Interface.BowelLumen);
    expect(at(3.5).tissue).toBe(Tissue.Fluid);
    expect(at(3.5).interface).toBe(Interface.BowelLumen);
  });
  it('el descarte por grupos contiene todos sus segmentos y sus paredes', () => {
    BOWEL_BOUNDS.forEach((b, g) => {
      for (const p of BOWEL_NODES.slice(g * BOWEL_GROUP_SIZE, (g + 1) * BOWEL_GROUP_SIZE + 1))
        expect(Math.hypot(p[0] - b[0], p[1] - b[1], p[2] - b[2]) + BOWEL_RADIUS_MM).toBeLessThanOrEqual(b[3] + 1e-10);
    });
  });
  it.each([false, true])('respeta órganos, vasos y pared corporal en los siete casos (referencia=%s)', (reference) => {
    if (reference) {
      const b = readFileSync('src/anatomy/reference-body.bin');
      setReferenceBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
    }
    try {
      for (const patient of CASES) {
        const scene = new AnatomyScene(patient);
        let checked = 0;
        for (let i = 0; i < BOWEL_NODES.length - 1; i++) {
          const a = BOWEL_NODES[i],
            b = BOWEL_NODES[i + 1],
            axis = unit(b.map((x, j) => x - a[j]) as Vec3);
          const n = unit(cross(axis, Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0])),
            v = cross(axis, n);
          for (const t of [0.25, 0.5, 0.75]) {
            const p = a.map((x, j) => x + (b[j] - x) * t) as Vec3;
            if (p[2] < -235) continue; // región representada, no toda la longitud del intestino
            for (let j = 0; j < 16; j++) {
              const ang = (j * 2 * Math.PI) / 16;
              const q = p.map(
                (x, k) =>
                  x +
                  (BOWEL_REST_RADII[i] + (BOWEL_REST_RADII[i + 1] - BOWEL_REST_RADII[i]) * t * t * (3 - 2 * t) - 0.2) *
                    (Math.cos(ang) * n[k] + Math.sin(ang) * v[k]),
              ) as Vec3;
              const hit = scene.classify(q, BASELINE_CALIBER);
              expect(
                [Tissue.Bowel, Tissue.Fluid, Tissue.BowelGas],
                `${patient.id} segmento${i} t${t} ${q.join(',')} tejido${hit.tissue}`,
              ).toContain(hit.tissue);
              checked++;
            }
          }
        }
        expect(checked).toBeGreaterThan(1800);
      }
    } finally {
      setReferenceBody();
    }
  });
  it('el gas pertenece a la luz y no aparece en pared o mesenterio', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    let gas = 0,
      fluid = 0;
    for (const pocket of BOWEL_GAS)
      for (let x = -12; x <= 12; x += 1)
        for (let y = -6; y <= 6; y += 1)
          for (let z = -10; z <= 10; z += 1) {
            const p: Vec3 = [pocket.center[0] + x, pocket.center[1] + y, pocket.center[2] + z];
            const lumen = bowelQuery(p).lumen,
              d = bowelGasSdf(p, lumen),
              hit = scene.classify(p, BASELINE_CALIBER);
            if (hit.tissue === Tissue.BowelGas) {
              expect(lumen).toBeLessThan(0);
              expect(d).toBeLessThan(0);
              gas++;
            }
            if (hit.tissue === Tissue.Fluid) fluid++;
            if (lumen >= 0) expect(hit.tissue).not.toBe(Tissue.BowelGas);
          }
    expect(gas).toBeGreaterThan(100);
    expect(fluid).toBeGreaterThan(gas);
  });
  it('el gas anatómico produce pérdida real de transmisión, no solo brillo de textura', () => {
    const scene = new AnatomyScene(NORMAL_ADULT),
      step = 0.5;
    const tissues = Array.from({ length: 220 }, (_, i) => scene.classify([-37, 90 - (i + 0.5) * step, -112], BASELINE_CALIBER).tissue);
    const gas = tissues.filter((t) => t === Tissue.BowelGas).length;
    expect(gas).toBeGreaterThan(4);
    const liquid = tissues.map((t) => (t === Tissue.BowelGas ? Tissue.Fluid : t));
    expect(rayAttenuationDb(tissues, step, 2.5) - rayAttenuationDb(liquid, step, 2.5)).toBeGreaterThan(10);
  });

  it('normal de la pared e incidencia comparten el mismo campo geométrico', () => {
    const scene = new AnatomyScene(NORMAL_ADULT),
      p: Vec3 = [-38.5, 22, -250];
    const g = scene.faceGradient(p, BASELINE_CALIBER)!;
    const eps = 1e-4,
      field = (q: Vec3) => bowelQuery(q).d;
    const grad = [0, 1, 2].map((j) => {
      const a = [...p] as Vec3,
        b = [...p] as Vec3;
      a[j] += eps;
      b[j] -= eps;
      return (field(a) - field(b)) / (2 * eps);
    });
    expect(g.norm).toBeCloseTo(Math.hypot(...grad), 6);
    g.normal.forEach((x, j) => expect(x).toBeCloseTo(grad[j] / Math.hypot(...grad), 6));
    expect(g.curvature).toBeCloseTo(1 / bowelQuery(p).radius, 8);
  });
});
