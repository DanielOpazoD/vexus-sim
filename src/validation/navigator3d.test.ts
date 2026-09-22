import { describe, expect, it } from 'vitest';
import { HILUM_NOTCH, kidneyLocal } from '../anatomy/organs/kidney';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { CM } from '../ui/navigator3d/common';
import { buildKidneyMesh, buildLiverMesh } from '../ui/navigator3d/organs';

/**
 * El navegador 3D extrae sus mallas del MISMO campo implícito que corta el haz:
 * estas pruebas comprueban que la malla reproduce los rasgos del SDF (escotadura
 * hiliar del riñón, fisura umbilical del hígado) y no un elipsoide liso.
 */
const scene = new AnatomyScene(NORMAL_ADULT);

function verticesMm(mesh: ReturnType<typeof buildKidneyMesh>): Vec3[] {
  const pos = mesh.geometry.getAttribute('position');
  const s = mesh.scale.x / CM;
  const out: Vec3[] = [];
  for (let i = 0; i < pos.count; i++)
    out.push([pos.getX(i) * s + mesh.position.x / CM, pos.getY(i) * s + mesh.position.y / CM, pos.getZ(i) * s + mesh.position.z / CM]);
  return out;
}

describe('Mallas 3D por marching cubes sobre el SDF (decisiones 37 y 40)', () => {
  it('el riñón 3D tiene la escotadura hiliar: la cara medial se hunde ≥ 6 mm respecto al elipsoide', () => {
    const k = scene.kidneyRight;
    const verts = verticesMm(buildKidneyMesh(k));
    expect(verts.length).toBeGreaterThan(2000);
    // vértices en la banda del hilio (cara +v, |u| < 8, |w| < 8) en coordenadas locales
    let vMax = -Infinity;
    let vMaxLateral = -Infinity;
    for (const p of verts) {
      const q = kidneyLocal(p, k);
      if (Math.abs(q[0]) < 8 && Math.abs(q[2]) < 8) vMax = Math.max(vMax, q[1]);
      // misma cara pero fuera de la escotadura (|u| ≈ 30): el elipsoide sin hundir
      if (Math.abs(Math.abs(q[0]) - 30) < 4 && Math.abs(q[2]) < 8) vMaxLateral = Math.max(vMaxLateral, q[1]);
    }
    expect(Number.isFinite(vMax)).toBe(true);
    expect(k.radii[1] - vMax).toBeGreaterThan(6);
    expect(HILUM_NOTCH.radii[1]).toBeGreaterThan(6);
    expect(vMax).toBeLessThan(vMaxLateral);
  });

  it('el hígado 3D lleva la fisura umbilical: falta superficie anterior en x ≈ 15 bajo z −30', () => {
    const verts = verticesMm(buildLiverMesh(scene));
    expect(verts.length).toBeGreaterThan(5000);
    const yMaxAt = (x: number, z: number) => {
      let y = -Infinity;
      for (const p of verts) if (Math.abs(p[0] - x) < 1.5 && Math.abs(p[2] - z) < 2 && p[1] > 0) y = Math.max(y, p[1]);
      return y;
    };
    // en la fisura la superficie anterior más externa está ≥ 8 mm más honda que 12 mm al lado
    expect(yMaxAt(27, -48) - yMaxAt(15, -48)).toBeGreaterThan(8);
    // por encima de zMax no hay fisura
    expect(Math.abs(yMaxAt(27, -15) - yMaxAt(15, -15))).toBeLessThan(4);
  });
});
