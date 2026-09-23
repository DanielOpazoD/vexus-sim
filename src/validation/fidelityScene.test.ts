// @tier slow
import { describe, expect, it } from 'vitest';
import { fidelityStats, type FidelityStats } from '../app/fidelity';
import type { Simulator } from '../app/simulator';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient } from '../physiology/patientState';
import { CONVEX_C35, pointOnLine, probeFrame } from '../probe/probe';
import { lateralFwhmMm } from '../ultrasound/beamModel';
import { DISPLAY_MARGIN_PX } from '../ultrasound/renderer';
import { pixelToBeam, sectorLayout } from '../ultrasound/sectorGeometry';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import { detect, psf, whiteField } from './syntheticSpeckle';

/**
 * El banco de fidelidad sobre la anatomía real, sin GPU: el sano en apnea en las ventanas subxifoidea
 * e intercostal, una envolvente de moteado ideal atenuada ×0,1 fuera del hígado (si la máscara deja
 * entrar otro tejido, la fracción oscura y las grietas lo delatan) y una imagen «mostrada» pintada por
 * tejido (hígado 100, sangre 0, pared de vaso 180, el resto 60). Comprueba la geometría de
 * `fidelityStats` de extremo a extremo: la máscara del hígado, el perfil sin pendiente inventada y
 * las paredes anteriores con su incidencia real.
 */
const DEPTH = 180;
const FOCUS = 90;
const W = 320;
const H = 229;
const GRID_MM = 0.5;
const NR = DEPTH / GRID_MM;

const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-expiratory' as const };
const scene = new AnatomyScene(patient);
const anatomy = new AnatomyQuery(scene);
const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 4 });
for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
const G = { lines: CONVEX_C35.lines, samples: 1024 };
const speckle = detect(G, psf(G, whiteField(G, 7), 1.5, 1.0), Math.hypot);
const thetaOf = (u: number): number => -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * (u + 0.5)) / G.lines;

function measure(id: StartPoint['id']): FidelityStats {
  const sp = START_POINTS.find((s) => s.id === id)!;
  const pose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
  const frame = probeFrame(pose, scene.torso, CONVEX_C35);
  const display = sectorLayout(W, H, CONVEX_C35, DEPTH, DISPLAY_MARGIN_PX);
  const sim = {
    transducer: CONVEX_C35,
    profile: CONVEX_C35_PROFILE,
    bmode: { depthMm: DEPTH, focusMm: FOCUS, dynamicRangeDb: 60 },
    anatomy,
    frame,
    pose,
    sample: engine.sample,
    renderer: { display },
  } as unknown as Simulator;
  const tissueAt = (theta: number, r: number): Tissue =>
    anatomy.classifyWorld(pointOnLine(frame, CONVEX_C35, theta, r), engine.sample).tissue;
  // envolvente: moteado ideal en el hígado, ×0,1 en cualquier otro tejido (rejilla de 0,5 mm)
  const env = { ...speckle, data: new Float32Array(speckle.data) };
  for (let u = 0; u < G.lines; u++)
    for (let k = 0; k < NR; k++) {
      if (tissueAt(thetaOf(u), (k + 0.5) * GRID_MM) === Tissue.Liver) continue;
      for (let v = Math.ceil((k * GRID_MM * G.samples) / DEPTH - 0.5); v < Math.ceil(((k + 1) * GRID_MM * G.samples) / DEPTH - 0.5); v++)
        if (v >= 0 && v < G.samples) env.data[v * G.lines + u] *= 0.1;
    }
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const b = pixelToBeam(display, CONVEX_C35, DEPTH, x, y);
      if (!b) continue;
      const t = tissueAt(b.theta, b.r);
      gray[y * W + x] =
        t === Tissue.Liver ? 100 : t === Tissue.Blood ? 0 : t === Tissue.VesselWallThin || t === Tissue.VesselWallPortal ? 180 : 60;
    }
  return fidelityStats(sim, env, { width: W, height: H, gray });
}

const subxiphoid = measure('subxiphoid');
const intercostal = measure('intercostal');

describe('banco de fidelidad sobre la anatomía del sano, sin GPU', () => {
  it('la envolvente se mide solo en hígado: el moteado ideal sale ideal aunque el resto esté a ×0,1', () => {
    for (const s of [subxiphoid, intercostal]) {
      expect(s.envelope.patches).toBeGreaterThan(10);
      expect(s.envelope.snr).toBeGreaterThan(1.8);
      expect(s.envelope.snr).toBeLessThan(2.1);
      expect(s.envelope.darkFraction).toBeGreaterThan(0.055);
      expect(s.envelope.darkFraction).toBeLessThan(0.085);
      expect(s.envelope.crackIndex).toBeLessThan(0.1);
    }
    const band = subxiphoid.bands.find((b) => b.patches > 5)!;
    expect(band.beamFwhmMm).toBeCloseTo(lateralFwhmMm(band.depthMm, FOCUS, CONVEX_C35_PROFILE.beam), 10);
  });

  it('la máscara de la imagen cae en hígado puro y el perfil plano no tiene pendiente', () => {
    for (const s of [subxiphoid, intercostal]) {
      const d = s.display!;
      expect(d.liver.pixels).toBeGreaterThan(500);
      expect(d.liver.p50).toBe(100);
      expect(Math.abs(d.liver.mean - 100)).toBeLessThan(3);
      expect(Math.abs(d.profile.slopeDbPerCm)).toBeLessThan(0.1);
      expect(d.colorOn).toBe(false);
      // la luz pintada a 0 y el diafragma a 60: el centro de la luz y la saturación los encuentran
      expect(d.lumen.pixels).toBeGreaterThan(50);
      expect(d.lumen.p50).toBe(0);
      if (Number.isFinite(d.diaphragmSaturated)) expect(d.diaphragmSaturated).toBe(0);
    }
  });

  it('encuentra las paredes anteriores con su incidencia real y da el cociente pintado', () => {
    // subxifoidea: la mayoría a 20–40°; intercostal: la VH cruza oblicua (20–60°), ninguna a < 20°
    const sub = subxiphoid.display!.walls.find((b) => b.fromDeg === 20)!;
    expect(sub.walls).toBeGreaterThan(20);
    expect(sub.ratio).toBeCloseTo(1.8, 5);
    expect(sub.deltaDb).toBeGreaterThan(10);
    const oblique = intercostal.display!.walls.filter((b) => b.fromDeg >= 20);
    expect(oblique.reduce((n, b) => n + b.walls, 0)).toBeGreaterThan(20);
    for (const b of oblique) expect(b.ratio).toBeCloseTo(1.8, 5);
  });
});
