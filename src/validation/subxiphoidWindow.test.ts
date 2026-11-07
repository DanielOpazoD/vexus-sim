import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { domeFloor } from '../anatomy/organs/heart';
import { heartChamber } from '../anatomy/organs/heartChamber';
import { AnatomyQuery } from '../anatomy/query';
import { Tissue } from '../anatomy/tissues';
import { startPointsFor } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine } from '../probe/probe';
import { setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { setAbdominalBody } from './support/legacyPerson/referenceBody';
import { AnatomyScene } from './support/legacyPerson/scene';
import { fixturePerson } from './support/legacyPerson/state';
import { setThoracicAtlas } from './support/legacyPerson/thoracicAtlas';

beforeAll(() => {
  for (const [file, set] of [
    ['abdominal-atlas.gzip.bin', setAbdominalAtlas],
    ['thoracic-atlas.gzip.bin', setThoracicAtlas],
  ] as const) {
    const b = gunzipSync(readFileSync('src/anatomy/' + file));
    set(new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setAbdominalBody();
  setThoracicAtlas();
});

/**
 * Decisión 331: el eje largo subxifoideo de la VCI por defecto como imagen completa. En el plano de la pose de inicio,
 * con atlas: la AD dentro del sector y no en su borde, una suprahepática que desemboca en la VCI cerca de la unión
 * cavoauricular y la columna fuera del plano (la VCI va a la derecha de los cuerpos vertebrales; antes, una sombra
 * vertebral de bordes rectos ocupaba el campo profundo derecho). Criterios instrumentales, no normas clínicas.
 */
it('VCI en eje largo: la AD en el sector, una suprahepática que desemboca cerca de la unión y sin columna en el plano', () => {
  const patient = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
  const scene = new AnatomyScene(patient),
    query = new AnatomyQuery(scene),
    engine = new PhysiologyEngine(patient, scene.vesselAreas());
  while (engine.clock.t < 2) engine.step();
  const sample = engine.sample,
    sp = startPointsFor(scene.torso, { person: 'current' }).find((p) => p.id === 'subxiphoid')!;
  const contact = probeContact({ ...sp, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 }, CONVEX_C35, scene.torso);
  query.setProbeCompression(contact);
  // Rejilla de la auditoría de la 315: 97 líneas, 1 mm hasta 180 mm
  const LINES = 97,
    DEPTH = 180;
  const theta = (i: number) => -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / (LINES - 1);
  const grid: { tissue: Tissue; vessel: string | null; ra: boolean; world: number[] }[][] = [];
  let samples = 0,
    vertebra = 0,
    raTheta = 0,
    raCount = 0;
  for (let i = 0; i < LINES; i++) {
    const column = [];
    for (let r = 0; r < DEPTH; r++) {
      const p = pointOnLine(contact.frame, CONVEX_C35, theta(i), r + 0.5);
      const q = query.classifyWorld(p, sample);
      const ra =
        q.tissue === Tissue.Blood &&
        !q.vessel &&
        heartChamber(q.material, domeFloor(q.material, scene.diaphragm, scene.torso), fixturePerson().cpu) === 'ra';
      column.push({ tissue: q.tissue, vessel: q.vessel, ra, world: p });
      samples++;
      if (q.tissue === Tissue.Vertebra) vertebra++;
      if (ra) {
        raTheta += theta(i);
        raCount++;
      }
    }
    grid.push(column);
  }
  const tag = JSON.stringify({ vertebra, samples, raCount, raThetaDeg: ((raTheta / raCount) * 180) / Math.PI });
  // La columna fuera del plano: con la pose de la 315 los cuerpos vertebrales ocupaban el 8,7 % del sector (ahora 0,8 %)
  expect(vertebra / samples, tag).toBeLessThan(0.02);
  // La AD dentro del sector, a más de 10° de su borde (antes, su centro a 25,5° del eje, a 8,5° del borde; ahora 19,8°)
  expect(raCount, tag).toBeGreaterThan(200);
  expect(Math.abs(raTheta / raCount), tag).toBeLessThan(CONVEX_C35.halfSector - (10 * Math.PI) / 180);
  // Una suprahepática desemboca en la VCI en el plano (su luz a ≤ 3 mm de la de la VCI), a menos de 30 mm de la AD. Ya se
  // cumplía con la pose de la 315 (21,5 mm; ahora 24,5): es guarda de regresión; lo nuevo es que la unión queda dentro del sector
  const flat = grid.flat(),
    ivc = flat.filter((s) => s.vessel === 'ivcInfra' || s.vessel === 'ivcSupra'),
    ra = flat.filter((s) => s.ra);
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let nearest = Infinity;
  for (const s of flat)
    if (s.vessel?.startsWith('hv') && ivc.some((q) => dist(s.world, q.world) <= 3))
      for (const q of ra) nearest = Math.min(nearest, dist(s.world, q.world));
  expect(nearest, tag).toBeLessThan(30);
});
