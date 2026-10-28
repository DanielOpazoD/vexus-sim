import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { uncompress, warpAt, nodeSin, PROBE_COMPRESSION } from '../anatomy/compression';
import { Interface } from '../anatomy/interfaces';
import { wallFaceSd } from '../anatomy/organs/wall';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene } from '../anatomy/scene';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { startPointsFor } from '../app/startPoints';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine } from '../probe/probe';

beforeAll(() => {
  for (const [setter, name] of [
    [setAbdominalAtlas, 'abdominal'],
    [setThoracicAtlas, 'thoracic'],
  ] as const) {
    const b = gunzipSync(readFileSync(`src/anatomy/${name}-atlas.gzip.bin`));
    setter(new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setThoracicAtlas();
  setAbdominalBody();
});

// Pose copiada por el usuario en 2e4b06b, no un preset buscado para la prueba.
const pose = { phi: 3.55, z: -180, lift: 0, yaw: -0.1321882345454526, rock: 0.3780207766067785, tilt: 0.04720718521646405 };

it('no introduce una esquina en la deformación al atravesar los nodos de contacto', () => {
  const scene = new AnatomyScene(NORMAL_ADULT),
    k = probeContact(pose, CONVEX_C35, scene.torso);
  let jump = 0;
  for (let i = 1; i < PROBE_COMPRESSION.nodes - 1; i++) {
    const theta = Math.asin(nodeSin(i, CONVEX_C35.halfSector));
    for (const depth of [5, 15, 25, 40]) {
      const a = warpAt(pointOnLine(k.frame, CONVEX_C35, theta - 1e-7, depth), k).grad;
      const b = warpAt(pointOnLine(k.frame, CONVEX_C35, theta + 1e-7, depth), k).grad;
      jump = Math.max(jump, Math.hypot(...a.map((v, j) => v - b[j])));
    }
  }
  expect(jump).toBeLessThan(0.0001);
});

it.each([-1, 0, 1, 'preset'] as const)('redondea la punta original y la del punto de partida: %s', (dz) => {
  const scene = new AnatomyScene(NORMAL_ADULT),
    sp = startPointsFor(scene.torso).find((p) => p.id === 'renal')!,
    target = dz === 'preset' ? { ...sp, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 } : { ...pose, z: pose.z + dz },
    k = probeContact(target, CONVEX_C35, scene.torso);
  for (const iface of [Interface.DeepFascia, Interface.Transversalis, Interface.Peritoneum]) {
    const points: [number, number][] = [];
    for (let deg = 0; deg <= 28; deg += 0.125) {
      const theta = (deg * Math.PI) / 180;
      const face = (r: number) => wallFaceSd(uncompress(pointOnLine(k.frame, CONVEX_C35, theta, r), k), iface, scene.torso);
      let lo = 0,
        hi = 100;
      expect(face(lo)).toBeLessThan(0);
      expect(face(hi)).toBeGreaterThan(0);
      for (let n = 0; n < 28; n++) {
        const mid = (lo + hi) / 2;
        if (face(mid) > 0) hi = mid;
        else lo = mid;
      }
      const rho = CONVEX_C35.curvatureRadius + (lo + hi) / 2;
      points.push([rho * Math.sin(theta), rho * Math.cos(theta)]);
    }
    let turn = 0;
    for (let i = 2; i < points.length - 2; i++) {
      const a = points[i - 2],
        b = points[i],
        c = points[i + 2];
      const incoming = Math.atan2(b[1] - a[1], b[0] - a[0]),
        outgoing = Math.atan2(c[1] - b[1], c[0] - b[0]);
      turn = Math.max(turn, (Math.abs(outgoing - incoming) * 180) / Math.PI);
    }
    // Cota de suavidad de las secantes de 0,25°, no umbral clínico ni
    // certificación de todas las poses. La captura previa supera 20°.
    console.log({ dz, iface, turn });
    expect(turn).toBeLessThan(iface === Interface.DeepFascia ? 10 : 15);
  }
});

it.each([NORMAL_ADULT, SEVERE_CONGESTION])('conserva el plano renal de partida al cambiar el marco cutáneo: $id', (patient) => {
  const scene = new AnatomyScene(patient),
    sp = startPointsFor(scene.torso).find((p) => p.id === 'renal')!,
    k = probeContact({ ...sp, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 }, CONVEX_C35, scene.torso);
  // Planos mundo medidos en la base 2e4b06b antes de modificar la piel.
  // La misma corrección angular, sin consultar el caso, conserva ambas ventanas.
  const reference =
    patient.id === 'normal-adult'
      ? {
          elevation: [0.5530687315128402, -0.8252615932795165, -0.1142728352695072],
          face: [-123.61076047529843, -67.31709429665774, -174.8572512552861],
        }
      : {
          elevation: [0.5522020591108655, -0.8258419152593671, -0.11427168028195173],
          face: [-124.52066770615603, -67.7251812298682, -174.85643592907206],
        };
  // 0,01 mm y norma 1e-4: registro numérico del plano, no exactitud clínica.
  expect(Math.hypot(...k.frame.elevation.map((v, i) => v - reference.elevation[i]))).toBeLessThan(1e-4);
  expect(Math.abs(k.frame.face.reduce((v, x, i) => v + (x - reference.face[i]) * reference.elevation[i], 0))).toBeLessThan(0.01);
});
