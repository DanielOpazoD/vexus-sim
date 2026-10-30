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
