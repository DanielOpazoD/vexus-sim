// @tier slow
import { describe, expect, it } from 'vitest';
import { tubeQuery, type Tube } from '../anatomy/primitives';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import type { VesselDef } from '../anatomy/vesselTree';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { SampleVolumeIQ, type GateGeometry } from '../doppler/sampleVolume';
import { PhysiologyEngine, type PhysiologySample } from '../physiology/engine';

/** Lo que estas pruebas leen de la población (decisión 294). */
interface Particle {
  m: Vec3;
  g: Vec3;
  isBlood: boolean;
  imp: number;
  vessel: string | null;
}
interface Internals {
  scatterers: Particle[];
  halfAxial: number;
  halfLateral: number;
  halfElev: number;
  weightAt(g: Vec3): number;
}

/**
 * Tubo recto cilíndrico sintético (sin afilamiento, forma orgánica ni uniones) a lo largo de una dirección oblicua a la
 * puerta, con una deformación rígida lateral: el caso mínimo de flujo y respiración a la vez.
 */
function straightTube() {
  const raw: Vec3 = [0.79, 0.18, 0.58];
  const n = Math.hypot(...raw);
  const e: Vec3 = [raw[0] / n, raw[1] / n, raw[2] / n];
  const R = 5,
    L = 60;
  const tube: Tube = {
    kind: 'tube',
    nodes: [
      { p: [-e[0] * L, -e[1] * L, -e[2] * L], r: R },
      { p: [e[0] * L, e[1] * L, e[2] * L], r: R },
    ],
    apScale: 1,
  };
  const def = { id: 'hvRight', tube, profileN: 2, flowFactor: 1 } as unknown as VesselDef;
  const velocities = { hvRight: 97.6 };
  const shift = (r: { diaphragmCaudalMm: number }): Vec3 => [r.diaphragmCaudalMm, 0, 0];
  const anatomy = {
    deformation: {
      compression: null,
      displacement: (_m: Vec3, r: { diaphragmCaudalMm: number }) => shift(r),
      toWorld: (m: Vec3, r: { diaphragmCaudalMm: number }) => [m[0] + shift(r)[0], m[1], m[2]],
      toMaterial: (w: Vec3, r: { diaphragmCaudalMm: number }) => [w[0] - shift(r)[0], w[1], w[2]],
      tissueVelocity: (_m: Vec3, r: { diaphragmVelocityMmS: number }) => [r.diaphragmVelocityMmS, 0, 0],
    },
    scene: {
      vessels: [def],
      ducts: [],
      tubeBounds: [{ center: [0, 0, 0], r: L + R }],
      vesselById: new Map([['hvRight', def]]),
      vesselTubeAt: (m: Vec3) => ({ def, hit: tubeQuery(m, tube, 1) }),
    },
    caliberFor: () => ({ radiusScale: () => 1, ivcApScale: 1 }),
    classifyMaterial: (m: Vec3) => {
      const hit = tubeQuery(m, tube, 1);
      if (hit.d >= 0)
        return { tissue: Tissue.Liver, vessel: null, material: m, bloodVelocity: null, flowBasis: null, tissueVelocity: [0, 0, 0] };
      const k = 2 * (1 - Math.min(1, hit.rho) ** 2);
      const flowBasis: Vec3 = [hit.tangent[0] * k, hit.tangent[1] * k, hit.tangent[2] * k];
      return {
        tissue: Tissue.Blood,
        vessel: 'hvRight',
        vesselHit: hit,
        flowFactor: 1,
        material: m,
        bloodVelocity: flowBasis.map((x) => x * velocities.hvRight),
        flowBasis,
        tissueVelocity: [0, 0, 0],
      };
    },
  } as unknown as AnatomyQuery;
  const at = (D: number, v: number) =>
    ({
      resp: { diaphragmCaudalMm: D, diaphragmVelocityMmS: v },
      velocities,
      hvRadiusScale: 1,
      pvRadiusScale: 1,
    }) as unknown as PhysiologySample;
  return { anatomy, at };
}

/**
 * Unión sintética con la geometría de la bifurcación portal (el tronco y una rama que gira 115°, con la luz solapada) y una
 * deformación rígida casi a lo largo del tronco: la sangre del tronco sale por el reparto con la rama, dentro de la caja.
 */
function junctionTube() {
  const defOf = (id: string, nodes: Tube['nodes']) =>
    ({ id, tube: { kind: 'tube', nodes, apScale: 1 } as Tube, profileN: 4, flowFactor: 1, wallMm: 0.5 }) as unknown as VesselDef;
  const trunk = defOf('pvTrunk', [
    { p: [-3, 6, -100], r: 5.5 },
    { p: [-26, 2, -56], r: 5.5 },
    { p: [-34, 0, -45], r: 5.5 },
  ]);
  const branch = defOf('pvLeft', [
    { p: [-34, 0, -45], r: 3.8 },
    { p: [8, 30, -38], r: 3.4 },
  ]);
  const defs = [trunk, branch];
  const velocities = { pvTrunk: 200, pvLeft: 200 };
  const find = (m: Vec3) => {
    const hits = defs.map((def) => ({ def, hit: tubeQuery(m, def.tube, 1) }));
    return hits[0].hit.d <= hits[1].hit.d ? hits[0] : hits[1];
  };
  const axis: Vec3 = [0, 0.14834, -0.98894];
  const anatomy = {
    deformation: {
      compression: null,
      displacement: (_m: Vec3, r: { diaphragmCaudalMm: number }) => axis.map((x) => x * r.diaphragmCaudalMm),
      toWorld: (m: Vec3, r: { diaphragmCaudalMm: number }) => m.map((x, i) => x + axis[i] * r.diaphragmCaudalMm),
      toMaterial: (w: Vec3, r: { diaphragmCaudalMm: number }) => w.map((x, i) => x - axis[i] * r.diaphragmCaudalMm),
      tissueVelocity: (_m: Vec3, r: { diaphragmVelocityMmS: number }) => axis.map((x) => x * r.diaphragmVelocityMmS),
    },
    scene: {
      vessels: defs,
      ducts: [],
      tubeBounds: defs.map(() => ({ center: [0, 0, 0], r: 300 })),
      vesselById: new Map(defs.map((d) => [d.id, d])),
      vesselTubeAt: find,
    },
    caliberFor: () => ({ radiusScale: () => 1, ivcApScale: 1 }),
    classifyMaterial: (m: Vec3) => {
      const { def, hit } = find(m);
      if (hit.d >= 0)
        return { tissue: Tissue.Liver, vessel: null, material: m, bloodVelocity: null, flowBasis: null, tissueVelocity: [0, 0, 0] };
      const k = 1.5 * (1 - Math.min(1, hit.rho) ** 4);
      const flowBasis: Vec3 = [hit.tangent[0] * k, hit.tangent[1] * k, hit.tangent[2] * k];
      return {
        tissue: Tissue.Blood,
        vessel: def.id,
        vesselHit: hit,
        flowFactor: 1,
        material: m,
        bloodVelocity: flowBasis.map((x) => x * 200),
        flowBasis,
        tissueVelocity: [0, 0, 0],
      };
    },
  } as unknown as AnatomyQuery;
  const at = (D: number, v: number) =>
    ({
      resp: { diaphragmCaudalMm: D, diaphragmVelocityMmS: v },
      velocities,
      hvRadiusScale: 1,
      pvRadiusScale: 1,
    }) as unknown as PhysiologySample;
  return { anatomy, at };
}

/** Censo directo: peso sanguíneo, peso total y número de dispersores de tejido. */
function census(volume: SampleVolumeIQ) {
  const internals = volume as unknown as Internals;
  let blood = 0;
  let all = 0;
  let tissue = 0;
  for (const s of internals.scatterers) {
    const w = internals.weightAt(s.g) * s.imp;
    all += w;
    if (s.isBlood) blood += w;
    else tissue++;
  }
  return { fraction: blood / all, tissue: tissue / internals.scatterers.length };
}

/**
 * Dos tubos rectos cruzados con la sangre quieta o con flujo solo en `hvRight`, sin movimiento, forma ni afilamiento: lo único
 * que decide el reparto entre ellos es su geometría del instante (`scale` de `hvRight`, semieje AP de `ivcInfra`).
 */
function crossedTubes(other: { id: string; tube: Tube }, velocities: Record<string, number>, sample: { scale: number }) {
  const tubes = [
    { id: 'hvRight', tube: { kind: 'tube', nodes: [{ p: [0, -30, 0], r: 2 }, { p: [0, 30, 0], r: 2 }], apScale: 1 } as Tube },
    other,
  ];
  const defs = tubes.map((t) => ({ ...t, profileN: 2, flowFactor: 1, wallMm: 0.1 }) as unknown as VesselDef);
  const scaleOf = (id: string) => (id === 'hvRight' ? sample.scale : 1);
  const find = (m: Vec3) => {
    const hits = defs.map((def) => ({ def, hit: tubeQuery(m, def.tube, scaleOf(def.id)) }));
    return hits[0].hit.d <= hits[1].hit.d ? hits[0] : hits[1];
  };
  const anatomy = {
    deformation: {
      compression: null,
      displacement: () => [0, 0, 0],
      toWorld: (m: Vec3) => m,
      toMaterial: (w: Vec3) => w,
      tissueVelocity: () => [0, 0, 0],
    },
    scene: {
      vessels: defs,
      ducts: [],
      tubeBounds: defs.map(() => ({ center: [0, 0, 0], r: 100 })),
      vesselById: new Map(defs.map((d) => [d.id, d])),
      vesselTubeAt: find,
    },
    caliberFor: () => ({ radiusScale: scaleOf, ivcApScale: other.tube.apScale }),
    classifyMaterial: (m: Vec3) => {
      const { def, hit } = find(m);
      if (hit.d >= 0)
        return { tissue: Tissue.Liver, vessel: null, material: m, bloodVelocity: null, flowBasis: null, tissueVelocity: [0, 0, 0] };
      const k = 2 * (1 - Math.min(1, hit.rho) ** 2);
      const flowBasis: Vec3 = [hit.tangent[0] * k, hit.tangent[1] * k, hit.tangent[2] * k];
      return {
        tissue: Tissue.Blood,
        vessel: def.id,
        vesselHit: hit,
        flowFactor: 1,
        material: m,
        bloodVelocity: flowBasis.map((x) => x * velocities[def.id]),
        flowBasis,
        tissueVelocity: [0, 0, 0],
      };
    },
  } as unknown as AnatomyQuery;
  const phys = () =>
    ({
      resp: { diaphragmCaudalMm: 0, diaphragmVelocityMmS: 0 },
      velocities,
      hvRadiusScale: sample.scale,
      pvRadiusScale: 1,
    }) as unknown as PhysiologySample;
  return { anatomy, phys, find };
}

/** Peso de sangre por dispersor (Σ w_sangre / N), el de `pwPopulation.test.ts`. */
function bloodWeight(volume: SampleVolumeIQ): number {
  const internals = volume as unknown as Internals;
  let blood = 0;
  for (const s of internals.scatterers) if (s.isBlood) blood += internals.weightAt(s.g) * s.imp;
  return blood / internals.scatterers.length;
}

describe('población PW con flujo y movimiento a la vez (decisión 294)', () => {
  it('en un tubo recto, la respiración con flujo no acumula la población junto a una cara', () => {
    // Revisión r3 y su diagnóstico: con flujo y movimiento rígido a la vez, la reentrada por la corriente colocaba la sangre
    // con un sesgo de ~1 µm hacia dentro, mayor que el desplazamiento respiratorio de un pulso, y esa sangre no salía después
    // por movimiento cuando le tocaba. La densidad por franja de la caja iba de 0,43 a 1,59 de la uniforme tras dos ciclos
    // de ±0,5 mm (desviación máxima 0,59 con tres semillas); el esquema ideal de los dos mapas periódicos la conserva.
    const { anatomy, at } = straightTube();
    const gate: GateGeometry = {
      center: [0, 0, 0],
      beamDir: [0, 0, 1],
      lateral: [1, 0, 0],
      elevation: [0, 1, 0],
      lengthMm: 1,
      pulseSigmaMm: 0.2,
      lateralSigmaMm: 0.3,
      elevationSigmaMm: 0.3,
      transmission: 1,
    };
    const bands = 5;
    const density = [0, 1, 2].map(() => new Array<number>(bands).fill(0));
    let samples = 0;
    const calls = 500; // 2 s por ciclo, llamadas de 10 pulsos a 2,5 kHz
    const dt = 10 / 2500;
    const w = (2 * Math.PI) / (calls * dt);
    for (const seed of [47, 48, 49]) {
      const volume = new SampleVolumeIQ(anatomy, seed);
      volume.setGate(gate, at(0, 0));
      const internals = volume as unknown as Internals;
      const half = [internals.halfAxial, internals.halfLateral, internals.halfElev];
      const re = new Float32Array(16),
        im = new Float32Array(16);
      for (let k = 1; k <= 3 * calls; k++) {
        volume.generate(at(0.5 * Math.sin(w * k * dt), 0.5 * w * Math.cos(w * k * dt)), [0, 0, 0], 10, re, im);
        if (k <= calls || k % (calls / 2) !== 0) continue;
        samples++;
        for (const s of internals.scatterers)
          for (let a = 0; a < 3; a++)
            density[a][Math.min(bands - 1, Math.max(0, Math.floor(((s.g[a] / half[a] + 1) / 2) * bands)))] +=
              bands / internals.scatterers.length;
      }
    }
    const worst = Math.max(...density.flat().map((x) => Math.abs(x / samples - 1)));
    expect(worst).toBeLessThan(0.25);
  });

  it('la sangre que sale por el reparto de una unión no vacía la caja al respirar', () => {
    // Sin esto, la porta del sano respirando quedaba en ≈ 0,89 del peso de una siembra nueva. La salida del dominio se atendía
    // después del paso de movimiento: la franja junto a la cara de entrada estaba vacía cuando esa cara avanzaba, así que el
    // movimiento no sacaba a nadie por ella, pero en la fase contraria seguía entrando sangre por esa cara. Aquí daba 0,92.
    const { anatomy, at } = junctionTube();
    const gate: GateGeometry = {
      center: [-30.4, 3.5, -47],
      beamDir: [0.96, 0.28, 0.01],
      lateral: [-0.0487, 0.1324, 0.9900],
      elevation: [0.2758, -0.9509, 0.1394],
      lengthMm: 4,
      pulseSigmaMm: 0.5,
      lateralSigmaMm: 1.11,
      elevationSigmaMm: 1.88,
      transmission: 1,
    };
    const bands = 5;
    const dt = 10 / 2500;
    const w = (2 * Math.PI) / 4;
    const density = [0, 1, 2].map(() => new Array<number>(bands).fill(0));
    let transported = 0;
    let fresh = 0;
    let samples = 0;
    const re = new Float32Array(16),
      im = new Float32Array(16);
    for (const seed of [47, 48, 49]) {
      const volume = new SampleVolumeIQ(anatomy, seed);
      volume.setGate(gate, at(0, 0));
      const internals = volume as unknown as Internals;
      const half = [internals.halfAxial, internals.halfLateral, internals.halfElev];
      for (let k = 1; k <= Math.round(8 / dt); k++) {
        const now = k * dt;
        const phys = at(5 * Math.sin(w * now), 5 * w * Math.cos(w * now));
        volume.generate(phys, [0, 0, 0], 10, re, im);
        if (now < 4 || k % 125 !== 0) continue;
        samples++;
        transported += bloodWeight(volume);
        const seeded = new SampleVolumeIQ(anatomy, 900 + k);
        seeded.setGate(gate, phys);
        fresh += bloodWeight(seeded);
        for (const s of internals.scatterers)
          for (let a = 0; a < 3; a++)
            density[a][Math.min(bands - 1, Math.max(0, Math.floor(((s.g[a] / half[a] + 1) / 2) * bands)))] +=
              bands / internals.scatterers.length;
      }
    }
    expect(transported / fresh).toBeGreaterThan(0.95);
    expect(Math.max(...density.flat().map((x) => Math.abs(x / samples - 1)))).toBeLessThan(0.15);
  });

  it('el reparto de una unión que cambia con el calibre no mueve la sangre: cambia su identidad', () => {
    // Revisión r4: la salida del dominio se trataba siempre como salida por flujo. Sin flujo, al crecer `hvRight` dentro de la
    // luz de la porta, 60–63 de 320 partículas saltaban aguas arriba por su corriente y el peso quedaba en 0,64–0,70 de una
    // siembra nueva (cuatro semillas), con solo un 1 % de la sangre en `hvRight` frente al 33 % esperado.
    const sample = { scale: 0.75 };
    const portal = { id: 'pvTrunk', tube: { kind: 'tube', nodes: [{ p: [-30, 0, 0], r: 5 }, { p: [30, 0, 0], r: 5 }], apScale: 1 } as Tube };
    const { anatomy, phys } = crossedTubes(portal, { pvTrunk: 0, hvRight: 0 }, sample);
    const gate: GateGeometry = {
      center: [0, 3, 0],
      beamDir: [1, 0, 0],
      lateral: [0, 1, 0],
      elevation: [0, 0, 1],
      lengthMm: 4,
      pulseSigmaMm: 0.5,
      lateralSigmaMm: 0.4,
      elevationSigmaMm: 0.4,
      transmission: 1,
    };
    const hvWeight = (volume: SampleVolumeIQ) => {
      const internals = volume as unknown as Internals;
      let w = 0;
      for (const s of internals.scatterers) if (s.vessel === 'hvRight') w += internals.weightAt(s.g) * s.imp;
      return w / internals.scatterers.length;
    };
    let transported = 0;
    let transportedHv = 0;
    let moved = 0;
    const re = new Float32Array(10),
      im = new Float32Array(10);
    for (const seed of [47, 48, 49, 50]) {
      sample.scale = 0.75;
      const volume = new SampleVolumeIQ(anatomy, seed);
      volume.setGate(gate, phys());
      const internals = volume as unknown as Internals;
      const start = internals.scatterers.map((s) => [...s.m]);
      for (let frame = 1; frame <= 1000; frame++) {
        sample.scale = 0.75 + 0.65 * Math.min(1, frame / 250);
        volume.generate(phys(), [0, 0, 0], 10, re, im);
      }
      moved += internals.scatterers.filter((s, i) => Math.hypot(s.m[0] - start[i][0], s.m[1] - start[i][1], s.m[2] - start[i][2]) > 1e-9).length;
      transported += bloodWeight(volume);
      transportedHv += hvWeight(volume);
    }
    let fresh = 0;
    let freshHv = 0;
    for (let seed = 900; seed < 908; seed++) {
      const volume = new SampleVolumeIQ(anatomy, seed);
      volume.setGate(gate, phys());
      fresh += bloodWeight(volume) / 2;
      freshHv += hvWeight(volume) / 2;
    }
    expect(moved).toBe(0);
    expect(transported / fresh).toBeGreaterThan(0.9);
    expect(transported / fresh).toBeLessThan(1.1);
    expect(transportedHv / transported).toBeGreaterThan(0.7 * (freshHv / fresh));
  });

  it('con la cava aplanada, la sangre no pasa ni un pulso en el dominio de la cava como si fuera suyo', () => {
    // Revisión r4: el arco seguro de `domainArc` suponía que las distancias se acercan a 1 mm/mm, pero el semieje AP 0,3 de la
    // cava las hace cambiar a 3,33 mm/mm. A 2600 Hz se concedían 0,0267 mm cuando el reparto cambia a 0,020 mm: un pulso de
    // 0,024 mm dejaba la partícula de `hvRight` emitiendo en el dominio de `ivcInfra`, con arco aún positivo.
    const cava = { id: 'ivcInfra', tube: { kind: 'tube', nodes: [{ p: [0, 0, -30], r: 5 }, { p: [0, 0, 30], r: 5 }], apScale: 0.3 } as Tube };
    const { anatomy, phys, find } = crossedTubes(cava, { hvRight: -31.2, ivcInfra: 0 }, { scale: 1 });
    const gate: GateGeometry = {
      center: [0, 1, 0],
      beamDir: [0, 1, 0],
      lateral: [1, 0, 0],
      elevation: [0, 0, 1],
      lengthMm: 4,
      pulseSigmaMm: 0.5,
      lateralSigmaMm: 0.5,
      elevationSigmaMm: 0.5,
      transmission: 1,
    };
    const volume = new SampleVolumeIQ(anatomy, 47);
    volume.setGate(gate, phys());
    volume.setEquipment({ prfHz: 2600 });
    const internals = volume as unknown as Internals & {
      makeScatterer(world: Vec3, phys: PhysiologySample, ramp: boolean): Particle & { vessel: string; stream: { domainLeft: number } };
      domainArc(stream: object, m: Vec3): number;
      tick: number;
    };
    const particle = internals.makeScatterer([0, 0.92, 0], phys(), false);
    internals.scatterers = [particle];
    particle.stream.domainLeft = internals.domainArc(particle.stream, particle.m);
    internals.tick = 1; // entre dos ticks lentos
    volume.generate(phys(), [0, 0, 0], 1, new Float32Array(1), new Float32Array(1));
    const now = internals.scatterers[0] as Particle & { vessel: string };
    expect(find(now.m).def.id).toBe(now.vessel);
  });

  it('el casquete que se contrae convierte en tejido la sangre que deja fuera, con y sin flujo', () => {
    // Revisión r3: estar en un casquete bastaba para tratar la salida de la luz como salida por flujo; la contracción del
    // calibre reentraba y renovaba la sangre en lugar de convertirla. En el casquete distal de la rama portal derecha, la
    // fracción sanguínea quedaba en 0,9999 frente a 0,469 de una siembra nueva (calibre 1,4 → 0,75 sin flujo) y en 0,848
    // frente a 0,634 (1,1 → 0,9 con el flujo original).
    const patient = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
    const scene = new AnatomyScene(patient);
    const anatomy = new AnatomyQuery(scene);
    const raw = new PhysiologyEngine(patient, scene.vesselAreas()).sample;
    const def = scene.vesselById.get('pvRight')!;
    const a = def.tube.nodes.at(-2)!,
      b = def.tube.nodes.at(-1)!;
    const v: Vec3 = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
    const len = Math.hypot(...v);
    const t: Vec3 = [v[0] / len, v[1] / len, v[2] / len];
    const ln = Math.hypot(t[2], t[0]);
    const lateral: Vec3 = [-t[2] / ln, 0, t[0] / ln];
    const elevation: Vec3 = [
      t[1] * lateral[2] - t[2] * lateral[1],
      t[2] * lateral[0] - t[0] * lateral[2],
      t[0] * lateral[1] - t[1] * lateral[0],
    ];
    const gate: GateGeometry = {
      center: [b.p[0] + t[0] * b.r * 0.85, b.p[1] + t[1] * b.r * 0.85, b.p[2] + t[2] * b.r * 0.85],
      beamDir: t,
      lateral,
      elevation,
      lengthMm: b.r,
      pulseSigmaMm: 0.2,
      lateralSigmaMm: 0.15,
      elevationSigmaMm: 0.15,
      transmission: 1,
    };
    for (const [label, flow, from, to] of [
      ['sin flujo, 1,4 → 0,75', false, 1.4, 0.75],
      ['con flujo, 1,1 → 0,9', true, 1.1, 0.9],
    ] as const) {
      const velocities = flow
        ? raw.velocities
        : (Object.fromEntries(Object.keys(raw.velocities).map((k) => [k, 0])) as typeof raw.velocities);
      const at = (scale: number): PhysiologySample => ({
        ...raw,
        velocities,
        resp: { ...raw.resp, diaphragmCaudalMm: 0, diaphragmVelocityMmS: 0 },
        pvRadiusScale: scale,
      });
      const volume = new SampleVolumeIQ(anatomy, 47);
      volume.setGate(gate, at(from));
      const re = new Float32Array(384),
        im = new Float32Array(384);
      volume.generate(at(from), [0, 0, 0], 384, re, im);
      for (let k = 0; k < 250; k++) volume.generate(at(from + ((to - from) * (k + 1)) / 250), [0, 0, 0], 10, re, im);
      for (let k = 0; k < 4; k++) volume.generate(at(to), [0, 0, 0], 384, re, im);
      const fresh = new SampleVolumeIQ(anatomy, 47);
      fresh.setGate(gate, at(to));
      const now = census(volume);
      const ref = census(fresh);
      expect(now.fraction / ref.fraction, label).toBeGreaterThan(0.85);
      expect(now.fraction / ref.fraction, label).toBeLessThan(1.15);
      expect(now.tissue, label).toBeGreaterThan(0.6 * ref.tissue);
    }
  });
});
