import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { sdRib } from '../anatomy/primitives';
import { NORMAL_ADULT } from '../cases';
import { costalGeometry } from '../ui/navigator3d/body';
import type { Vec3 } from '../core/vec3';

const scene = new AnatomyScene(NORMAL_ADULT);
describe('registro costal compartido en milímetros', () => {
  it('la superficie 3D reproduce las secciones acústicas de ambos lados', () => {
    for (const rib of scene.ribs)
      for (const side of [-1, 1]) {
        const geometry = costalGeometry(scene, rib, side);
        const p = geometry.getAttribute('position');
        expect(p.count).toBeGreaterThan(300);
        for (let i = 13; i < p.count - 13; i++) {
          const q: Vec3 = [p.getX(i) * 10, p.getY(i) * 10, p.getZ(i) * 10];
          expect(Math.abs(sdRib(q, rib, scene.torso, scene.spine).d), `${rib.zAnterior}/${side}/${i}/${JSON.stringify(q)}`).toBeLessThan(
            0.001,
          );
        }
        expect(geometry.groups.some((g) => g.materialIndex === 0)).toBe(true);
        expect(geometry.groups.some((g) => g.materialIndex === 1)).toBe(true);
        geometry.dispose();
      }
  });
  it('ambas hemicajas tienen hueso, cartílago y espacios derivados de sus superficies', () => {
    for (const rib of scene.ribs) {
      for (const phi of [Math.PI * 0.95, Math.PI, Math.PI * 1.2, Math.PI * 1.35]) {
        const q: Vec3 = [
          scene.torso.a * rib.scale * Math.cos(phi),
          scene.torso.b * rib.scale * Math.sin(phi),
          rib.zAnterior + rib.tilt * (0.5 - 0.5 * Math.sin(phi)),
        ];
        const right = sdRib(q, rib, scene.torso, scene.spine);
        const left = sdRib([-q[0], q[1], q[2]], rib, scene.torso, scene.spine);
        expect(right.d).toBeLessThan(0);
        expect(left).toEqual(right);
      }
    }
    for (let i = 1; i < scene.ribs.length; i++) {
      const upper = scene.ribs[i - 1],
        lower = scene.ribs[i];
      const zUpper = upper.zAnterior + upper.tilt * 0.5;
      const zLower = lower.zAnterior + lower.tilt * 0.5;
      const gap = zUpper - upper.halfWidth - zLower - lower.halfWidth;
      expect(gap).toBeGreaterThan(0);
      for (const side of [-1, 1]) {
        const q: Vec3 = [side * scene.torso.a * upper.scale, 0, (zUpper - upper.halfWidth + zLower + lower.halfWidth) / 2];
        expect(scene.ribs.every((r) => sdRib(q, r, scene.torso, scene.spine).d > 0)).toBe(true);
      }
    }
  });
});
