import { describe, expect, it } from 'vitest';
import { bestGateOnVessel } from '../app/gatePlacement';
import { acousticWindowWeight } from '../app/gateTransmission';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient, type RespiratoryPattern } from '../physiology/patientState';
import { uncompress } from '../anatomy/compression';
import { contactCoupling, probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine, probeFrame, type ProbePose } from '../probe/probe';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';

/**
 * Cada punto de partida debe cortar de verdad la estructura que promete su
 * texto, sin afinar la sonda: la anatomía cambia a menudo (decisiones 33–37) y
 * esta es la única valla que impide que una ventana quede «vacía». El tejido es el que muestra la aplicación: el
 * de la pose con la compresión de la sonda (decisión 63), y el acoplamiento, el contacto conseguido.
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
  const contact = probeContact(pose, fr, CONVEX_C35, scene.torso);
  const vessels = new Map<string, number>();
  const tissues = new Map<Tissue, number>();
  let coupling = 0;
  const nLines = 61;
  for (let i = 0; i < nLines; i++) {
    const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / (nLines - 1);
    coupling += contactCoupling(contact, theta) / nLines;
    for (let r = 2; r < depthMm; r += 2) {
      const q = scene.classify(uncompress(pointOnLine(fr, CONVEX_C35, theta, r), contact), BASELINE_CALIBER);
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
    expect(s.coupling).toBeGreaterThan(0.9);
    const hv = samples(s, 'hvRight') + samples(s, 'hvMiddle') + samples(s, 'hvRightAnterior');
    expect(hv).toBeGreaterThan(30);
    expect(samples(s, 'ivcInfra') + samples(s, 'ivcSupra')).toBeGreaterThan(20);
    expect(s.tissues.get(Tissue.Liver) ?? 0).toBeGreaterThan(600);
  });

  it('intercostal derecho: ninguna costilla en todo el sector, ósea o cartílago, hasta el fondo de la imagen', () => {
    // decisión 62: la pose de antes (casi craneocaudal) cruzaba seis costillas óseas; la primera del 8.º espacio,
    // con 11° de basculación, dejaba una en cada borde (a 36–52 y a 71 mm) y 14 líneas sin acoplar. Con la de
    // ahora, girar la sonda 2° ya mete la 9.ª en un borde. La vértebra, al fondo (14–16 cm), no cuenta.
    const sp = byId('intercostal');
    const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
    const fr = probeFrame(pose, scene.torso, CONVEX_C35);
    const contact = probeContact(pose, fr, CONVEX_C35, scene.torso);
    const nLines = 61;
    for (let i = 0; i < nLines; i++) {
      const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / (nLines - 1);
      for (let r = 1; r < 180; r += 1) {
        const t = scene.classify(uncompress(pointOnLine(fr, CONVEX_C35, theta, r), contact), BASELINE_CALIBER).tissue;
        expect(t === Tissue.Bone || t === Tissue.Cartilage, `línea ${i} a ${r} mm`).toBe(false);
      }
    }
  });

  it('intercostal derecho: la puerta del operador en una suprahepática a ≤ 50° y con ventana, en espiración y respirando', () => {
    // La función de la vista, no solo su anatomía: `bestGateOnVessel` con el peso de ventana acústica (como la
    // e2e y la pestaña Medir) en apnea espiratoria y en el máximo descenso del diafragma de la respiración
    // tranquila (8 s). El peso incluye la atenuación de ida y vuelta a la frecuencia Doppler: 0,058 a 89 mm con
    // 43° y 0,038 a 101 mm con 35°; la puerta de la pose casi craneocaudal de antes quedaba a 63–80 mm (peso
    // 0,09–0,16, sin sombra en la puerta) con 57–68°, por encima de la cota.
    const sp = byId('intercostal');
    const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
    for (const pattern of ['apnea-expiratory', 'quiet'] as RespiratoryPattern[]) {
      const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: pattern };
      const sc = new AnatomyScene(patient);
      const anatomy = new AnatomyQuery(sc);
      const engine = new PhysiologyEngine(patient, sc.vesselAreas(), { historySeconds: 12 });
      let sample = engine.step();
      for (let i = 1; i < Math.round(8 / engine.clock.dt); i++) {
        const s = engine.step();
        if (s.resp.diaphragmCaudalMm > sample.resp.diaphragmCaudalMm) sample = s;
      }
      const frame = probeFrame(pose, sc.torso, CONVEX_C35);
      const contact = probeContact(pose, frame, CONVEX_C35, sc.torso);
      anatomy.setProbeCompression(contact);
      const w = acousticWindowWeight(anatomy, frame, CONVEX_C35, contact, sample, 180, CONVEX_C35_PROFILE.dopplerEffectiveMHz);
      const g = bestGateOnVessel(anatomy, frame, CONVEX_C35, sample, ['hvRight', 'hvMiddle'], 175, 1.2, w);
      expect(g, pattern).not.toBeNull();
      const tag = `${pattern}: ${JSON.stringify({ r: g!.r, theta: g!.theta })}`;
      expect((Math.acos(g!.cosAngle) * 180) / Math.PI, tag).toBeLessThanOrEqual(50);
      expect(w(g!.theta, g!.r), tag).toBeGreaterThanOrEqual(0.03);
    }
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
