import * as THREE from 'three';
import type { Vec3 } from '../../core/vec3';
import { RespiratoryDeformation } from '../../anatomy/deformation';
import { CM } from './common';

/** Rest-space weights for the same respiratory field as anatomy. Roots use LAS centimetres.
 * Does not model probe compression. Construct lazily: OFF needs no vertex work or allocation.
 */
export function bindRespiratoryMotion(roots: THREE.Group[], weightAt: (m: Vec3) => number): { apply: (mm: number) => void } {
  const meshes: Array<{
    geometry: THREE.BufferGeometry;
    rest: Float32Array;
    normals: Float32Array | null;
    weights: Float32Array;
    direction: THREE.Vector3;
  }> = [];
  const labels: Array<{ object: THREE.Sprite; rest: THREE.Vector3; direction: THREE.Vector3; weight: number }> = [];
  const seen = new Set<THREE.BufferGeometry>();
  const read = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
    const out = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) out.set([a.getX(i), a.getY(i), a.getZ(i)], i * 3);
    return out;
  };
  const direction = (toMaterial: THREE.Matrix4) =>
    new THREE.Vector3(...RespiratoryDeformation.direction)
      .multiplyScalar(CM)
      .applyMatrix3(new THREE.Matrix3().setFromMatrix4(toMaterial.clone().invert()));
  const checkedWeight = (p: THREE.Vector3) => {
    const w = weightAt([p.x / CM, p.y / CM, p.z / CM]);
    if (!Number.isFinite(w) || w < 0 || w > 1) throw new Error('Peso respiratorio 3D inválido');
    return w;
  };
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    const inverseRoot = root.matrixWorld.clone().invert();
    root.traverse((object) => {
      const toMaterial = inverseRoot.clone().multiply(object.matrixWorld);
      if (object instanceof THREE.Sprite) {
        const sprite = object as THREE.Sprite;
        const parentToMaterial = inverseRoot.clone().multiply(object.parent!.matrixWorld);
        labels.push({
          object: sprite,
          rest: sprite.position.clone(),
          direction: direction(parentToMaterial),
          weight: checkedWeight(new THREE.Vector3().setFromMatrixPosition(toMaterial)),
        });
      } else if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
        // Shared geometries may sit in different transforms and therefore need different weights.
        if (seen.has(mesh.geometry)) mesh.geometry = mesh.geometry.clone();
        seen.add(mesh.geometry);
        const geometry = mesh.geometry,
          position = geometry.getAttribute('position');
        if (!position) return;
        const rest = read(position),
          weights = new Float32Array(position.count),
          p = new THREE.Vector3();
        for (let i = 0; i < position.count; i++) weights[i] = checkedWeight(p.fromBufferAttribute(position, i).applyMatrix4(toMaterial));
        const normal = geometry.getAttribute('normal');
        meshes.push({ geometry, rest, normals: normal ? read(normal) : null, weights, direction: direction(toMaterial) });
      }
    });
  }
  let lastMm = 0;
  return {
    apply(mm) {
      if (!Number.isFinite(mm)) throw new Error('Desplazamiento respiratorio 3D inválido');
      if (mm === lastMm) return;
      lastMm = mm;
      for (const { geometry, rest, normals, weights, direction: d } of meshes) {
        const p = geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          const a = mm * weights[i];
          if (mm === 0) p.setXYZ(i, rest[3 * i], rest[3 * i + 1], rest[3 * i + 2]);
          else p.setXYZ(i, rest[3 * i] + a * d.x, rest[3 * i + 1] + a * d.y, rest[3 * i + 2] + a * d.z);
        }
        p.needsUpdate = true;
        if (normals) {
          if (mm === 0) {
            const normal = geometry.getAttribute('normal');
            for (let i = 0; i < normal.count; i++) normal.setXYZ(i, normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]);
            normal.needsUpdate = true;
          } else geometry.computeVertexNormals();
        }
        if (geometry.boundingBox) geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
      }
      for (const label of labels) {
        label.object.position.copy(label.rest);
        if (mm !== 0) label.object.position.addScaledVector(label.direction, mm * label.weight);
      }
    },
  };
}
