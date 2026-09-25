import { describe, expect, it } from 'vitest';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { CONVEX_C35, lineCoupling, pointOnLine, probeFrame, type ProbePose } from '../probe/probe';

/**
 * Cada punto de partida debe cortar de verdad la estructura que promete su
 * texto, sin afinar la sonda: la anatomía cambia a menudo (decisiones 33–37) y
 * esta es la única valla que impide que una ventana quede «vacía».
 */
const scene = new AnatomyScene(NORMAL_ADULT);

interface Sweep {
  vessels: Map<string, number>;
  tissues: Map<Tissue, number>;
  coupling: number;
}

function sweep(sp: StartPoint, depthMm: number): Sweep {
  const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
  const fr = probeFrame(pose, scene.torso, CONVEX_C35);
  const vessels = new Map<string, number>();
  const tissues = new Map<Tissue, number>();
  let coupling = 0;
  const nLines = 61;
  for (let i = 0; i < nLines; i++) {
    const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / (nLines - 1);
    coupling += lineCoupling(pose, CONVEX_C35, theta) / nLines;
    for (let r = 2; r < depthMm; r += 2) {
      const q = scene.classify(pointOnLine(fr, CONVEX_C35, theta, r), BASELINE_CALIBER);
      tissues.set(q.tissue, (tissues.get(q.tissue) ?? 0) + 1);
      if (q.vessel) vessels.set(q.vessel, (vessels.get(q.vessel) ?? 0) + 1);
    }
  }
  return { vessels, tissues, coupling };
}

const byId = (id: StartPoint['id']) => START_POINTS.find((s) => s.id === id)!;
/** Longitud aproximada (mm) que un vaso ocupa en el plano: muestras × paso / líneas que lo cruzan. */
const samples = (s: Sweep, id: string) => s.vessels.get(id) ?? 0;

describe('Puntos de partida (decisión 17): cada ventana corta lo que promete', () => {
  it('subxifoideo: VCI en eje largo (infra + supra) a través del hígado, con acoplamiento útil', () => {
    const s = sweep(byId('subxiphoid'), 160);
    expect(s.coupling).toBeGreaterThan(0.5);
    // ≥ 60 mm de VCI en el plano: 60 mm / 2 mm de paso = 30 muestras, ×~5 líneas por su calibre
    expect(samples(s, 'ivcInfra') + samples(s, 'ivcSupra')).toBeGreaterThan(120);
    expect(s.tissues.get(Tissue.Liver) ?? 0).toBeGreaterThan(400);
  });

  it('intercostal derecho: suprahepáticas y VCI a través del hígado', () => {
    const s = sweep(byId('intercostal'), 160);
    expect(s.coupling).toBeGreaterThan(0.5);
    const hv = samples(s, 'hvRight') + samples(s, 'hvMiddle') + samples(s, 'hvRightAnterior');
    // desde la decisión 62, por el 8.º espacio en la línea axilar media (28 muestras de 2 mm: la derecha y la
    // media hacia la VCI; la pose de antes, casi craneocaudal, cruzaba seis costillas óseas)
    expect(hv).toBeGreaterThan(25);
    expect(samples(s, 'ivcInfra') + samples(s, 'ivcSupra')).toBeGreaterThan(20);
    expect(s.tissues.get(Tissue.Liver) ?? 0).toBeGreaterThan(600);
  });

  it('intercostal derecho: una costilla ósea asoma en un borde con su sombra y el centro queda despejado', () => {
    // decisión 62: con la regla de antes del cartílago (φ > 1,05) todo el arco derecho anterolateral era
    // cartílago, sin cortical ni sombra; ahora es hueso y la vista va a lo largo del 8.º espacio intercostal
    const sp = byId('intercostal');
    const fr = probeFrame({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 }, scene.torso, CONVEX_C35);
    const nLines = 61;
    const boneLine = Array.from({ length: nLines }, (_, i) => {
      const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / (nLines - 1);
      for (let r = 2; r < 60; r += 1) {
        const t = scene.classify(pointOnLine(fr, CONVEX_C35, theta, r), BASELINE_CALIBER).tissue;
        expect(t, `línea ${i} a ${r} mm`).not.toBe(Tissue.Cartilage);
        if (t === Tissue.Bone) return true;
      }
      return false;
    });
    // una costilla en el 20 % de un borde, a lo sumo 12 líneas con sombra y el 60 % central sin ninguna
    expect(boneLine.slice(0, 12).some(Boolean) || boneLine.slice(nLines - 12).some(Boolean)).toBe(true);
    expect(boneLine.filter(Boolean).length).toBeLessThanOrEqual(12);
    expect(boneLine.slice(12, nLines - 12).every((b) => !b)).toBe(true);
  });

  it('flanco: VCI transhepática coronal con suprahepáticas desembocando en ella', () => {
    const s = sweep(byId('flank'), 160);
    expect(s.coupling).toBeGreaterThan(0.5);
    expect(samples(s, 'ivcInfra') + samples(s, 'ivcSupra')).toBeGreaterThan(120);
    expect(samples(s, 'hvRight') + samples(s, 'hvMiddle')).toBeGreaterThan(30);
  });

  it('renal: corteza, médula y seno del riñón derecho con un vaso interlobar', () => {
    const s = sweep(byId('renal'), 160);
    expect(s.coupling).toBeGreaterThan(0.5);
    expect(s.tissues.get(Tissue.RenalCortex) ?? 0).toBeGreaterThan(150);
    expect(s.tissues.get(Tissue.RenalMedulla) ?? 0).toBeGreaterThan(25); // pirámides discretas (decisión 43)
    expect(s.tissues.get(Tissue.RenalSinus) ?? 0).toBeGreaterThan(40);
    expect([...s.vessels.keys()].some((v) => /interlobar|renalVein/i.test(v))).toBe(true);
  });
});
