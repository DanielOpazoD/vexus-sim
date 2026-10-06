// @tier fast
import { describe, expect, it } from 'vitest';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { ribCentre, sdRib, torsoDepth } from '../anatomy/primitives';
import { sternumSd, STERNUM } from '../anatomy/organs/sternum';
import { Interface } from '../anatomy/interfaces';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { buildSkeleton } from '../ui/navigator3d/body';
import type { Vec3 } from '../core/vec3';
import type { Mesh } from 'three';

const s = new AnatomyScene(NORMAL_ADULT);
describe('cobertura costal y esternón acústico, decisión 166', () => {
  it('los doce pares existen en ambos hemitórax y las flotantes terminan antes del arco anterior', () => {
    expect(s.ribs.map((r) => r.number).sort((a, b) => a! - b!)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    for (const r of s.ribs) {
      const phi = r.frontPhi === undefined ? Math.PI : (r.frontPhi + 4.15) / 2;
      const p = ribCentre(phi, r, s.torso);
      for (const side of [-1, 1]) {
        const q: Vec3 = [side * p[0], p[1], p[2]];
        expect(s.classify(q, BASELINE_CALIBER).tissue, String(r.number)).toBe(Tissue.Bone);
        expect(torsoDepth(q, s.torso)).toBeLessThan(-s.torso.skinMm);
      }
      if (r.frontPhi === undefined) continue;
      const anterior = ribCentre(r.frontPhi - 0.15, r, s.torso);
      const posterior = ribCentre(r.frontPhi + 0.15, r, s.torso);
      expect(sdRib(anterior, r, s.torso, s.spine).d).toBeGreaterThan(5);
      expect(sdRib(posterior, r, s.torso, s.spine)).toMatchObject({ cartilage: false });
      expect(sdRib(posterior, r, s.torso, s.spine).d).toBeLessThan(0);
      // Control adversarial: quitar el extremo devuelve una costilla falsa en el punto negativo.
      const broken = { ...r };
      delete broken.frontPhi;
      expect(sdRib(anterior, broken, s.torso, s.spine).d).toBeLessThan(0);
    }
  });

  it('manubrio/cuerpo son hueso, xifoides cartílago y el campo no reaparece en la espalda o fuera de sus extremos', () => {
    const y = s.torso.b * STERNUM.ribScale;
    for (const z of [70, 140]) expect(s.classify([0, y, z], BASELINE_CALIBER).tissue).toBe(Tissue.Bone);
    expect(s.classify([0, y, 10], BASELINE_CALIBER).tissue).toBe(Tissue.Cartilage);
    expect(s.classify([0, y, STERNUM.zJunctionMm - 0.5], BASELINE_CALIBER).interface).toBe(Interface.Perichondrium);
    expect(s.classify([0, y, STERNUM.zJunctionMm + 0.5], BASELINE_CALIBER).tissue).toBe(Tissue.Bone);
    // Control que detecta el registro anterior de la decisión 166: allí había xifoides artificial.
    expect(s.classify([0, y, -15], BASELINE_CALIBER).tissue).not.toBe(Tissue.Cartilage);
    expect(sternumSd([0, y, -15], s.torso)).toBe(15);
    for (const p of [
      [0, -y, 70],
      [0, y, 190],
      [0, y, -50],
      [50, y, 140],
    ] as Vec3[])
      expect(sternumSd(p, s.torso)).toBeGreaterThan(10);
    const p: Vec3 = [0, y + STERNUM.thicknessMm / 2 + 0.1, 80];
    expect(s.classify(p, BASELINE_CALIBER).interface).toBe(Interface.RibCortex);
    const g = s.faceGradient(p, BASELINE_CALIBER)!;
    expect(g.normal[1]).toBeGreaterThan(0.99);
    expect(g.norm).toBeCloseTo(1, 3);
  });

  it('las dos mallas esternales se extraen de la anatomía acústica, dentro de la resolución de extracción', () => {
    const skeleton = buildSkeleton(s);
    const meshes = skeleton.children.slice(24, 26) as Mesh[];
    for (const mesh of meshes) {
      const p = mesh.geometry.getAttribute('position');
      expect(p.count).toBeGreaterThan(100);
      let checked = 0;
      for (let i = 0; i < p.count; i += 17) {
        const q: Vec3 = [
          (p.getX(i) * mesh.scale.x + mesh.position.x) * 10,
          (p.getY(i) * mesh.scale.y + mesh.position.y) * 10,
          (p.getZ(i) * mesh.scale.z + mesh.position.z) * 10,
        ];
        // La unión registrada cierra cada material dentro del volumen esternal: verificar también esa superficie,
        // usando el campo de intersección, en vez de excluir una banda alrededor de la unión.
        const part = Math.max(sternumSd(q, s.torso), mesh === meshes[0] ? STERNUM.zJunctionMm - q[2] : q[2] - STERNUM.zJunctionMm);
        expect(Math.abs(part), JSON.stringify(q)).toBeLessThan(0.2);
        checked++;
      }
      expect(checked).toBeGreaterThan(100);
    }
    for (const mesh of skeleton.children as Mesh[]) mesh.geometry.dispose();
  });
});
