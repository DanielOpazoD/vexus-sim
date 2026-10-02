import { describe, expect, it } from 'vitest';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { tubeShapeOf } from '../anatomy/primitives';
import type { VesselDef } from '../anatomy/vesselTree';
import type { VesselId } from '../physiology/vessels';
import { VESSEL_META } from '../physiology/vessels';
import { AnatomyQuery } from '../anatomy/query';
import { CASES, NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { HEPATIC_JUNCTIONS, junctionWitness } from './support/vascularJunctions';

describe('continuidad vascular en los calibres de la fisiología', () => {
  it.each(CASES)(
    '$id: las quince conexiones tienen volumen luminal compartido en veinte instantes de una ventana de ocho segundos',
    (patient) => {
      const scene = new AnatomyScene(patient);
      const query = new AnatomyQuery(scene);
      const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 2 });
      for (let i = 0; i < 2000; i++) {
        engine.step();
        if (i % 100 !== 0) continue;
        const caliber = query.caliberFor(engine.sample);
        for (const edge of HEPATIC_JUNCTIONS) {
          const result = junctionWitness(scene.vesselById, caliber, edge);
          // Cero es contacto tangencial sin volumen. Épsilon numérico, no umbral clínico de ostium.
          expect(result.fieldMargin, `${patient.id} ${edge[0]} → ${edge[1]} t=${engine.sample.t}`).toBeGreaterThan(1e-6);
          // No basta el tubo aislado: todo el puente muestreado debe seguir siendo sangre en la escena final.
          for (const point of result.path) {
            const hit = scene.classify(point, caliber);
            expect(hit.tissue, `${patient.id} ${edge[0]}: puente en escena`).toBe(Tissue.Blood);
            expect(hit.vessel).not.toBeNull();
            expect([VESSEL_META[edge[0]].system, VESSEL_META[edge[1]].system]).toContain(VESSEL_META[hit.vessel!].system);
          }
        }
      }
    },
  );
});

describe('sensibilidad del banco de uniones', () => {
  const edge = HEPATIC_JUNCTIONS.find(([child]) => child === 'hvLeftTributary')!;
  const fixture = (z: number): Map<VesselId, VesselDef> => {
    const def = (id: VesselId, nodes: VesselDef['tube']['nodes']): VesselDef => ({
      id,
      tube: { kind: 'tube', nodes, apScale: 1 },
      refRadius: 1,
      profileN: 3,
      wallTissue: Tissue.VesselWallThin,
      wallMm: 0.5,
    });
    return new Map([
      [
        'hvLeftTributary',
        def('hvLeftTributary', [
          { p: [0, 0, 0], r: 1 },
          { p: [0, 0, 10], r: 1 },
        ]),
      ],
      [
        'hvLeft',
        def('hvLeft', [
          { p: [-10, 0, z], r: 1 },
          { p: [10, 0, z], r: 1 },
        ]),
      ],
    ]);
  };

  it('distingue volumen compartido, tangencia sin volumen y separación en un fantoma analítico', () => {
    expect(junctionWitness(fixture(11.5), BASELINE_CALIBER, edge, 0.01).fieldMargin).toBeCloseTo(0.25, 2);
    expect(junctionWitness(fixture(12), BASELINE_CALIBER, edge, 0.01).fieldMargin).toBeCloseTo(0, 10);
    expect(junctionWitness(fixture(12.2), BASELINE_CALIBER, edge, 0.01).fieldMargin).toBeLessThan(0);
  });

  it('reintroducir el extremo previo reproduce la regresión con el calibre del adulto normal', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const engine = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas(), { historySeconds: 2 });
    for (let i = 0; i < 1701; i++) engine.step();
    const caliber = new AnatomyQuery(scene).caliberFor(engine.sample);
    const original = scene.vesselById.get('hvLeftTributary')!;
    const nodes = original.tube.nodes.map((node) => ({ ...node }));
    nodes[nodes.length - 1] = { ...nodes.at(-1)!, p: [10, 14, 14] };
    const mutant = new Map(scene.vesselById);
    mutant.set('hvLeftTributary', {
      ...original,
      tube: { ...original.tube, nodes, shape: tubeShapeOf(original.tube.shape!.seed, 'vein', nodes) },
    });
    expect(junctionWitness(scene.vesselById, caliber, edge).fieldMargin).toBeGreaterThan(0);
    expect(junctionWitness(mutant, caliber, edge).fieldMargin).toBeLessThan(0);
  });

  it('conserva el contrato de contención hepática del 95 % con muestreo denso del eje y sus ramas', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    let inside = 0;
    let count = 0;
    for (const vessel of scene.vessels.filter((v) => v.id === 'hvLeftTributary')) {
      for (let i = 0; i + 1 < vessel.tube.nodes.length; i++) {
        const a = vessel.tube.nodes[i].p;
        const b = vessel.tube.nodes[i + 1].p;
        for (let k = 0; k < 1000; k++) {
          const t = k / 1000;
          const point: [number, number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          if ((scene.faceSdf(point, BASELINE_CALIBER, 'liverSurface') ?? 1) < 0) inside++;
          count++;
        }
      }
    }
    expect(count).toBeGreaterThan(0);
    // Contrato existente de liverShape.test.ts, sin bajar su umbral ni presentar el eje como la pared completa.
    expect(inside / count).toBeGreaterThanOrEqual(0.95);
  });

  it('informa un vaso ausente y rechaza pasos de muestreo inválidos', () => {
    expect(() => junctionWitness(new Map(), BASELINE_CALIBER, edge)).toThrow('Vaso ausente');
    for (const step of [0, -1, NaN, Infinity]) {
      expect(() => junctionWitness(fixture(11.5), BASELINE_CALIBER, edge, step)).toThrow('Paso de muestreo inválido');
    }
  });
});
