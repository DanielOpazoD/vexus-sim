// @tier slow
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { installAnatomyBundle, S0028_BUNDLE as B } from '../anatomy/anatomyBundle';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { setS0028Wall } from '../anatomy/s0028Wall';
import { setS0028Solids } from '../anatomy/s0028Solids';
import { AnatomyScene } from '../anatomy/scene';
import { AnatomyQuery } from '../anatomy/query';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine, type PhysiologySample } from '../physiology/engine';
import { CONVEX_C35 } from '../probe/probe';
import { probeContact } from '../probe/contact';
import { compressionSample, rigidNode, tableAt, uncompress } from '../anatomy/compression';
import { s0028SourceValue } from '../anatomy/s0028Source';
import { startPointsFor } from '../app/startPoints';
import type { Vec3 } from '../core/vec3';

/**
 * Compresión rígida s0028 (r3) en líneas radiales de todo el sector, no en una rejilla cartesiana de ±100 mm, que no llega
 * al borde del sector en profundidad. En las diez ventanas y con D = 0/10/20 mm, ninguna vértebra ni el sacro se desplazan
 * bajo la cara interna de la pared. Con la reserva antigua (primera entrada y última salida renales de la línea), la L2
 * del flanco, entre los dos riñones, se trasladaba entera 9–11 mm. Las costillas y cartílagos bajo la cara siguen el
 * contacto P2 (P8) y sólo se mueven en intercostal y portal.
 */
const RIBS_UNDER_FACE = new Set(['intercostal', 'portal']);
const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
let scene: AnatomyScene, sample: PhysiologySample;
beforeAll(() => {
  installAnatomyBundle(B);
  setAbdominalAtlas(new Uint16Array(raw('abdominal-direct')));
  setThoracicAtlas(new Uint16Array(raw('thoracic-direct')));
  const capacity = raw('annotation-capacity');
  setS0028Wall(capacity, raw('skin-polar'));
  setS0028Solids(capacity);
  setAbdominalBody(new Float32Array(new Uint8Array(readFileSync('src/anatomy/abdominal-body.bin')).buffer));
  scene = new AnatomyScene(NORMAL_ADULT);
  sample = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas()).sample;
});

it('compresión rígida s0028: vértebras y sacro quietos en todo el sector de las diez ventanas, con D = 0/10/20 mm', () => {
  const tr = CONVEX_C35,
    query = new AnatomyQuery(scene);
  const counts: Record<string, number> = {};
  for (const pose of startPointsFor(scene.torso, B)) {
    const k = probeContact({ ...pose, rock: pose.rock ?? 0, tilt: pose.tilt ?? 0, lift: 0 }, tr, scene.torso),
      f = k.frame;
    query.setProbeCompression(k);
    for (const D of [0, 10, 20]) {
      const resp = { ...sample.resp, diaphragmCaudalMm: D };
      let axial = 0;
      for (let a = -1; a <= 1.0001; a += 1 / 32) {
        const th = a * tr.halfSector,
          dir = f.axial.map((v, j) => v * Math.cos(th) + f.lateral[j] * Math.sin(th)),
          wall = tableAt(Math.sin(th), k).v[2];
        // Igual dominio antes/después: 320 mm supera el antiguo alcance de 303 mm del flanco.
        for (let t = wall; t < 320; t += 1) {
          const p = f.curvatureCenter.map((c, j) => c + dir[j] * (tr.curvatureRadius + t)) as Vec3;
          const m = D ? query.deformation.toMaterial(p, resp) : uncompress(p, k);
          const lb = s0028SourceValue(m, 'lumbarSacralBone'),
            tb = s0028SourceValue(m, 'thoracicBone');
          const vertebra = (lb.d < -0.5 && lb.label <= 5) || (tb.d < -0.5 && tb.label >= 25 && tb.label <= 36);
          const sacrum = s0028SourceValue(m, 'sacrum').d < -0.5;
          const bone = vertebra || sacrum || lb.d < -0.5 || tb.d < -0.5 || s0028SourceValue(m, 'cartilage').d < -0.5;
          if (!bone) continue;
          const shift = -compressionSample(p, k).shift,
            tag = `${pose.id} D${D} a=${a.toFixed(3)} t=${t.toFixed(1)}`;
          if (vertebra || sacrum) {
            axial++;
            expect(shift, `${tag} vértebra o sacro`).toBeLessThanOrEqual(0.05);
          } else {
            // P8 preexistente: costillas/cartílagos de estas dos ventanas acompañan la pared (≤ 19,4 mm en main).
            expect(shift, `${tag} costilla o cartílago`).toBeLessThanOrEqual(RIBS_UNDER_FACE.has(pose.id) ? 20 : 0.05);
          }
        }
      }
      counts[`${pose.id} D${D}`] = axial;
    }
  }
  // Con dientes: la columna está en el sector de seis ventanas; en el flanco, en su borde profundo, entre los dos riñones.
  for (const id of ['subxiphoid', 'epigastric', 'subcostal', 'flank', 'portalTrunk', 'hepatorenal'])
    for (const D of [0, 10, 20]) expect(counts[`${id} D${D}`], `${id} D${D}`).toBeGreaterThan(id === 'flank' ? 50 : 10);
});

it('reserva rígida: limita L a la salida del tramo renal que cruza Z, sin incluir otro riñón posterior', () => {
  // D + S = 90 mm. Sólo [70, 100] cruza Z; [150, 170] no prolonga la reserva.
  const alone = rigidNode([-20, -10, 30], [], [70, 100]);
  expect(alone[0]).toBe(1);
  expect(alone[2]).toBe(30);
  expect(rigidNode([-20, -10, 30], [], [70, 100, 150, 170])).toEqual(alone);
  // Un hueso entre ambos tramos no está dentro del riñón: conserva el anclaje en 90 mm.
  const anchored = rigidNode([-20, -10, 30], [90], [50, 65]);
  expect(anchored[0]).toBeGreaterThan(1);
  expect(rigidNode([-20, -10, 30], [90], [50, 65, 150, 170])).toEqual(anchored);
});
