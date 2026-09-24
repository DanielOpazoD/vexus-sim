import { describe, expect, it } from 'vitest';
import { equivalenceSweep, interfaceShellEquivalence, volumeEquivalence } from '../app/equivalenceSweep';
import type { Simulator } from '../app/simulator';
import { Interface } from '../anatomy/interfaces';
import { AnatomyQuery, type WorldQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { CONVEX_C35, probeFrame } from '../probe/probe';
import type { GpuPointQuery } from '../ultrasound/renderer';

type P = [number, number, number];
/** Lo que la «GPU» cambia respecto a la CPU en un punto: tejido, cara o distancia a la cara. */
type Corruption = (p: P, q: WorldQuery) => { tissue?: number; iface?: number; ifd?: number };

/**
 * Lógica de los gates de equivalencia sin WebGL: la «GPU» del simulador falso es la propia
 * anatomía TS (acuerdo perfecto) o una versión con un defecto inyectado, que deben detectar.
 */
function fakeSim(corrupt?: Corruption): Simulator {
  const scene = new AnatomyScene(NORMAL_ADULT);
  const anatomy = new AnatomyQuery(scene);
  const sample = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas()).step();
  const index = new Map(scene.vessels.map((v, i) => [v.id, i]));
  const gpuQuery = (pts: Float32Array): GpuPointQuery => {
    const n = pts.length / 3;
    const tissue = new Int32Array(n);
    const vessel = new Int32Array(n);
    const velocity = new Float32Array(n * 3);
    const iface = new Int32Array(n);
    const ifd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p: P = [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
      const q = anatomy.classifyWorld(p, sample);
      const bad = corrupt?.(p, q) ?? {};
      tissue[i] = bad.tissue ?? q.tissue;
      vessel[i] = q.vessel ? (index.get(q.vessel) ?? -1) : -1;
      if (q.bloodVelocity) velocity.set(q.bloodVelocity, i * 3);
      iface[i] = bad.iface ?? q.interface;
      ifd[i] = bad.ifd ?? q.interfaceDistance;
    }
    return { tissue, vessel, velocity, iface, ifd };
  };
  const frame = probeFrame({ phi: Math.PI * 0.92, z: 8, lift: 0, yaw: 0, rock: 0, tilt: 0 }, scene.torso, CONVEX_C35);
  return { scene, anatomy, sample, transducer: CONVEX_C35, frame, gpuQuery } as unknown as Simulator;
}

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
    // la cara de interfaz de cada punto interior: la luz de los vasos, la mitad abdominal del
    // diafragma y la grasa perirrenal tienen cara lejos de su borde
    expect(v.interfacePoints).toBeGreaterThan(20);
    expect(v.interfaceAgreement).toBe(1);
    expect(v.interfaceDistanceMaxErr).toBeLessThan(1e-4); // float32
  });

  it('un defecto localizado (hígado → cápsula en una esfera de 25 mm) lo detecta el volumen', () => {
    const sim = fakeSim((p, q) =>
      q.tissue === Tissue.Liver && Math.hypot(p[0] + 60, p[1] - 20, p[2] + 10) < 25 ? { tissue: Tissue.LiverCapsule } : {},
    );
    const v = volumeEquivalence(sim, 3000);
    expect(v.tissueAgreement).toBeLessThan(1);
    expect(v.worst).toContain('Liver→LiverCapsule');
  });

  it('la cara y su distancia en el volumen: una luz con otra cara o 0,01 mm de error no pasan', () => {
    const wrongFace = volumeEquivalence(
      fakeSim((_p, q) => (q.interface === Interface.IvcLumen ? { iface: Interface.VeinLumen } : {})),
      3000,
    );
    expect(wrongFace.interfaceAgreement).toBeLessThan(1);
    expect(wrongFace.interfaceWorst).toContain('IvcLumen→VeinLumen');
    const offset = volumeEquivalence(
      fakeSim((_p, q) => (q.interface !== Interface.None ? { ifd: q.interfaceDistance + 0.01 } : {})),
      3000,
    );
    expect(offset.interfaceAgreement).toBe(1);
    expect(offset.interfaceDistanceMaxErr).toBeGreaterThan(0.009);
  });

  it('la cáscara de las caras cubre las caras de los planos de partida y acuerda con una «GPU» idéntica', () => {
    const r = interfaceShellEquivalence(fakeSim(), 24);
    expect(r.agreement).toBe(1);
    expect(r.distanceMaxErr).toBeLessThan(1e-4);
    expect(r.disagreements).toEqual([]);
    // los dueños que reparte `classify`, todos en algún plano de partida
    for (const face of ['IvcLumen', 'VeinLumen', 'PortalLumen', 'LiverCapsule', 'DiaphragmLiver', 'RenalCapsule', 'PerirenalFat'])
      expect(r.byInterface[face] ?? 0, `${face}: ${JSON.stringify(r.byInterface)}`).toBeGreaterThan(10);
  });

  it('la cáscara ve una cara que la GPU dibuja y la CPU no (la cápsula junto a Morison o al diafragma)', () => {
    // una GLSL sin la regla de los dueños de la cápsula: dibuja su cara en toda la cápsula
    const r = interfaceShellEquivalence(
      fakeSim((_p, q) =>
        q.tissue === Tissue.LiverCapsule && q.interface === Interface.None
          ? { iface: Interface.LiverCapsule, ifd: q.boundaryDistance }
          : {},
      ),
      24,
    );
    expect(r.agreement).toBeLessThan(0.999);
    expect(r.disagreements.join('\n')).toContain('None→LiverCapsule (LiverCapsule)');
  });
});
