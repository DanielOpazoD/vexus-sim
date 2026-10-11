import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { torsoDepth } from '../anatomy/primitives';
import { setReferenceBody } from '../anatomy/referenceBody';
import { kidneyLocal, perirenalOuterSdf } from '../anatomy/organs/kidney';
import { quadratusSdf } from '../anatomy/organs/retroperitoneum';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { buildPosteriorMuscles } from '../ui/navigator3d/organs';
import type { Mesh } from 'three';

const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

describe('soporte muscular posterior, antes de precedencia de tejidos', () => {
  it('el campo aislado rechaza espacio exterior y pared, conservando músculo válido', () => {
    // Testigo que antes era interior del QL aunque el clasificador devolvía aire.
    expect(quadratusSdf([65, -150, -130], -70, 20)).toBeGreaterThan(0);
    expect(quadratusSdf([65, -75, -130], -2, 20)).toBeGreaterThan(0);
    expect(quadratusSdf([65, -65, -130], 5, 20)).toBeLessThan(0);
    // El riñón y su soporte perirrenal siguen siendo obstáculo, no músculo.
    expect(quadratusSdf([65, -65, -130], 5, -2)).toBeGreaterThan(0);
  });

  for (const reference of [false, true])
    it(`las superficies 3D emitidas permanecen dentro del cuerpo y fuera del soporte perirrenal (${reference})`, () => {
      setReferenceBody(reference ? profile : undefined);
      try {
        const scene = new AnatomyScene(NORMAL_ADULT);
        const group = buildPosteriorMuscles(scene);
        try {
          expect(group.children).toHaveLength(4);
          for (const object of group.children) {
            const mesh = object as Mesh;
            const positions = mesh.geometry.getAttribute('position');
            expect(positions.count, mesh.name).toBeGreaterThan(3);
            for (let i = 0; i < positions.count; i++) {
              const p: Vec3 = [
                (positions.getX(i) * mesh.scale.x + mesh.position.x) * 10,
                (positions.getY(i) * mesh.scale.y + mesh.position.y) * 10,
                (positions.getZ(i) * mesh.scale.z + mesh.position.z) * 10,
              ];
              // Cota NUMÉRICA de extracción de 40³, no grosor fascial ni anatomía normal.
              // El defecto anterior sobresalía 71–92mm; el ensayo corregido <0,04mm.
              expect(torsoDepth(p, scene.torso) + scene.wallThickness(), mesh.name).toBeLessThan(1.5);
              for (const kidney of [scene.kidneyRight, scene.kidneyLeft])
                expect(perirenalOuterSdf(kidneyLocal(p, kidney), kidney), mesh.name).toBeGreaterThan(-1.5);
            }
          }
        } finally {
          for (const object of group.children) {
            const mesh = object as Mesh;
            mesh.geometry.dispose();
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
          }
        }
      } finally {
        setReferenceBody();
      }
    });
});
