// @tier slow
import { describe, expect, it } from 'vitest';
import { START_POINTS } from '../app/startPoints';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { AF_MODERATE_CONGESTION, NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import type { Vec3 } from '../core/vec3';
import { PwDopplerChain } from '../doppler/pwChain';
import type { GateGeometry } from '../doppler/sampleVolume';
import { measureObservedHepatic, measureObservedPortal, measureObservedRenal } from '../doppler/spectralMeasure';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient, type PatientState } from '../physiology/patientState';
import type { VesselId } from '../physiology/vessels';
import { CONVEX_C35, lineDirection, pointOnLine, probeFrame, type ProbePose } from '../probe/probe';
import { apertureAngleSigmaRad, lateralSigmaMm } from '../ultrasound/beamModel';
import { classifyPortal, classifyVexusC } from '../vexus/classification';
import { measurePhysiologyTruth } from '../vexus/measurements';

/**
 * Cadena completa del ALUMNO (Fase 0): fisiología → puerta PW colocada sobre el vaso
 * desde una ventana real → IQ → filtro → espectro → medición observada (la misma
 * función que usa la pestaña Medir) → grado VExUS. Se compara con la verdad
 * fisiológica del caso. Antes solo la vena hepática del caso sano estaba cubierta; la
 * portal, la renal y el caso de FA no tenían ninguna prueba de extremo a extremo.
 */
interface Territory {
  kind: 'hepatic' | 'portal' | 'renal';
  window: (typeof START_POINTS)[number]['id'];
  vessels: VesselId[];
}
const TERRITORIES: Territory[] = [
  { kind: 'hepatic', window: 'intercostal', vessels: ['hvRight'] },
  { kind: 'portal', window: 'flank', vessels: ['pvRight', 'pvTrunk'] },
  { kind: 'renal', window: 'renal', vessels: ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'] },
];

function examine(base: PatientState) {
  const patient = { ...clonePatient(base), respiratoryPattern: 'apnea-expiratory' as const };
  const scene = new AnatomyScene(patient);
  const anatomy = new AnatomyQuery(scene);
  const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 12 });
  const chain = new PwDopplerChain(anatomy, patient.seed);
  // unos segundos para salir del transitorio inicial
  for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
  const observed: Record<Territory['kind'], unknown> = { hepatic: null, portal: null, renal: null };
  for (const ter of TERRITORIES) {
    const sp = START_POINTS.find((s) => s.id === ter.window)!;
    const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
    const frame = probeFrame(pose, scene.torso, CONVEX_C35);
    // Técnica del operador: puerta dentro de la luz (lejos de la pared) y con buen ángulo de
    // insonación (el flujo lo más alineado posible con el haz): puntuación |cos α|·min(bd, 3 mm)
    let best: { theta: number; r: number; bd: number; score: number } | null = null;
    for (let th = -CONVEX_C35.halfSector; th <= CONVEX_C35.halfSector; th += 0.015)
      for (let r = 15; r <= 170; r += 1.5) {
        const q = anatomy.classifyWorld(pointOnLine(frame, CONVEX_C35, th, r), engine.sample);
        if (!q.vessel || !ter.vessels.includes(q.vessel) || !q.vesselHit || q.boundaryDistance < 1.2) continue;
        const d = lineDirection(frame, th);
        const tg = q.vesselHit.tangent;
        const cosA = Math.abs(d[0] * tg[0] + d[1] * tg[1] + d[2] * tg[2]);
        const score = cosA * Math.min(q.boundaryDistance, 3);
        if (!best || score > best.score) best = { theta: th, r, bd: q.boundaryDistance, score };
      }
    expect(best, `${base.id}: ${ter.kind} sin vaso en la ventana ${ter.window}`).not.toBeNull();
    const { theta, r } = best!;
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    const lateral: Vec3 = [
      frame.lateral[0] * c - frame.axial[0] * sn,
      frame.lateral[1] * c - frame.axial[1] * sn,
      frame.lateral[2] * c - frame.axial[2] * sn,
    ];
    const gate: GateGeometry = {
      center: pointOnLine(frame, CONVEX_C35, theta, r),
      beamDir: lineDirection(frame, theta),
      lateral,
      elevation: frame.elevation,
      lengthMm: Math.min(4, 2 * best!.bd),
      lateralSigmaMm: lateralSigmaMm(r, 90) * 1.2,
      elevationSigmaMm: 1.6,
      pulseSigmaMm: 0.5,
      apertureAngleSigmaRad: apertureAngleSigmaRad(r),
      transmission: 0.3,
    };
    chain.reset();
    // Escala: la más alta que permite la profundidad de la puerta (PRF ≤ c/2d, con margen),
    // hasta 6 kHz, como sube el operador la escala cuando el flujo se pliega
    const prf = Math.min(6000, Math.floor((0.9 * 1_540_000) / (2 * r)));
    chain.begin(prf, CONVEX_C35.f0Doppler, 0, 25, engine.clock.t + engine.clock.dt);
    const steps = Math.round(6 / engine.clock.dt);
    for (let i = 0; i < steps; i++) {
      const s = engine.step();
      if (i % 8 === 0) chain.setGate(gate, s);
      chain.step(s, [0, 0, 0], engine.clock.dt);
    }
    chain.flush();
    const tNow = engine.clock.t;
    const beats = engine.rhythm.beatsAround(tNow - 3).filter((b) => b.tR > tNow - 5.5 && b.tR + b.rr < tNow);
    const opts = { f0Hz: CONVEX_C35.f0Doppler, angleCorrectionRad: 0, invert: false, fftSize: chain.spectral.fftSize };
    const recent = chain.spectral.columns.filter((col) => col.t > tNow - 5.5);
    observed[ter.kind] =
      ter.kind === 'hepatic'
        ? measureObservedHepatic(recent, beats, opts)
        : ter.kind === 'portal'
          ? measureObservedPortal(recent, beats, opts)
          : measureObservedRenal(recent, beats, opts);
  }
  const truth = measurePhysiologyTruth(engine, { fromT: engine.clock.t - 10, toT: engine.clock.t });
  return {
    truth,
    hepatic: observed.hepatic as ReturnType<typeof measureObservedHepatic>,
    portal: observed.portal as ReturnType<typeof measureObservedPortal>,
    renal: observed.renal as ReturnType<typeof measureObservedRenal>,
  };
}

describe('Cadena completa del alumno: puerta → espectro → medición → grado (Fase 0)', () => {
  for (const [base, expectedGrade] of [
    [NORMAL_ADULT, 0],
    [SEVERE_CONGESTION, 3],
    [AF_MODERATE_CONGESTION, 1],
  ] as const) {
    it(`${base.label}: lo medido sobre el espectro coincide con la verdad y da grado ${expectedGrade}`, () => {
      const { truth, hepatic, portal, renal } = examine(base);
      expect(hepatic, 'medición hepática').not.toBeNull();
      expect(portal, 'medición portal').not.toBeNull();
      expect(renal, 'medición renal').not.toBeNull();
      // mismo patrón / clase que la verdad fisiológica en los tres territorios
      expect(hepatic!.pattern).toBe(truth.hepaticPattern);
      expect(classifyPortal(portal!.pulsatilityFraction)).toBe(classifyPortal(truth.portalPF));
      // la PF medida sobre la envolvente queda a ≤ 8 puntos de la verdad (medido: 17/13, 73/75, 35/36 %)
      expect(Math.abs(portal!.pulsatilityFraction - truth.portalPF)).toBeLessThan(8);
      expect(renal!.pattern).toBe(truth.renalPattern);
      // y el grado con la VCI de la verdad (el calibrador es manual)
      const grade = classifyVexusC({
        ivcMaxDiameterMm: truth.ivcMaxMm,
        hepatic: hepatic!.pattern,
        portalPulsatilityFraction: portal!.pulsatilityFraction,
        renal: renal!.pattern,
      });
      expect(grade.status).toBe('complete');
      expect(grade.grade).toBe(expectedGrade);
    });
  }
});
