import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { uncompress } from '../anatomy/compression';
import { wallArc, wallDepths } from '../anatomy/organs/wall';
import { torsoDepth } from '../anatomy/primitives';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene } from '../anatomy/scene';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { startPointsFor } from '../app/startPoints';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { contactCoupling, probeContact } from '../probe/contact';
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

for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION])
  it(`${patient.id}: la fascia no se repliega sobre grasa subcutánea al deslizar bajo el borde hepático`, () => {
    const scene = new AnatomyScene(patient);
    const sp = startPointsFor(scene.torso).find((p) => p.id === 'subcostal')!;
    let rays = 0;
    const folds: unknown[] = [];
    // Deslizamiento caudal que reprodujo tres segmentos musculares superficiales
    // en un mismo rayo, y posiciones vecinas. Sin reclasificar huesos ni vasos:
    // se examinan las superficies de la pared antes de la oclusión anatómica.
    for (const dz of [-20, -17.5, -15, -12.5, -10]) {
      const contact = probeContact({ ...sp, z: sp.z + dz, lift: 0, tilt: sp.tilt ?? 0, rock: sp.rock ?? 0 }, CONVEX_C35, scene.torso);
      for (let deg = -24; deg <= 24; deg += 0.5) {
        const theta = (deg * Math.PI) / 180;
        if (contactCoupling(contact, theta) < 0.5) continue;
        let entered = false;
        for (let r = 0; r <= contact.plateMm + 5; r += 0.125) {
          const m = uncompress(pointOnLine(contact.frame, CONVEX_C35, theta, r), contact);
          const d = -torsoDepth(m, scene.torso);
          const w = wallDepths(scene.torso, wallArc(m, scene.torso), m[2]);
          if (d >= w.transversalis) break;
          if (d >= w.fascia) entered = true;
          // La tolerancia subvoxel distingue una tangencia de una rotura;
          // el defecto reproducido retrocede ~0,2 mm a través de la fascia.
          if (entered && d < w.fascia - 0.05) {
            folds.push({ dz, deg, r, retreatMm: w.fascia - d });
            break;
          }
        }
        if (entered) rays++;
      }
    }
    expect(rays).toBeGreaterThan(250);
    expect(folds).toEqual([]);
  });
