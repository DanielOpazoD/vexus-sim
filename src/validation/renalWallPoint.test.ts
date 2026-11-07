import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { nodeSin, PROBE_COMPRESSION, uncompress, warpAt } from '../anatomy/compression';
import { Interface } from '../anatomy/interfaces';
import { wallFaceSd } from '../anatomy/organs/wall';
import { startPointsFor } from '../app/startPoints';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine } from '../probe/probe';
import { setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { setAbdominalBody } from './support/legacyPerson/referenceBody';
import { AnatomyScene } from './support/legacyPerson/scene';
import { setThoracicAtlas } from './support/legacyPerson/thoracicAtlas';

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
    sp = startPointsFor(scene.torso, { person: 'current' }).find((p) => p.id === 'renal')!,
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
    sp = startPointsFor(scene.torso, { person: 'current' }).find((p) => p.id === 'renal')!,
    k = probeContact({ ...sp, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 }, CONVEX_C35, scene.torso);
  // Planos mundo de la pose de la decisión 329 (antes, los de la 309). Un cambio de la piel o del marco cutáneo no debe
  // moverlos sin decidirlo.
  const reference =
    patient.id === 'normal-adult'
      ? {
          elevation: [-0.7789468416056944, -0.6058912482222277, -0.16167131248377065],
          face: [-114.24300069996039, 17.162308804312048, -135.7435728042458],
        }
      : {
          elevation: [-0.7767622899352518, -0.6083379743897426, -0.16298850833702488],
          face: [-114.70836355975335, 16.96566017005298, -135.73478830703678],
        };
  // 0,01 mm y norma 1e-4: registro numérico del plano, no exactitud clínica.
  expect(Math.hypot(...k.frame.elevation.map((v, i) => v - reference.elevation[i]))).toBeLessThan(1e-4);
  expect(Math.abs(k.frame.face.reduce((v, x, i) => v + (x - reference.face[i]) * reference.elevation[i], 0))).toBeLessThan(0.01);
});
