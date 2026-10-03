import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AnatomyScene } from '../anatomy/scene';
import { RespiratoryDeformation } from '../anatomy/deformation';
import { diaphragmRim } from '../anatomy/diaphragmRim';
import { setReferenceBody } from '../anatomy/referenceBody';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import type { RespiratorySample } from '../physiology/respiratory';
import { CM } from '../ui/navigator3d/common';
import { bindRespiratoryMotion } from '../ui/navigator3d/respiratoryMotion';

function mesh(points: number[] = [0, 0, 0, 1, 0, 0, 0, 1, 0]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial());
}
const sample = (mm: number): RespiratorySample => ({
  cycling: true,
  phase: 0.25,
  volume: 1,
  volumeRate: 0,
  pleuralMmHg: -5,
  abdominalMmHg: 1,
  diaphragmCaudalMm: mm,
  diaphragmVelocityMmS: 0,
});
const coords = (m: THREE.Mesh, root: THREE.Group) => {
  root.updateWorldMatrix(true, true);
  const matrix = root.matrixWorld.clone().invert().multiply(m.matrixWorld),
    p = m.geometry.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) =>
    new THREE.Vector3()
      .fromBufferAttribute(p, i)
      .applyMatrix4(matrix)
      .multiplyScalar(1 / CM)
      .toArray(),
  );
};
const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
afterEach(() => setReferenceBody());

describe('movimiento 3D en el mismo campo respiratorio material', () => {
  for (const reference of [false, true])
    it(`mantiene inserción y región vertebral, y sigue la víscera (${reference ? 'referencia' : 'legacy'})`, () => {
      setReferenceBody(reference ? profile : undefined);
      const scene = new AnatomyScene(NORMAL_ADULT),
        deformation = new RespiratoryDeformation(scene);
      const rim = diaphragmRim(0, scene.diaphragm, scene.torso, scene.wallThickness());
      const material: Vec3[] = [rim, [-50, 0, -50], [scene.spine.x0, scene.spine.y0, -40]];
      const root = new THREE.Group(),
        m = mesh(material.flat().map((x) => x * CM));
      root.add(m);
      const before = coords(m, root);
      const binding = bindRespiratoryMotion([root], (p) => scene.respiratoryWeight(p));
      for (const mm of [10, 30, 3, 0]) {
        binding.apply(mm);
        const actual = coords(m, root);
        actual.forEach((p, i) => {
          const expected = deformation.toWorld(before[i], sample(mm));
          expect(Math.hypot(...p.map((x, k) => x - expected[k]))).toBeLessThan(0.0001);
        });
        expect(Math.hypot(...actual[0].map((x, k) => x - before[0][k]))).toBeLessThan(0.0001);
        expect(actual[2]).toEqual(before[2]);
      }
      expect(root.position.toArray()).toEqual([0, 0, 0]);
    });

  it('respeta transformaciones anidadas, escala no uniforme y reflexión del mundo', () => {
    const world = new THREE.Group(),
      root = new THREE.Group(),
      nested = new THREE.Group(),
      m = mesh();
    world.scale.x = -1;
    world.position.set(30, 4, -9);
    world.add(root);
    root.add(nested);
    nested.add(m);
    nested.position.set(2, -3, 1);
    nested.rotation.set(0.2, 0.4, -0.1);
    nested.scale.set(2, 3, 0.7);
    const before = coords(m, root),
      direction = RespiratoryDeformation.direction;
    const binding = bindRespiratoryMotion([root], () => 0.35);
    binding.apply(20);
    coords(m, root).forEach((p, i) => p.forEach((x, k) => expect(x).toBeCloseTo(before[i][k] + 7 * direction[k], 4)));
  });

  it('restaura posiciones y normales exactamente, sin deriva tras ciclos', () => {
    const root = new THREE.Group(),
      m = mesh([-0, 0, 0, 1, 0, 0, 0, 1, 0]);
    root.add(m);
    const p = m.geometry.getAttribute('position') as THREE.BufferAttribute,
      n = m.geometry.getAttribute('normal');
    const rest = Array.from(p.array),
      normals = Array.from(n.array),
      version = p.version;
    const binding = bindRespiratoryMotion([root], (p) => Math.min(1, Math.max(0, p[0] / 10)));
    binding.apply(0);
    expect(p.version).toBe(version);
    for (let i = 0; i < 100; i++) {
      binding.apply(10);
      binding.apply(0);
    }
    expect(Array.from(p.array)).toEqual(rest);
    expect(Array.from(n.array)).toEqual(normals);
    binding.apply(10);
    expect(Array.from(n.array)).not.toEqual(normals);
    expect(m.geometry.boundingSphere?.radius).toBeGreaterThan(0);
    const current = p.version;
    binding.apply(10);
    expect(p.version).toBe(current);
  });

  it('separa geometrías compartidas si ocupan posiciones materiales distintas', () => {
    const root = new THREE.Group(),
      a = mesh(),
      b = new THREE.Mesh(a.geometry, a.material);
    b.position.x = 4;
    root.add(a, b);
    const binding = bindRespiratoryMotion([root], (p) => (p[0] < 20 ? 0 : 1));
    expect(a.geometry).not.toBe(b.geometry);
    const first = coords(a, root),
      second = coords(b, root);
    binding.apply(10);
    expect(coords(a, root)).toEqual(first);
    coords(b, root).forEach((p, i) =>
      p.forEach((x, k) => expect(x).toBeCloseTo(second[i][k] + 10 * RespiratoryDeformation.direction[k], 5)),
    );
  });

  it('mueve el anclaje de rótulos sin deformar su quad compartido', () => {
    const root = new THREE.Group(),
      nested = new THREE.Group(),
      label = new THREE.Sprite();
    nested.rotation.y = 0.3;
    nested.scale.set(2, 1, 3);
    nested.position.set(1, 2, 3);
    label.position.set(1, 0, 2);
    root.add(nested);
    nested.add(label);
    root.updateWorldMatrix(true, true);
    const before = label.getWorldPosition(new THREE.Vector3()),
      rest = label.position.clone(),
      quad = Array.from(label.geometry.getAttribute('position').array);
    const binding = bindRespiratoryMotion([root], () => 0.5);
    binding.apply(12);
    root.updateWorldMatrix(true, true);
    const after = label.getWorldPosition(new THREE.Vector3());
    expect(after.distanceTo(before.addScaledVector(new THREE.Vector3(...RespiratoryDeformation.direction), 0.6))).toBeLessThan(1e-9);
    expect(Array.from(label.geometry.getAttribute('position').array)).toEqual(quad);
    binding.apply(0);
    expect(label.position.toArray()).toEqual(rest.toArray());
  });

  it('rechaza pesos y desplazamientos no finitos', () => {
    const root = new THREE.Group();
    root.add(mesh());
    for (const value of [NaN, Infinity, -0.1, 1.1]) expect(() => bindRespiratoryMotion([root], () => value)).toThrow();
    const binding = bindRespiratoryMotion([root], () => 1);
    expect(() => binding.apply(NaN)).toThrow();
    expect(() => binding.apply(Infinity)).toThrow();
  });
});
