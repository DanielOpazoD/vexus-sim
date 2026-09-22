import { describe, expect, it } from 'vitest';
import { equivalenceSweep, volumeEquivalence } from '../app/equivalenceSweep';
import type { Simulator } from '../app/simulator';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { CONVEX_C35, probeFrame } from '../probe/probe';
import type { GpuPointQuery } from '../ultrasound/renderer';

/**
 * Lógica de los gates de equivalencia sin WebGL: la «GPU» del simulador falso es la propia
 * anatomía TS (acuerdo perfecto) o una versión con un defecto inyectado, que deben detectar.
 */
function fakeSim(corrupt?: (p: [number, number, number], tissue: number) => number): Simulator {
  const scene = new AnatomyScene(NORMAL_ADULT);
  const anatomy = new AnatomyQuery(scene);
  const sample = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas()).step();
  const index = new Map(scene.vessels.map((v, i) => [v.id, i]));
  const gpuQuery = (pts: Float32Array): GpuPointQuery => {
    const n = pts.length / 3;
    const tissue = new Int32Array(n);
    const vessel = new Int32Array(n);
    const velocity = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p: [number, number, number] = [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
      const q = anatomy.classifyWorld(p, sample);
      tissue[i] = corrupt ? corrupt(p, q.tissue) : q.tissue;
      vessel[i] = q.vessel ? (index.get(q.vessel) ?? -1) : -1;
      if (q.bloodVelocity) velocity.set(q.bloodVelocity, i * 3);
    }
    return { tissue, vessel, velocity };
  };
  const frame = probeFrame({ phi: Math.PI * 0.92, z: 8, lift: 0, yaw: 0, rock: 0, tilt: 0 }, scene.torso, CONVEX_C35);
  return { scene, anatomy, sample, transducer: CONVEX_C35, frame, gpuQuery } as unknown as Simulator;
}

const LIVER: number = Tissue.Liver;

describe('Gates de equivalencia TS ↔ GLSL (lógica)', () => {
  it('con una «GPU» idéntica, ventanas y volumen dan acuerdo exacto', () => {
    const sim = fakeSim();
    for (const r of equivalenceSweep(sim)) {
      expect(r.interiorAgreement).toBe(1);
      expect(r.vesselAgreement).toBe(1);
    }
    const v = volumeEquivalence(sim, 3000);
    expect(v.interiorPoints).toBeGreaterThan(2000);
    expect(v.tissueAgreement).toBe(1);
    expect(v.velocityP95RelErr).toBeLessThan(1e-6); // solo el redondeo a float32
  });

  it('un defecto localizado (hígado → cápsula en una esfera de 25 mm) lo detecta el volumen', () => {
    const sim = fakeSim((p, t) => (t === LIVER && Math.hypot(p[0] + 60, p[1] - 20, p[2] + 10) < 25 ? Tissue.LiverCapsule : t));
    const v = volumeEquivalence(sim, 3000);
    expect(v.tissueAgreement).toBeLessThan(1);
    expect(v.worst).toContain('Liver→LiverCapsule');
  });
});
