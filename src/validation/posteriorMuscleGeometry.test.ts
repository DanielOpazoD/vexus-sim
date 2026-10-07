import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { Vector3, type Mesh } from 'three';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { quadratusSdf } from '../anatomy/organs/retroperitoneum';
import { torsoDepth } from '../anatomy/primitives';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { buildPosteriorMuscles } from '../ui/navigator3d/organs';

afterEach(() => {
  setAbdominalAtlas();
  setAbdominalBody();
});

describe('contención posterior del músculo, fuera del orden de clasificación (181)', () => {
  it('rechaza el exterior aunque no se haya clasificado antes la pared', () => {
    // Los dos puntos estaban dentro del campo antiguo: éste no tenía cara posterior.
    // La grasa queda lejos; el rechazo debe proceder del dominio de la pared.
    for (const x of [-65, 65]) {
      expect(quadratusSdf([x, -200, -150], -80, 100)).toBeGreaterThan(0);
      expect(quadratusSdf([x, -75, -150], -0.1, 100)).toBeGreaterThan(0);
      expect(quadratusSdf([x, -75, -150], 6, 100)).toBeLessThan(0);
    }
  });

  it.each(['procedural', 'atlas'] as const)('la superficie %s conserva ambos músculos dentro de la pared', (model) => {
    if (model === 'atlas') {
      const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
      const profile = readFileSync('src/anatomy/abdominal-body.bin');
      setAbdominalAtlas(new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
      setAbdominalBody(new Float32Array(profile.buffer.slice(profile.byteOffset, profile.byteOffset + profile.byteLength)));
    }
    const scene = new AnatomyScene(NORMAL_ADULT);
    expect(scene.hasAbdominalAtlas).toBe(model === 'atlas');
    const group = buildPosteriorMuscles(scene);
    group.updateMatrixWorld(true);
    const muscles = group.children.filter((m) => m.name.startsWith('Cuadrado lumbar')) as Mesh[];
    expect(muscles.map((m) => m.name)).toEqual(['Cuadrado lumbar derecho', 'Cuadrado lumbar izquierdo']);
    for (const mesh of muscles) {
      const positions = mesh.geometry.getAttribute('position');
      expect(positions.count, mesh.name).toBeGreaterThan(1000);
      let maxOutside = -Infinity;
      for (let i = 0; i < positions.count; i++) {
        const q = new Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).multiplyScalar(10);
        const p: Vec3 = [q.x, q.y, q.z];
        maxOutside = Math.max(maxOutside, torsoDepth(p, scene.torso) + scene.wallThickness());
      }
      // Frontera externa independiente: profundidad corporal, sin consultar el campo muscular.
      expect(maxOutside, `${model}/${mesh.name}: fuera ${maxOutside} mm`).toBeLessThan(1.5);
    }
    for (const mesh of group.children as Mesh[]) {
      mesh.geometry.dispose();
      if (!Array.isArray(mesh.material)) mesh.material.dispose();
    }
  });
});
