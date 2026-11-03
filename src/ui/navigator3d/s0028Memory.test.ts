import { expect, it, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from 'three';
import { installAnatomyBundle, S0028_BUNDLE } from '../../anatomy/anatomyBundle';
import { AnatomyScene } from '../../anatomy/scene';
import { NORMAL_ADULT } from '../../cases';
import { buildOrgans } from './organs';
import { buildSkeleton } from './body';
import { s0028Surfaces } from '../s0028Surfaces';

vi.mock('../s0028Surfaces', () => ({
  s0028Surfaces: ['liver', 'thoracicBone'].map((name) => ({
    name,
    asset: name === 'liver' ? 'abdominal' : 'thoracic',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
  })),
}));

it('conserva los triángulos y su iluminación plana sin duplicarlos en normales CPU/GPU', () => {
  installAnatomyBundle(S0028_BUNDLE);
  const scene = new AnatomyScene(NORMAL_ADULT);
  const groups = [buildOrgans(scene), buildSkeleton(scene)];
  for (const group of groups) {
    expect(group.children).toHaveLength(1);
    const mesh = group.children[0];
    expect(mesh).toBeInstanceOf(Mesh);
    if (!(mesh instanceof Mesh)) throw new Error('Falta la malla fuente');
    const geometry: unknown = mesh.geometry;
    if (!(geometry instanceof BufferGeometry)) throw new Error('Falta la geometría fuente');
    const surface = s0028Surfaces.find((f) => f.name === mesh.name);
    const position: unknown = geometry.getAttribute('position');
    if (!(position instanceof BufferAttribute)) throw new Error('Falta el atributo de posiciones');
    expect(position.array).toBe(surface?.positions);
    expect(geometry.index?.array).toBe(surface?.indices);
    expect(geometry.getAttribute('normal')).toBeUndefined();
    expect(mesh.material).toBeInstanceOf(MeshStandardMaterial);
    if (!(mesh.material instanceof MeshStandardMaterial)) throw new Error('Falta el material físico');
    expect(mesh.material.flatShading).toBe(true);
    geometry.dispose();
    mesh.material.dispose();
  }
});
