import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { bodyDepth, bodyGradient, bodySection, bodyStride, validateReferenceBody, setAbdominalBody } from '../anatomy/referenceBody';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { AnatomyScene } from '../anatomy/scene';
import { CASES } from '../cases';
import type { Vec3 } from '../core/vec3';
import { buildSkin } from '../ui/navigator3d/body';
import { Interface } from '../anatomy/interfaces';
import { wallFaceSd } from '../anatomy/organs/wall';
import { startPointsFor } from '../app/startPoints';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine } from '../probe/probe';
import { uncompress } from '../anatomy/compression';

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
    const profile = scene.torso.profile!,
      stride = bodyStride(profile),
      sectors = stride - 1;
    expect(validateReferenceBody(structuredClone(profile))).toEqual(profile);
    let jump = 0,
      gradientError = 0;
    for (let k = 0; k < sectors; k++)
      for (let row = 26; row < 45; row++) {
        const phi = (k * 2 * Math.PI) / sectors,
          z = -400 + row * 10;
        const [r, , , cy] = bodySection(phi, z, profile);
        expect(r).toBeCloseTo(profile[row * stride + 1 + k], 9);
        expect(cy).toBeCloseTo(profile[row * stride], 9);
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

for (const caseId of ['normal-adult', 'severe-congestion'])
  it(`redondea el quiebre visible de la fascia hepatorrenal, ${caseId} (217)`, () => {
    const scene = new AnatomyScene(CASES.find((c) => c.id === caseId)!);
    const sp = startPointsFor(scene.torso).find((p) => p.id === 'hepatorenal')!;
    const k = probeContact({ ...sp, lift: 0, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 }, CONVEX_C35, scene.torso);
    const points: [number, number][] = [];
    for (let deg = 3; deg <= 15; deg += 0.125) {
      const theta = (deg * Math.PI) / 180;
      let lo = 0,
        hi = 40;
      const face = (r: number) => wallFaceSd(uncompress(pointOnLine(k.frame, CONVEX_C35, theta, r), k), Interface.DeepFascia, scene.torso);
      expect(face(lo)).toBeLessThan(0);
      expect(face(hi)).toBeGreaterThan(0);
      for (let n = 0; n < 30; n++) {
        const r = (lo + hi) / 2;
        if (face(r) > 0) hi = r;
        else lo = r;
      }
      const rho = CONVEX_C35.curvatureRadius + (lo + hi) / 2;
      points.push([rho * Math.sin(theta), rho * Math.cos(theta)]);
    }
    let turn = 0;
    for (let i = 2; i < points.length - 2; i++) {
      const a = points[i - 2],
        b = points[i],
        c = points[i + 2];
      const incoming = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const outgoing = Math.atan2(c[1] - b[1], c[0] - b[0]);
      turn = Math.max(turn, (Math.abs(outgoing - incoming) * 180) / Math.PI);
    }
    // Tramo registrado de la captura del usuario. Secantes de 0,25°: antes
    // había 5,8° en A. Cota geométrica de suavidad, no normalidad clínica.
    console.log({ caseId, fasciaTurnDeg: turn });
    expect(turn).toBeLessThan(3);
  });
