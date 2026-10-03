import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial } from 'three';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { CM } from '../ui/navigator3d/common';
import { buildLiverMesh, meshFromSdf } from '../ui/navigator3d/organs';

function pointsMm(mesh: ReturnType<typeof meshFromSdf>): Vec3[] {
  const p = mesh.geometry.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) => [
    (p.getX(i) * mesh.scale.x + mesh.position.x) / CM,
    (p.getY(i) * mesh.scale.y + mesh.position.y) / CM,
    (p.getZ(i) * mesh.scale.z + mesh.position.z) / CM,
  ]);
}

describe('registro absoluto entre la malla de órganos y el campo físico', () => {
  for (const resolution of [12, 28])
    for (const axis of [0, 1, 2])
      it(`sitúa el plano analítico sin desplazamiento de medio voxel: eje ${axis}, resolución ${resolution}`, () => {
        const offset = [7.125, -1.75, 2.3][axis];
        const material = new MeshBasicMaterial();
        const mesh = meshFromSdf((p) => p[axis] - offset, [-20, -30, -40], [40, 35, 40], resolution, material);
        const points = pointsMm(mesh);
        expect(points.length).toBeGreaterThan(100);
        const residual = Math.max(...points.map((p) => Math.abs(p[axis] - offset)));
        expect(residual).toBeLessThan(0.0001);
        mesh.geometry.dispose();
        material.dispose();
      });

  it('extrae el hígado del margen compartido, sin copiar el recorte vertical del diafragma', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    let calls = 0;
    const roof = -17.5;
    scene.liverInteriorMargin = (p: Vec3) => {
      calls++;
      return roof - p[2];
    };
    const mesh = buildLiverMesh(scene);
    expect(calls).toBe(64 ** 3);
    const points = pointsMm(mesh);
    expect(points.length).toBeGreaterThan(100);
    expect(Math.max(...points.map((p) => Math.abs(p[2] - roof)))).toBeLessThan(0.0001);
    mesh.geometry.dispose();
    (mesh.material as MeshBasicMaterial).dispose();
  });
});
