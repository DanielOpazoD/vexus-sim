import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { quadratusSdf } from '../anatomy/organs/retroperitoneum';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import { buildPosteriorMuscles } from '../ui/navigator3d/organs';
import type { Mesh } from 'three';
import { kidneyLocal, perirenalOuterSdf } from '../anatomy/organs/kidney';
import { torsoDepth } from '../anatomy/primitives';

beforeAll(() => {
  const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
  const body = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalAtlas(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2));
  setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setAbdominalBody();
});

// Testigos materiales de la esquina caudal abrupta de ce316626. No representan
// dimensiones poblacionales ni un nuevo registro entre riñón y músculo.
const corner: Vec3 = [-70.36, -68.26, -213];
const field = (p: Vec3) => quadratusSdf(p, 100, 100);
const gradient = (p: Vec3): Vec3 => {
  const h = 0.001;
  const g = [0, 1, 2].map((axis) => {
    const a = [...p] as Vec3;
    const b = [...p] as Vec3;
    a[axis] += h;
    b[axis] -= h;
    return (field(a) - field(b)) / (2 * h);
  }) as Vec3;
  const length = Math.hypot(...g);
  return g.map((v) => v / length) as Vec3;
};

describe('Atlas quadratus terminal contour', () => {
  it('rounds the former right-angle corner in the physical field on both sides', () => {
    for (const x of [corner[0], -corner[0]]) {
      const p: Vec3 = [x, corner[1], corner[2]];
      expect(Math.abs(field(p))).toBeLessThan(0.001);
      // Cruzar el contorno físico entre músculo y grasa: suavizar solo la malla
      // sobre la antigua esquina sólida no satisface esta regresión.
      expect(field([x, p[1] - 0.5, p[2]])).toBeLessThan(0);
      expect(field([x, p[1] + 0.5, p[2]])).toBeGreaterThan(0);
      const a = gradient([x, p[1] - 0.01, p[2]]);
      const b = gradient([x, p[1] + 0.01, p[2]]);
      expect(a.every(Number.isFinite) && b.every(Number.isFinite)).toBe(true);
      // Continuidad numérica de tangente en 0,02 mm; no es un umbral clínico.
      expect(a.reduce((sum, v, i) => sum + v * b[i], 0)).toBeGreaterThan(0.999);
    }
  });

  it('replaces the protruding corner with surrounding fat and retains the muscle core', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    for (const x of [corner[0], -corner[0]]) {
      expect(scene.classify([x, -67.76, -213], BASELINE_CALIBER).tissue).toBe(Tissue.RetroperitonealFat);
      expect(scene.classify([x, -68.76, -213], BASELINE_CALIBER).tissue).toBe(Tissue.QuadratusLumborum);
      expect(scene.classify([x, -75.76, -180], BASELINE_CALIBER).tissue).toBe(Tissue.QuadratusLumborum);
      expect(field([x, -75.76, -216])).toBeGreaterThan(0);
    }
  });

  it('extracts closed 3D terminal surfaces rather than clipping them at the meshing box', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const group = buildPosteriorMuscles(scene);
    try {
      for (const object of group.children) {
        const mesh = object as Mesh;
        const index = mesh.geometry.getIndex()!;
        const edges = new Map<string, number>();
        for (let i = 0; i < index.count; i += 3) {
          const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
          for (let j = 0; j < 3; j++) {
            const a = triangle[j];
            const b = triangle[(j + 1) % 3];
            if (a === b) continue;
            const key = a < b ? `${a},${b}` : `${b},${a}`;
            edges.set(key, (edges.get(key) ?? 0) + 1);
          }
        }
        // Una arista con un único triángulo implica una superficie abierta.
        // La caja de extracción debe contener el collar exterior completo.
        expect(
          [...edges.values()].filter((count) => count === 1),
          mesh.name,
        ).toHaveLength(0);
        const positions = mesh.geometry.getAttribute('position');
        let worst = 0;
        for (let i = 0; i < positions.count; i++) {
          const p: Vec3 = [
            (positions.getX(i) * mesh.scale.x + mesh.position.x) * 10,
            (positions.getY(i) * mesh.scale.y + mesh.position.y) * 10,
            (positions.getZ(i) * mesh.scale.z + mesh.position.z) * 10,
          ];
          const peri = Math.min(...[scene.kidneyRight, scene.kidneyLeft].map((k) => perirenalOuterSdf(kidneyLocal(p, k), k)));
          worst = Math.max(worst, Math.abs(quadratusSdf(p, -torsoDepth(p, scene.torso) - scene.wallThickness(), peri)));
        }
        // Tolerancia numérica de extracción existente, independiente de iluminación y material.
        expect(worst, mesh.name).toBeLessThan(1.5);
      }
    } finally {
      for (const object of group.children) {
        const mesh = object as Mesh;
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
      }
    }
  });
});
