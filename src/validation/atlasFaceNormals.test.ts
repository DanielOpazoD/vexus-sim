import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { uncompress } from '../anatomy/compression';
import { Interface, interfaceReflectivity } from '../anatomy/interfaces';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { reflectionCoefficient, Tissue } from '../anatomy/tissues';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { startPointsFor } from '../app/startPoints';
import { CASES } from '../cases';
import type { Vec3 } from '../core/vec3';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine } from '../probe/probe';
import { ATLAS_LOBE_EPS_MM, atlasCapsuleLobeNormal, capsuleExteriorGain, INTERFACE_ECHO_GLSL } from '../ultrasound/interfaceEcho';

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

/** Cruces de la cápsula por las líneas del plano central: posición y las dos normales, la local de la cara y la del lóbulo. */
function capsuleCrossings(view: string) {
  const scene = new AnatomyScene({ ...CASES.find((c) => c.id === 'normal-adult')!, respiratoryPattern: 'apnea-expiratory' });
  const sp = startPointsFor(scene.torso).find((p) => p.id === view)!;
  const k = probeContact({ phi: sp.phi, z: sp.z, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 }, CONVEX_C35, scene.torso);
  const hits: Array<{ line: number; r: number; x: Vec3; local: readonly number[]; lobe: readonly number[] }> = [];
  for (let line = 0; line <= 240; line++) {
    const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * line) / 240;
    let start = -1;
    for (let r = 4; r < 180; r += 0.2) {
      const on =
        scene.classify(uncompress(pointOnLine(k.frame, CONVEX_C35, theta, r), k), BASELINE_CALIBER).interface === Interface.LiverCapsule;
      if (on && start < 0) start = r;
      if (!on && start >= 0) {
        const x = pointOnLine(k.frame, CONVEX_C35, theta, (start + r) / 2);
        const m = uncompress(x, k);
        const g = scene.faceGradient(m, BASELINE_CALIBER, 'liverSurface');
        if (g)
          hits.push({
            line,
            r: (start + r) / 2,
            x: [x[0], x[1], x[2]],
            local: g.normal,
            lobe: atlasCapsuleLobeNormal(m, (p) => scene.faceSdf(p, BASELINE_CALIBER, 'liverSurface')!, g.normal),
          });
        start = -1;
      }
    }
  }
  return hits;
}

const p95Jump = (hits: ReturnType<typeof capsuleCrossings>, normal: 'local' | 'lobe') => {
  const jumps: number[] = [];
  for (const a of hits) {
    const b = hits.find((h) => h.line === a.line + 1 && Math.abs(h.r - a.r) < 1);
    if (!b) continue;
    const ds = Math.hypot(a.x[0] - b.x[0], a.x[1] - b.x[1], a.x[2] - b.x[2]);
    const cos = Math.min(1, Math.abs(a[normal][0] * b[normal][0] + a[normal][1] * b[normal][1] + a[normal][2] * b[normal][2]));
    jumps.push((Math.acos(cos) * 180) / Math.PI / Math.max(ds, 0.05));
  }
  expect(jumps.length).toBeGreaterThan(50);
  jumps.sort((p, q) => p - q);
  return jumps[Math.floor(0.95 * (jumps.length - 1))];
};

it.each(['subxiphoid', 'intercostal', 'portal'])(
  '%s: el lóbulo de la cápsula no ve el escalón de 1,5 mm del vóxel del atlas, que la normal local sí repite (el rosario de la imagen)',
  (view) => {
    const hits = capsuleCrossings(view);
    expect(p95Jump(hits, 'local')).toBeGreaterThan(40);
    expect(p95Jump(hits, 'lobe')).toBeLessThan(15);
  },
);

it('la GPU usa ese lóbulo solo en la cápsula del atlas, con el mismo paso; el perfil sigue a la distancia local', () => {
  const glsl = INTERFACE_ECHO_GLSL.replace(/\s+/g, ' ');
  expect(glsl).toContain('if (c.iface == IF_LIVER_CAPSULE && uAbdominalAtlasEnabled != 0) {');
  expect(glsl).toContain('if (dot(v, nm) > 0.0) nm = normalize(v);');
  expect(glsl).toContain(`vec2 e = vec2(${ATLAS_LOBE_EPS_MM.toFixed(1)}, -${ATLAS_LOBE_EPS_MM.toFixed(1)});`);
  expect(glsl).toContain('float g = faceShape(c.iface, c.ifd / (fg.w * cosI)) * gain;');
  expect(glsl.indexOf('float g = faceShape')).toBeLessThan(glsl.indexOf('nm = normalize(v)'));
});

// Testigo de la revisión independiente: en este borde fino las cuatro distancias del tetraedro son iguales, y a un lado y a otro se daba la vuelta
it('en un borde fino, donde el tetraedro se cancela o se da la vuelta, el lóbulo usa la normal local', () => {
  const scene = new AnatomyScene(CASES.find((c) => c.id === 'normal-adult')!);
  const inner = (p: Vec3) => scene.faceSdf(p, BASELINE_CALIBER, 'liverSurface')!;
  for (const dx of [-1e-5, 0, 1e-5]) {
    const m: Vec3 = [82.5 + dx, 42, -27];
    expect(scene.classify(m, BASELINE_CALIBER).interface).toBe(Interface.LiverCapsule);
    const local = scene.faceGradient(m, BASELINE_CALIBER, 'liverSurface')!.normal;
    const lobe = atlasCapsuleLobeNormal(m, inner, local);
    expect(Math.hypot(lobe[0], lobe[1], lobe[2])).toBeCloseTo(1, 9);
    expect(lobe[0] * local[0] + lobe[1] * local[1] + lobe[2] * local[2]).toBeGreaterThan(0);
  }
});

it('el residuo sin segmentar no enciende la cápsula como si fuera grasa; la grasa de verdad, sí', () => {
  expect(capsuleExteriorGain(Tissue.UnsegmentedSoftTissue)).toBe(1);
  for (const t of [Tissue.RetroperitonealFat, Tissue.MesentericFat]) {
    expect(interfaceReflectivity(Interface.LiverCapsule) * capsuleExteriorGain(t)).toBeCloseTo(
      Math.abs(reflectionCoefficient(Tissue.LiverCapsule, t)),
      12,
    );
  }
});
