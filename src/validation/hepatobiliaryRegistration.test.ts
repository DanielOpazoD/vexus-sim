import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setAbdominalAtlas, abdominalAtlasSdf } from '../anatomy/abdominalAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { tubeQuery, type Tube } from '../anatomy/primitives';
import { GALLBLADDER_WALL_MM, gallbladderSdf } from '../anatomy/organs/gallbladder';
import { wallThicknessMm } from '../anatomy/vesselTree';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';

beforeAll(() => {
  const a = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
  setAbdominalAtlas(new Uint16Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)));
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setAbdominalBody();
});

function atZ(tube: Tube, z: number): Vec3 {
  for (let i = 1; i < tube.nodes.length; i++) {
    const a = tube.nodes[i - 1].p,
      b = tube.nodes[i].p;
    if (z < Math.min(a[2], b[2]) || z > Math.max(a[2], b[2])) continue;
    const t = (z - a[2]) / (b[2] - a[2]);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), z];
  }
  throw new Error(`El eje no atraviesa z=${z}`);
}

describe('relación hepatobiliar del adulto registrado', () => {
  it('mantiene la porta posterior, la arteria anteroizquierda y el colédoco anteroderecho', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const portal = scene.vessels.find((v) => v.id === 'pvTrunk')!.tube,
      artery = scene.vessels.find((v) => v.id === 'hepaticArtery')!.tube,
      duct = scene.ducts.find((v) => v.id === 'cbd')!.tube;
    // LAS: +x es izquierda del paciente y +y anterior. Relación del
    // ligamento hepatoduodenal, no una orientación fija de la pantalla.
    for (const z of [-78, -72, -65, -60]) {
      const p = atZ(portal, z),
        a = atZ(artery, z),
        d = atZ(duct, z);
      expect(a[0], `arteria izquierda de porta, z${z}`).toBeGreaterThan(p[0]);
      expect(a[1], `arteria anterior a porta, z${z}`).toBeGreaterThan(p[1]);
      expect(d[0], `colédoco derecho de porta, z${z}`).toBeLessThan(p[0]);
      expect(d[1], `colédoco anterior a porta, z${z}`).toBeGreaterThan(p[1]);
    }
  });

  it('no superpone las luces portal, arterial y biliar en el pedículo', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const portal = scene.vessels.find((v) => v.id === 'pvTrunk')!.tube;
    const companions = [scene.vessels.find((v) => v.id === 'hepaticArtery')!.tube, scene.ducts.find((v) => v.id === 'cbd')!.tube];
    for (const tube of companions)
      for (let z = -78; z <= -60; z += 0.5) {
        const p = atZ(tube, z),
          radius = tubeQuery(p, tube).r;
        expect(tubeQuery(p, portal).d - radius, `luz separada, z${z}`).toBeGreaterThan(0);
      }
  });

  it('conecta el cístico con la luz de la vesícula fuente y con el colédoco', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const cystic = scene.ducts.find((v) => v.id === 'cysticDuct')!.tube,
      cbd = scene.ducts.find((v) => v.id === 'cbd')!.tube;
    expect(abdominalAtlasSdf(cystic.nodes[0].p, 7) + GALLBLADDER_WALL_MM).toBeLessThan(0);
    expect(tubeQuery(cystic.nodes[cystic.nodes.length - 1].p, cbd).d).toBeLessThan(0);
  });

  it('conserva separación de paredes entre los ejes hiliares que no se comunican', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const all = [...scene.vessels, ...scene.ducts];
    const pairs = [
      ['hepaticArtery', 'pvTrunk'],
      ['hepaticArtery', 'pvRight'],
      ['hepaticArtery', 'pvLeft'],
      ['hepaticArtery', 'cbd'],
      ['hepaticArtery', 'rightHepaticDuct'],
      ['hepaticArtery', 'leftHepaticDuct'],
      ['cbd', 'pvTrunk'],
      ['cbd', 'pvRight'],
      ['cbd', 'pvLeft'],
      ['commonHepaticArtery', 'pvTrunk'],
    ];
    for (const [aId, bId] of pairs) {
      const a = all.find((v) => v.id === aId),
        b = all.find((v) => v.id === bId);
      if (!a || !b) throw new Error(`Falta eje hiliar: ${aId}/${bId}`);
      for (let i = 1; i < a.tube.nodes.length; i++) {
        const start = a.tube.nodes[i - 1],
          end = a.tube.nodes[i];
        const steps = Math.ceil(Math.hypot(...start.p.map((v, j) => end.p[j] - v)) / 0.5);
        for (let n = 0; n <= steps; n++) {
          const t = n / steps;
          const p: Vec3 = [
            start.p[0] + t * (end.p[0] - start.p[0]),
            start.p[1] + t * (end.p[1] - start.p[1]),
            start.p[2] + t * (end.p[2] - start.p[2]),
          ];
          const radius = start.r + t * (end.r - start.r),
            hit = tubeQuery(p, b.tube);
          const aWall = 'wallTissue' in a ? wallThicknessMm(a, radius) : a.wallMm;
          const bWall = 'wallTissue' in b ? wallThicknessMm(b, hit.r) : b.wallMm;
          expect(hit.d - radius - aWall - bWall, `${aId}/${bId}: ${p.join(',')}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('no dibuja una pared del cístico dentro de la luz vesicular conectada', () => {
    const scene = new AnatomyScene(NORMAL_ADULT),
      cystic = scene.ducts.find((v) => v.id === 'cysticDuct')!;
    let shared = 0;
    for (let x = -41; x <= -33; x += 0.5)
      for (let y = 14; y <= 24; y += 0.5)
        for (let z = -85; z <= -76; z += 0.5) {
          const p: Vec3 = [x, y, z],
            gb = gallbladderSdf(p, scene.gallbladder),
            duct = tubeQuery(p, cystic.tube);
          if (gb >= -0.1 || duct.d < 0 || duct.d >= cystic.wallMm) continue;
          shared++;
          expect(scene.classify(p, BASELINE_CALIBER).tissue, p.join(',')).toBe(Tissue.Fluid);
        }
    expect(shared).toBeGreaterThan(5);
  });
});
