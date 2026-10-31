import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { kidneyLocal } from '../anatomy/organs/kidney';
import { uncompress } from '../anatomy/compression';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Tissue, TISSUES } from '../anatomy/tissues';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { startPointsFor } from '../app/startPoints';
import { CASES } from '../cases';
import { contactCoupling, probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine } from '../probe/probe';

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

it('hepatorrenal del atlas: todo el sector en contacto, riñón en eje largo sin bloqueo y el hígado delante (decisión 300)', () => {
  const scene = new AnatomyScene({ ...CASES.find((c) => c.id === 'normal-adult')!, respiratoryPattern: 'apnea-expiratory' });
  const sp = startPointsFor(scene.torso).find((p) => p.id === 'hepatorenal')!;
  const k = probeContact({ phi: sp.phi, z: sp.z, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 }, CONVEX_C35, scene.torso);
  const lines = 65;
  const dr = 1.5;
  const hs = CONVEX_C35.halfSector;
  const cm2 = (dr * (CONVEX_C35.curvatureRadius + 90) * ((2 * hs) / (lines - 1))) / 100;
  const renal = new Set<Tissue>([Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.RenalCapsule]);
  let coupled = 0;
  let kidney = 0;
  let blockedKidney = 0;
  let sinus = 0;
  let liver = 0;
  let uMin = Infinity;
  let uMax = -Infinity;
  for (let l = 0; l < lines; l++) {
    const theta = -hs + (2 * hs * l) / (lines - 1);
    const coupling = contactCoupling(k, theta);
    if (coupling >= 0.9) coupled++;
    let blocked = coupling < 0.9;
    let entered = false;
    for (let r = 1; r < 160; r += dr) {
      const m = uncompress(pointOnLine(k.frame, CONVEX_C35, theta, r), k);
      const c = scene.classify(m, BASELINE_CALIBER);
      if (c.tissue !== Tissue.Air) entered = true;
      if (entered && (TISSUES[c.tissue].bone || TISSUES[c.tissue].gas)) blocked = true;
      if (renal.has(c.tissue)) {
        kidney++;
        if (blocked) {
          blockedKidney++;
          continue;
        }
        const u = kidneyLocal(m, scene.kidneyRight)[0];
        uMin = Math.min(uMin, u);
        uMax = Math.max(uMax, u);
        if (c.tissue === Tissue.RenalSinus) sinus++;
      } else if (!blocked && c.tissue === Tissue.Liver) liver++;
    }
  }
  // Antes: 0,89 de contacto, 78 mm de riñón, 21 % tras bloqueo y 18 cm² de hígado.
  expect(coupled / lines).toBeGreaterThan(0.97);
  expect(uMax - uMin).toBeGreaterThan(85);
  expect(blockedKidney / kidney).toBeLessThan(0.12);
  expect(sinus * cm2).toBeGreaterThan(5);
  expect(liver * cm2).toBeGreaterThan(35);
});
