import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { MAX_NODES, MAX_TUBES, MAX_TUBE_SEGMENTS } from '../anatomy/gpu/anatomy.glsl';
import { tubeGridReach } from '../anatomy/gpu/tubeGrid';
import { AnatomyQuery } from '../anatomy/query';
import { Tissue } from '../anatomy/tissues';
import { CASES, NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import type { VesselId } from '../physiology/vessels';
import { setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { setAbdominalBody } from './support/legacyPerson/referenceBody';
import { AnatomyScene } from './support/legacyPerson/scene';
import { setThoracicAtlas } from './support/legacyPerson/thoracicAtlas';
import { junctionWitness } from './support/vascularJunctions';

function atlas() {
  for (const [name, set] of [
    ['abdominal', setAbdominalAtlas],
    ['thoracic', setThoracicAtlas],
  ] as const) {
    const b = gunzipSync(readFileSync(`src/anatomy/${name}-atlas.gzip.bin`));
    set(new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2));
  }
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4));
}
afterEach(() => {
  setAbdominalAtlas();
  setThoracicAtlas();
  setAbdominalBody();
});

it.each(CASES)('$id: capacidad con atlas, adicional al margen sin atlas intacto', (patient) => {
  atlas();
  const scene = new AnatomyScene(patient);
  const tubes = [...scene.vessels, ...scene.ducts].map((v) => v.tube);
  expect(scene.hasAbdominalAtlas).toBe(true);
  expect(tubes.length).toBeLessThanOrEqual(MAX_TUBES);
  expect(tubes.reduce((n, t) => n + t.nodes.length, 0)).toBeLessThanOrEqual(MAX_NODES);
  expect(Math.max(...tubes.map((t) => t.nodes.length - 1))).toBeLessThanOrEqual(MAX_TUBE_SEGMENTS);
});

for (const withAtlas of [false, true])
  it.each([NORMAL_ADULT, SEVERE_CONGESTION])(`$id: esfera, alcance y ostia todo el ciclo, atlas=${withAtlas}`, (patient) => {
    if (withAtlas) atlas();
    const scene = new AnatomyScene(patient);
    const query = new AnatomyQuery(scene);
    const engine = new PhysiologyEngine(patient, scene.vesselAreas());
    const aorta = scene.vesselById.get('aorta')!;
    const sphere = scene.tubeBounds[scene.vessels.indexOf(aorta)];
    const rMax = Math.max(...aorta.tube.nodes.map((n) => n.r));
    for (let step = 0; step < 3000; step++) {
      const s = engine.step();
      const cal = query.caliberFor(s);
      const h = [0, aorta.tube.nodes.length, 1, cal.radiusScale('aorta'), aorta.wallMm, ...Array<number>(15).fill(0)];
      const reach = tubeGridReach(new Float32Array(h), rMax);
      expect(reach).toBeGreaterThanOrEqual(rMax * s.aortaRadiusScale + aorta.wallMm);
      for (const n of aorta.tube.nodes) {
        const distance = Math.hypot(...n.p.map((v, k) => v - sphere.center[k]));
        expect(distance + n.r * s.aortaRadiusScale + aorta.wallMm).toBeLessThanOrEqual(sphere.r);
      }
      if (step % 10) continue;
      for (const id of (withAtlas
        ? ['celiacTrunk', 'sma', 'renalArteryRight', 'renalArteryLeft', 'ima', 'iliacArteryRight', 'iliacArteryLeft']
        : ['celiacTrunk', 'sma', 'renalArteryRight', 'renalArteryLeft']) as VesselId[]) {
        const witness = junctionWitness(scene.vesselById, cal, [id, 'aorta', 0]);
        expect(witness.fieldMargin, `${id} t=${s.t}`).toBeGreaterThan(1e-6);
        for (const point of witness.path) expect(scene.classify(point, cal).tissue, `${id} t=${s.t}`).toBe(Tissue.Blood);
      }
    }
  });
