import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { bodyDepth, bodyGradient, bodySection, setAbdominalBody } from '../anatomy/referenceBody';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { AnatomyScene } from '../anatomy/scene';
import { CASES } from '../cases';
import type { Vec3 } from '../core/vec3';
import { buildSkin } from '../ui/navigator3d/body';

beforeAll(() => {
  const load = (name: string) => {
    const b = gunzipSync(readFileSync(`src/anatomy/${name}-atlas.gzip.bin`));
    return new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  setAbdominalAtlas(load('abdominal'));
  setThoracicAtlas(load('thoracic'));
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setThoracicAtlas();
  setAbdominalBody();
});

for (const caseId of ['normal-adult', 'severe-congestion'])
  it(`conserva continuidad, gradiente y superficie 3D del perfil costal ajustado, ${caseId}`, () => {
    const scene = new AnatomyScene(CASES.find((c) => c.id === caseId)!);
    const profile = scene.torso.profile!;
    let jump = 0,
      gradientError = 0;
    for (let k = 0; k < 64; k++)
      for (let row = 26; row < 45; row++) {
        const phi = (k * 2 * Math.PI) / 64,
          z = -400 + row * 10;
        const [r, , , cy] = bodySection(phi, z, profile);
        const p: Vec3 = [(r - 15) * Math.cos(phi), cy + (r - 15) * Math.sin(phi), z];
        const g = bodyGradient(p, profile);
        for (let axis = 0; axis < 3; axis++) {
          const a = [...p] as Vec3,
            b = [...p] as Vec3;
          a[axis] -= 1e-5;
          b[axis] += 1e-5;
          const ga = bodyGradient(a, profile),
            gb = bodyGradient(b, profile);
          jump = Math.max(jump, Math.hypot(...ga.map((v, j) => v - gb[j])));
          gradientError = Math.max(gradientError, Math.abs(g[axis] - (bodyDepth(b, profile) - bodyDepth(a, profile)) / 2e-5));
        }
      }
    // Contratos numéricos del campo, también en el perfil específico de cada paciente.
    expect(jump).toBeLessThan(0.001);
    expect(gradientError).toBeLessThan(0.0001);

    const skin = buildSkin(scene),
      geometry = skin.geometry;
    const index = geometry.index!,
      pos = geometry.getAttribute('position');
    let maxDistanceMm = 0;
    let worstPoint: Vec3 = [0, 0, 0];
    for (let i = 0; i < index.count; i += 3 * 17) {
      const p: Vec3 = [0, 0, 0];
      for (let j = 0; j < 3; j++) {
        const v = index.getX(i + j);
        p[0] += (pos.getX(v) * 10) / 3;
        p[1] += (pos.getY(v) * 10) / 3;
        p[2] += (pos.getZ(v) * 10) / 3;
      }
      const err = Math.abs(bodyDepth(p, profile));
      const vertex = (j: number): Vec3 => {
        const k = index.getX(i + j);
        return [pos.getX(k), pos.getY(k), pos.getZ(k)];
      };
      const a = vertex(0),
        b = vertex(1).map((v, j) => v - a[j]),
        c = vertex(2).map((v, j) => v - a[j]);
      const normal = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]];
      const grad = bodyGradient(p, profile);
      expect(normal.reduce((s, v, j) => s + v * grad[j], 0)).toBeGreaterThan(0);
      if (err > maxDistanceMm) {
        maxDistanceMm = err;
        worstPoint = p;
      }
    }
    skin.traverse((obj) => {
      if ('geometry' in obj && obj.geometry && typeof obj.geometry === 'object' && 'dispose' in obj.geometry)
        (obj.geometry as { dispose(): void }).dispose();
    });
    // Error geométrico submilimétrico frente al campo acústico, no precisión clínica del atlas.
    console.log({ caseId, jump, gradientError, maxDistanceMm, worstPoint });
    expect(maxDistanceMm).toBeLessThan(0.5);
  });
