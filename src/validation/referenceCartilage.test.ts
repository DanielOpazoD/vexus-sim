import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { referenceCartilage } from '../anatomy/referenceCartilage';
import { CARTILAGE_ROWS, CARTILAGE_X0, CARTILAGE_X1 } from '../anatomy/referenceCartilageData';
import { setReferenceBody } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { sdRib, torsoDepth } from '../anatomy/primitives';
import { Tissue } from '../anatomy/tissues';
import { Interface } from '../anatomy/interfaces';
import { NORMAL_ADULT } from '../cases';
import { ribSearchDepth } from '../anatomy/organs/wall';
import { CARTILAGE_BASE, SCENE_TEX_H, SCENE_TEX_W } from '../anatomy/gpu/anatomy.glsl';

describe('séptimo cartílago fuente, sin prolongación inventada de los arcos óseos', () => {
  it('conserva el registro y las secciones originales inspeccionables, dentro de la textura existente', () => {
    const source = JSON.parse(readFileSync('docs/anatomy/reference-cartilage-source.json', 'utf8')) as {
      rows: number[][];
      x0: number;
      x1: number;
      surfaceResidualMm: { p95: number };
      source: { element: string }[];
    };
    expect(source.rows).toEqual(CARTILAGE_ROWS);
    expect(CARTILAGE_X0).toBeCloseTo(source.x0, 7);
    expect(CARTILAGE_X1).toBeCloseTo(source.x1, 7);
    expect(source.source.map((s) => s.element)).toEqual(['FJ3345', 'FJ3255']);
    expect(source.surfaceResidualMm.p95).toBeLessThan(3);
    expect(SCENE_TEX_H).toBe(6);
    expect(CARTILAGE_BASE + CARTILAGE_ROWS.length).toBeLessThanOrEqual(SCENE_TEX_W * SCENE_TEX_H);
  });
  it('clasifica también los extremos superficiales, con pericondrio y reflexión bilateral', () => {
    const b = readFileSync('src/anatomy/reference-body.bin');
    setReferenceBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
    try {
      const scene = new AnatomyScene(NORMAL_ADULT);
      expect(scene.ribs.filter((r) => r.sourceCartilage)).toHaveLength(1);
      expect(ribSearchDepth(scene.torso, 0.85)).toBe(0);
      for (let i = 1; i < CARTILAGE_ROWS.length - 1; i++) {
        const [y, z, ry] = CARTILAGE_ROWS[i];
        const x = CARTILAGE_X0 + ((CARTILAGE_X1 - CARTILAGE_X0) * i) / (CARTILAGE_ROWS.length - 1);
        for (const side of [-1, 1]) {
          const p: [number, number, number] = [side * x, y - ry + 0.2, z];
          const field = referenceCartilage(p);
          expect(field.d).toBeCloseTo(-0.2, 5);
          expect(sdRib(p, scene.ribs[2], scene.torso, scene.spine).cartilage).toBe(true);
          expect(torsoDepth(p, scene.torso)).toBeLessThan(-2);
          const cls = scene.classify(p, BASELINE_CALIBER);
          expect(cls.tissue, `section ${i}`).toBe(Tissue.Cartilage);
          expect(cls.interface).toBe(Interface.Perichondrium);
          const face = scene.faceGradient(p, BASELINE_CALIBER);
          expect(face).not.toBeNull();
          expect(Math.hypot(...field.tangent)).toBeCloseTo(1, 10);
        }
      }
      const row = CARTILAGE_ROWS[0];
      expect(referenceCartilage([CARTILAGE_X0 - 2, row[0], row[1]]).d).toBeGreaterThan(0);
    } finally {
      setReferenceBody();
    }
  });
});
