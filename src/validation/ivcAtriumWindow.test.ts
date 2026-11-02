// @tier slow
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setThoracicAtlas, thoracicValue } from '../anatomy/thoracicAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { domeFloor, heartChambers, heartOuterSdf } from '../anatomy/organs/heart';
import { buildHeartMesh } from '../ui/navigator3d/organs';
import { CM, disposeObject } from '../ui/navigator3d/common';
import { heartChamber } from '../anatomy/organs/heartChamber';
import { Tissue } from '../anatomy/tissues';
import { SampleVolumeIQ } from '../doppler/sampleVolume';
import { AnatomyQuery } from '../anatomy/query';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { startPointsFor } from '../app/startPoints';
import { atriumWindow, summarizeAtriumRays } from './support/ivcAtriumWindow';

beforeAll(() => {
  for (const [name, setter] of [
    ['abdominal', setAbdominalAtlas],
    ['thoracic', setThoracicAtlas],
  ] as const) {
    const raw = gunzipSync(readFileSync(`src/anatomy/${name}-atlas.gzip.bin`));
    setter(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2));
  }
  const body = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setThoracicAtlas();
  setAbdominalBody();
});

for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION])
  it(`${patient.id}: AD amplia a través del hígado, sin pulmón/gas anterior, en centro y vecinos`, () => {
    const p = { ...patient, respiratoryPattern: 'apnea-expiratory' as const };
    const scene = new AnatomyScene(p);
    const query = new AnatomyQuery(scene),
      engine = new PhysiologyEngine(p, scene.vesselAreas());
    while (engine.clock.t < 2) engine.step();
    const caliber = query.caliberFor(engine.sample);
    const sp = startPointsFor(scene.torso).find((p) => p.id === 'subxiphoid')!;
    for (const [rock, tilt] of [
      [0, 0],
      [0.035, 0],
      [-0.035, 0],
      [0, 0.035],
      [0, -0.035],
    ]) {
      const report = atriumWindow(scene, caliber, { ...sp, rock: (sp.rock ?? 0) + rock, tilt: (sp.tilt ?? 0) + tilt, lift: 0 });
      const tag = JSON.stringify({ patient: patient.id, rock, tilt, longestRun: report.longestRun, widthMm: report.widthMm });
      expect(report.longestRun, tag).toBeGreaterThanOrEqual(5);
      expect(report.widthMm, tag).toBeGreaterThanOrEqual(20);
    }
  });

it('rechaza AD marginal por pocos rayos o poca anchura aunque haya sangre auricular', () => {
  const marginal = Array.from({ length: 97 }, (_, line) => ({ line, clear: line > 94, lateral: [line, line + 0.5] }));
  expect(summarizeAtriumRays(marginal).accepted).toBe(false);
  // Dos rayos anchos siguen siendo marginales; diez rayos de una franja de 1 mm tampoco bastan.
  expect(summarizeAtriumRays(marginal.map((r) => ({ ...r, lateral: [0, 30] }))).accepted).toBe(false);
  const narrow = marginal.map((r) => ({ ...r, clear: r.line >= 40 && r.line < 50, lateral: [0, 1] }));
  expect(summarizeAtriumRays(narrow).accepted).toBe(false);
  expect(summarizeAtriumRays(marginal.map((r) => ({ ...r, clear: false }))).accepted).toBe(false);
});

for (const blocker of [Tissue.Lung, Tissue.BowelGas])
  it(`rechaza ${Tissue[blocker]} anterior con atlas aunque conserva hígado y cuerda AD`, () => {
    const p = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
    const scene = new AnatomyScene(p);
    const query = new AnatomyQuery(scene),
      engine = new PhysiologyEngine(p, scene.vesselAreas());
    while (engine.clock.t < 2) engine.step();
    const caliber = query.caliberFor(engine.sample);
    const sp = startPointsFor(scene.torso).find((p) => p.id === 'subxiphoid')!;
    const classify = scene.classify.bind(scene);
    // Contrafactual sintético: sólo la piel anterior pasa a pulmón/gas. La geometría cargada,
    // el hígado, la barrera y la AD siguen presentes; se prueba el obstáculo real del clasificador.
    const spy = vi.spyOn(scene, 'classify').mockImplementation((m, c) => {
      const q = classify(m, c);
      return q.tissue === Tissue.Skin ? { ...q, tissue: blocker } : q;
    });
    try {
      const report = atriumWindow(scene, caliber, { ...sp, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 });
      expect(report.rays.some((r) => r.liverMm >= 10 && r.atriumMm >= 8 && r.barrier)).toBe(true);
      expect(report.rays.filter((r) => r.blocker === blocker).length).toBeGreaterThanOrEqual(5);
      expect(report.longestRun).toBe(0);
      expect(report.widthMm).toBe(0);
      expect(report.accepted).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

it('conserva capacidad, raíces suprahepáticas y luz sin pared en el eje cavoauricular', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  expect(scene.vessels.length + scene.ducts.length).toBe(128);
  expect([...scene.vessels, ...scene.ducts].reduce((n, v) => n + v.tube.nodes.length, 0)).toBe(367);
  const infra = scene.vesselById.get('ivcInfra')!.tube,
    supra = scene.vesselById.get('ivcSupra')!.tube;
  expect(infra.nodes).toHaveLength(9);
  expect(supra.nodes).toHaveLength(5);
  expect(infra.nodes.at(-1)!.p).toEqual(supra.nodes[0].p);
  for (const [id, anchor] of [
    ['hvRight', [-15.1, -5.7, -14]],
    ['hvCommonTrunk', [-15.1, -5.7, -3]],
  ] as const) {
    expect(scene.vesselById.get(id)!.tube.nodes.at(-1)!.p).toEqual(anchor);
  }
  for (const tube of [infra, supra])
    for (let j = 0; j < tube.nodes.length - 1; j++) {
      const a = tube.nodes[j].p,
        b = tube.nodes[j + 1].p;
      const n = Math.ceil(Math.hypot(...b.map((x, k) => x - a[k])) / 0.5);
      for (let k = 0; k <= n; k++) {
        const p: [number, number, number] = [0, 1, 2].map((i) => a[i] + ((b[i] - a[i]) * k) / n) as [number, number, number];
        expect(scene.classify(p, BASELINE_CALIBER, false).tissue, p.join(',')).toBe(Tissue.Blood);
      }
    }
});

it('conserva las cuatro cavidades adultas y sus vecinos sin cortinas dentro de su luz', () => {
  const scene = new AnatomyScene(NORMAL_ADULT),
    volumes = [0, 0, 0, 0],
    collisions = [];
  for (let x = -55.37; x < 90; x += 3)
    for (let y = -30.23; y < 90; y += 3)
      for (let z = -45.41; z < 110; z += 3) {
        const p: [number, number, number] = [x, y, z],
          floor = domeFloor(p, scene.diaphragm, scene.torso),
          c = heartChambers(p);
        const q = scene.classify(p, BASELINE_CALIBER);
        const ch = heartChamber(p, floor);
        if (ch && q.tissue === Tissue.Blood && !q.vessel) volumes[['lv', 'rv', 'ra', 'la'].indexOf(ch)] += 27 / 1000;
        // A >4 mm inside, >12 mm above the bounded cardiac floor, any
        // non-blood tissue is a real collision or a curtain, not rounding.
        if (Math.min(...c) < -4 && floor < -12 && q.tissue !== Tissue.Blood) collisions.push({ p, tissue: q.tissue });
      }
  // Mismos mínimos adultos del contrato 85; no se reduce el VI al bajarlo.
  expect(volumes[0]).toBeGreaterThan(45);
  expect(volumes[1]).toBeGreaterThan(30);
  expect(volumes[2]).toBeGreaterThan(25);
  expect(volumes[3]).toBeGreaterThan(25);
  expect(collisions.slice(0, 10)).toEqual([]);
});

it('no aumenta la intersección VD–esternón de la base, también a menos de 4 mm de profundidad', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  let intersections = 0,
    interior = 0;
  // Rejilla congelada de R1: la base 7d7776c tiene 4 muestras tangenciales
  // (0,0005 mL). Incluir toda la cavidad evita el punto ciego del control >4 mm.
  for (let x = 0; x <= 35; x += 0.5)
    for (let y = 60; y <= 85; y += 0.5)
      for (let z = 15; z <= 50; z += 0.5) {
        const p: [number, number, number] = [x, y, z],
          rv = Math.max(heartChambers(p)[1], domeFloor(p, scene.diaphragm, scene.torso) + 5.5),
          bone = thoracicValue(p);
        if (rv < 0 && bone.d < 0 && bone.label === 14) {
          intersections++;
          if (rv < -1 && bone.d < -0.5) interior++;
        }
      }
  expect(interior).toBe(0);
  expect(intersections).toBeLessThanOrEqual(4);
  const witness: [number, number, number] = [17.5, 73.5, 36.5];
  expect(Math.max(heartChambers(witness)[1], domeFloor(witness, scene.diaphragm, scene.torso) + 5.5)).toBeGreaterThanOrEqual(0);
});

it('el corazón del navegador incluye el polo inferior del SDF y no tiene bordes cortados', () => {
  const scene = new AnatomyScene(NORMAL_ADULT),
    mesh = buildHeartMesh(scene);
  try {
    // Referencia independiente de la caja de extracción: buscar tejido real bajo z=10.
    let inferior = Infinity;
    for (let x = 20; x <= 85; x++)
      for (let y = -10; y <= 95; y++)
        for (let z = -15; z <= 10; z++) {
          const p: [number, number, number] = [x, y, z];
          if (heartOuterSdf(p, domeFloor(p, scene.diaphragm, scene.torso)) < 0) inferior = Math.min(inferior, z);
        }
    expect(Number.isFinite(inferior)).toBe(true);
    const vertices = mesh.geometry.getAttribute('position'),
      edges = new Map<string, number>();
    let minZ = Infinity;
    for (let i = 0; i < vertices.count; i += 3) {
      const triangle: string[] = [];
      for (let j = 0; j < 3; j++) {
        minZ = Math.min(minZ, (vertices.getZ(i + j) * mesh.scale.z + mesh.position.z) / CM);
        triangle.push([vertices.getX(i + j), vertices.getY(i + j), vertices.getZ(i + j)].map((v) => v.toFixed(5)).join(','));
      }
      for (let j = 0; j < 3; j++) {
        const key = [triangle[j], triangle[(j + 1) % 3]].sort().join('|');
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    // Un voxel de la malla original (130/44 mm), sin aumentar resolución/tolerancia.
    expect(minZ).toBeLessThanOrEqual(inferior + 130 / 44);
    expect([...edges.values()].filter((n) => n === 1)).toHaveLength(0);
  } finally {
    disposeObject(mesh);
  }
});

it('puertas materiales fijas de cava alta y suprahepáticas conservan identidad y caudal/área', () => {
  for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION]) {
    const scene = new AnatomyScene(patient),
      query = new AnatomyQuery(scene),
      engine = new PhysiologyEngine(patient, scene.vesselAreas());
    while (engine.clock.t < 2) engine.step();
    // Puntos elegidos dentro de tramos, alejados de ostios y de la pared: el
    // gate no se recoloca entre los dos estados fisiológicos.
    for (const [id, p] of [
      ['ivcSupra', [-21, 19, 32.5]],
      ['hvRight', [-47.5, -16.80375, -18.1658]],
      ['hvMiddle', [-27.5, 24, -37.5]],
    ] as const) {
      const q = query.classifyMaterial([...p], engine.sample);
      expect(q.tissue, `${patient.id}/${id}`).toBe(Tissue.Blood);
      expect(q.vessel, `${patient.id}/${id}`).toBe(id);
      expect(q.bloodVelocity?.every(Number.isFinite)).toBe(true);
      const volume = new SampleVolumeIQ(query, 43);
      volume.setGate(
        {
          center: query.deformation.toWorld([...p], engine.sample.resp),
          beamDir: [0, 0, 1],
          lateral: [1, 0, 0],
          elevation: [0, 1, 0],
          lengthMm: 1,
          pulseSigmaMm: 0.2,
          lateralSigmaMm: 0.2,
          elevationSigmaMm: 0.2,
          // Aísla identidad/población. La transmisión real se exige aparte en abdominalAcquisition.
          transmission: 1,
        },
        engine.sample,
      );
      expect(volume.lastComposition.bloodFraction).toBeGreaterThan(0.9);
      expect(Object.keys(volume.lastComposition.vessels)).toContain(id);
    }
    const cal = query.caliberFor(engine.sample),
      v = scene.vesselById.get('ivcSupra')!;
    const area = Math.PI * (v.refRadius * cal.radiusScale(v.id)) ** 2 * (cal.ivcSupraApScale ?? cal.ivcApScale);
    expect((engine.sample.velocities.ivcSupra * area) / 1000).toBeCloseTo(engine.sample.qIvcToRa + engine.sample.qHepaticVein, 9);
  }
});
