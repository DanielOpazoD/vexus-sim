import { expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three';
import { bindRespiratoryMotion } from './respiratoryMotion';
import { prepareOrganSurface } from './organs';
it('smooths shared renal surface lighting without changing geometry or joining nearby separate surfaces', () => {
  const points = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0.01, 0, 0, 0.01, 1, 0, 0.01, 0, 1]);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(points, 3));
  g.computeVertexNormals();
  prepareOrganSurface(g);
  expect(g.getAttribute('position').array).toEqual(points);
  expect(Array.from(g.index!.array)).toEqual([0, 1, 2, 0, 2, 5, 6, 7, 8]);
  const n = g.getAttribute('normal');
  expect(n.getX(0)).toBeCloseTo(Math.SQRT1_2, 6);
  expect(n.getZ(0)).toBeCloseTo(Math.SQRT1_2, 6);

  expect(n.getX(6)).toBe(1);
  expect(n.getZ(6)).toBe(0);
  const root = new Group();
  root.add(new Mesh(g));
  const binding = bindRespiratoryMotion([root], () => 0.5);
  binding.apply(10);
  // Recomputing normals during breathing must keep the shared edge smooth.
  expect(n.getX(0)).toBeCloseTo(Math.SQRT1_2, 6);
  expect(n.getZ(0)).toBeCloseTo(Math.SQRT1_2, 6);
  binding.apply(0);
  expect(g.getAttribute('position').array).toEqual(points);
  g.dispose();
});
