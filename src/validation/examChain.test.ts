// @tier slow
import { describe, expect, it } from 'vitest';
import { bestGateOnVessel, type GatePlacement } from '../app/gatePlacement';
import { acousticWindowWeight } from '../app/gateTransmission';
import { START_POINTS } from '../app/startPoints';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { AF_MODERATE_CONGESTION, NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import type { Vec3 } from '../core/vec3';
import { PwDopplerChain } from '../doppler/pwChain';
import type { GateGeometry } from '../doppler/sampleVolume';
import { CAPTURE_BEATS } from '../doppler/measureQuality';
import { measureObservedHepatic, measureObservedPortal, measureObservedRenal } from '../doppler/spectralMeasure';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient, type PatientState, type RespiratoryPattern } from '../physiology/patientState';
import type { VesselId } from '../physiology/vessels';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, lineDirection, pointOnLine, type ProbeFrame, type ProbePose } from '../probe/probe';
import { apertureAngleSigmaRad, lateralSigmaMm } from '../ultrasound/beamModel';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
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
  // porta principal (la muestra que recomienda VExUS): corre craneocaudal y la respiración la desliza por su eje
  { kind: 'portal', window: 'portal', vessels: ['pvTrunk'] },
  { kind: 'renal', window: 'renal', vessels: ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'] },
];

/** Puerta PW sobre el punto elegido: longitud ≤ 2·bd, haz a esa profundidad, transmisión −10 dB. */
function gateFor(frame: ProbeFrame, best: GatePlacement): GateGeometry {
  const { theta, r } = best;
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  const lateral: Vec3 = [
    frame.lateral[0] * c - frame.axial[0] * sn,
    frame.lateral[1] * c - frame.axial[1] * sn,
    frame.lateral[2] * c - frame.axial[2] * sn,
  ];
  return {
    center: pointOnLine(frame, CONVEX_C35, theta, r),
    beamDir: lineDirection(frame, theta),
    lateral,
    elevation: frame.elevation,
    lengthMm: Math.min(4, 2 * best.bd),
    lateralSigmaMm: lateralSigmaMm(r, 90) * 1.2,
    elevationSigmaMm: 1.6,
    pulseSigmaMm: 0.5,
    apertureAngleSigmaRad: apertureAngleSigmaRad(r),
    transmission: 0.3,
  };
}

function examine(base: PatientState, respiratoryPattern: RespiratoryPattern = 'apnea-expiratory', territories: Territory[] = TERRITORIES) {
  const patient = { ...clonePatient(base), respiratoryPattern };
  const scene = new AnatomyScene(patient);
  const anatomy = new AnatomyQuery(scene);
  const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 12 });
  const chain = new PwDopplerChain(anatomy, patient.seed);
  // unos segundos para salir del transitorio inicial
  for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
  const observed: Record<Territory['kind'], unknown> = { hepatic: null, portal: null, renal: null };
  for (const ter of territories) {
    const sp = START_POINTS.find((s) => s.id === ter.window)!;
    const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
    // la compresión de la sonda en esa ventana y su marco efectivo (decisión 63), como en la aplicación
    const contact = probeContact(pose, CONVEX_C35, scene.torso);
    const frame = contact.frame;
    anatomy.setProbeCompression(contact);
    const best = bestGateOnVessel(anatomy, frame, CONVEX_C35, engine.sample, ter.vessels, 170);
    expect(best, `${base.id}: ${ter.kind} sin vaso en la ventana ${ter.window}`).not.toBeNull();
    const gate = gateFor(frame, best!);
    const { r } = best!;
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

/**
 * Capturas sucesivas de la VSH derecha desde la ventana intercostal, cada 2 s, como las hace la
 * pestaña Medir (latidos en torno a t − 3 s, 7 s de espectro), con la puerta quieta. `window`:
 * la puerta busca además ventana acústica (como los ganchos de la e2e), no solo anatomía.
 */
function hepaticCaptures(base: PatientState, respiratoryPattern: RespiratoryPattern, seconds: number, window: boolean, prfHz?: number) {
  const patient = { ...clonePatient(base), respiratoryPattern };
  const scene = new AnatomyScene(patient);
  const anatomy = new AnatomyQuery(scene);
  const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: seconds + 4 });
  const chain = new PwDopplerChain(anatomy, patient.seed);
  for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
  const sp = START_POINTS.find((s) => s.id === 'intercostal')!;
  const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
  const contact = probeContact(pose, CONVEX_C35, scene.torso);
  const frame = contact.frame;
  anatomy.setProbeCompression(contact);
  const weight = window
    ? acousticWindowWeight(anatomy, frame, CONVEX_C35, contact, engine.sample, 180, CONVEX_C35_PROFILE.dopplerEffectiveMHz)
    : undefined;
  const best = bestGateOnVessel(anatomy, frame, CONVEX_C35, engine.sample, ['hvRight'], 170, 1.2, weight)!;
  const gate = gateFor(frame, best);
  const prf = prfHz ?? Math.min(6000, Math.floor((0.9 * 1_540_000) / (2 * best.r)));
  chain.begin(prf, CONVEX_C35.f0Doppler, 0, 25, engine.clock.t + engine.clock.dt);
  const opts = { f0Hz: CONVEX_C35.f0Doppler, angleCorrectionRad: 0, invert: false, fftSize: chain.spectral.fftSize, wallFilterHz: 25 };
  const captures: Array<{ t: number; pattern: string; issue: string | null }> = [];
  let next = engine.clock.t + 8;
  const t0 = engine.clock.t;
  for (let i = 0; engine.clock.t < t0 + seconds; i++) {
    const s = engine.step();
    if (i % 8 === 0) chain.setGate(gate, s);
    chain.step(s, [0, 0, 0], engine.clock.dt);
    if (engine.clock.t < next) continue;
    next += 2;
    chain.flush();
    const tNow = engine.clock.t;
    const beats = engine.rhythm.beatsBetween(tNow - 7, tNow).slice(-CAPTURE_BEATS);
    const m = measureObservedHepatic(
      chain.spectral.columns.filter((c) => c.t > tNow - 7),
      beats,
      opts,
    );
    if (m) captures.push({ t: +tNow.toFixed(1), pattern: m.pattern, issue: m.quality.issue });
  }
  const truth = measurePhysiologyTruth(engine, { fromT: t0 + 4, toT: engine.clock.t });
  return { captures, truth };
}

/**
 * Capturas renales sucesivas cada 2 s desde el punto de partida «Renal», con la puerta en la vena
 * interlobar y la PRF por defecto del equipo (2600 Hz), como las hace la pestaña Medir.
 */
function renalCaptures(base: PatientState, seed: number, seconds: number, prfHz = 2600) {
  const patient = { ...clonePatient(base), respiratoryPattern: 'apnea-expiratory' as const, seed };
  const scene = new AnatomyScene(patient);
  const anatomy = new AnatomyQuery(scene);
  const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: seconds + 4 });
  const chain = new PwDopplerChain(anatomy, patient.seed);
  for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
  const sp = START_POINTS.find((s) => s.id === 'renal')!;
  const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
  const contact = probeContact(pose, CONVEX_C35, scene.torso);
  const frame = contact.frame;
  anatomy.setProbeCompression(contact);
  const best = bestGateOnVessel(anatomy, frame, CONVEX_C35, engine.sample, ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'], 170)!;
  const gate = gateFor(frame, best);
  chain.begin(prfHz, CONVEX_C35.f0Doppler, 0, 25, engine.clock.t + engine.clock.dt);
  const opts = { f0Hz: CONVEX_C35.f0Doppler, angleCorrectionRad: 0, invert: false, fftSize: chain.spectral.fftSize, wallFilterHz: 25 };
  const captures: Array<{ t: number; pattern: string; issue: string | null; vMin: number }> = [];
  let next = engine.clock.t + 8;
  const t0 = engine.clock.t;
  for (let i = 0; engine.clock.t < t0 + seconds; i++) {
    const s = engine.step();
    if (i % 8 === 0) chain.setGate(gate, s);
    chain.step(s, [0, 0, 0], engine.clock.dt);
    if (engine.clock.t < next) continue;
    next += 2;
    chain.flush();
    const tNow = engine.clock.t;
    const beats = engine.rhythm.beatsBetween(tNow - 7, tNow).slice(-CAPTURE_BEATS);
    const m = measureObservedRenal(
      chain.spectral.columns.filter((c) => c.t > tNow - 7),
      beats,
      opts,
    );
    if (m) captures.push({ t: +tNow.toFixed(1), pattern: m.pattern, issue: m.quality.issue, vMin: +m.vMin.toFixed(2) });
  }
  const truth = measurePhysiologyTruth(engine, { fromT: t0 + 4, toT: engine.clock.t });
  return { captures, truth };
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
      // en apnea, con la técnica del operador, las tres capturas pasan el control de calidad
      expect(hepatic!.quality.issue, 'calidad hepática').toBeNull();
      expect(portal!.quality.issue, 'calidad portal').toBeNull();
      expect(renal!.quality.issue, 'calidad renal').toBeNull();
      // mismo patrón / clase que la verdad fisiológica en los tres territorios
      expect(hepatic!.pattern).toBe(truth.hepaticPattern);
      expect(classifyPortal(portal!.pulsatilityFraction)).toBe(classifyPortal(truth.portalPF));
      // la PF medida sobre la envolvente queda a ≤ 8 puntos de la verdad (medido: 17/13, 73/75, 35/36 %)
      expect(Math.abs(portal!.pulsatilityFraction - truth.portalPF)).toBeLessThan(8);
      // Frontera monofásico/bifásico (S = 30 % de D): la envolvente sobrestima algo más las
      // velocidades bajas que las altas, así que si la verdad está a < 0,1 del umbral se
      // acepta la clase vecina (como el «próximo al umbral» de la PF portal)
      const ratio = truth.rvS / truth.rvD;
      const nearRenalThreshold = Math.abs(ratio - 0.3) < 0.1 && ['monophasic', 'biphasic'].includes(truth.renalPattern);
      if (nearRenalThreshold) expect(['monophasic', 'biphasic']).toContain(renal!.pattern);
      else expect(renal!.pattern).toBe(truth.renalPattern);
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

  // Con respiración tranquila el tronco portal (más grueso que la puerta) nunca sale de ella: la
  // medición debe coincidir con la de apnea. Antes el volumen de muestra perdía la sangre en la
  // primera inspiración y no la recuperaba: PF 167 % en el sano y 136 % en el grave.
  for (const base of [NORMAL_ADULT, SEVERE_CONGESTION]) {
    it(`${base.label}: la PF portal con respiración tranquila coincide con la verdad`, () => {
      const portalOnly = TERRITORIES.filter((t) => t.kind === 'portal');
      const { truth, portal } = examine(base, 'quiet', portalOnly);
      expect(portal, 'medición portal').not.toBeNull();
      expect(portal!.quality.issue).toBeNull();
      expect(classifyPortal(portal!.pulsatilityFraction)).toBe(classifyPortal(truth.portalPF));
      // medido: 20/19 % y 73/63 % (la respiración añade variación a la verdad de 10 s)
      expect(Math.abs(portal!.pulsatilityFraction - truth.portalPF)).toBeLessThan(12);
    });
  }

  // A la PRF por defecto (2600 Hz) la envolvente de la vena se hunde 3–6 columnas en su PICO, con la
  // sangre llenando el espectro: el mínimo exacto lo leía como pausa y el sano salía bifásico en
  // todas las capturas de esta semilla (antes, con el cuantil y el 30 %, también). Una columna con
  // sangre en el lado de la vena no puede fijar el mínimo; la vena del sano no se detiene.
  it('Adulto sano, renal a 2600 Hz: el hundimiento del detector en el pico no se lee como pausa', () => {
    const { captures, truth } = renalCaptures(NORMAL_ADULT, 6, 20);
    const tag = JSON.stringify(captures);
    expect(truth.renalPattern).toBe('continuous');
    const valid = captures.filter((c) => c.issue === null);
    expect(valid.length, tag).toBeGreaterThan(4);
    expect(
      valid.filter((c) => c.pattern !== 'continuous'),
      tag,
    ).toEqual([]);
  });

  // La onda D del grave (≈ 34 cm/s) roza el Nyquist a la PRF por defecto (2600 Hz, ±40 cm/s): se
  // pliega, deja su ventana diastólica sin sangre del lado de la vena y ningún latido vale. La calidad
  // decía «el vaso entra y sale de la puerta» (en apnea); ahora dice aliasing: hay que subir la escala.
  it('Congestión grave, renal a 2600 Hz en apnea: no medible por aliasing, no «intermitente»', () => {
    const { captures } = renalCaptures(SEVERE_CONGESTION, SEVERE_CONGESTION.seed, 20);
    const tag = JSON.stringify(captures);
    expect(captures.length, tag).toBeGreaterThan(4);
    expect(
      captures.filter((c) => c.issue === 'intermittent'),
      tag,
    ).toEqual([]);
    expect(captures.filter((c) => c.issue === 'aliasing').length, tag).toBeGreaterThan(0);
  });

  // La interlobar del caso grave entra y sale de la puerta con la respiración: antes se medía
  // «bifásica» (era monofásica); ahora la captura se declara no medible y no entra en el grado.
  it('Congestión grave, interlobar con respiración tranquila: la captura es no medible (intermitente)', () => {
    const renalOnly = TERRITORIES.filter((t) => t.kind === 'renal');
    const { renal } = examine(SEVERE_CONGESTION, 'quiet', renalOnly);
    expect(renal).not.toBeNull();
    expect(renal!.quality.issue).toBe('intermittent');
  });

  // Capturas sucesivas cada 2 s durante 26 s con la puerta quieta, como las haría el alumno: con
  // respiración tranquila la puerta fija ve moverse el vaso y a ratos sale de él o se cuela otro
  // (S invertida en un latido del sano, D invertida en otro). Ninguna captura con el visto bueno de
  // la calidad puede dar un patrón falso. Sin exigir D anterógrada, el sano con ventana daba
  // «grave» con el visto bueno a los 10 s. En apnea, además, la técnica debe servir: la calidad no
  // puede rechazarlo todo (con respiración tranquila puede, y entonces el alumno pide apnea).
  for (const [base, respiration, window] of [
    [NORMAL_ADULT, 'quiet', true],
    [NORMAL_ADULT, 'quiet', false],
    [AF_MODERATE_CONGESTION, 'quiet', true],
    [SEVERE_CONGESTION, 'quiet', true],
    [NORMAL_ADULT, 'apnea-expiratory', true],
    [AF_MODERATE_CONGESTION, 'apnea-expiratory', true],
  ] as const) {
    const apnea = respiration === 'apnea-expiratory';
    it(`${base.label}${window ? ' (puerta con ventana acústica)' : ''}, ${apnea ? 'en apnea' : 'con respiración tranquila'}: cada captura de la VSH es no medible o verdadera`, () => {
      const { captures, truth } = hepaticCaptures(base, respiration, 26, window);
      const tag = JSON.stringify(captures);
      expect(captures.length, tag).toBeGreaterThan(8);
      expect(
        captures.filter((c) => c.issue === null && c.pattern !== truth.hepaticPattern),
        tag,
      ).toEqual([]);
      // En apnea la técnica debe servir. La FA se rechaza de más a propósito (umbral del signo de S
      // sobre D, decisión 49: su S pequeña tiene puntas de signo contrario y el umbral que las
      // ignoraba dejaba pasar una S invertida falsa): basta con un tercio de capturas válidas.
      // Medido: sano 13/13; FA 5/10–8/13 según la realización del moteado espectral.
      const minMeasurable = base === AF_MODERATE_CONGESTION ? 0.3 : 0.8;
      if (apnea) expect(captures.filter((c) => c.issue === null).length / captures.length, tag).toBeGreaterThanOrEqual(minMeasurable);
    });
  }

  // Trampa clínica clásica (§21: el espectrograma responde a PRF y aliasing): con la escala baja el
  // pico S del sano rebasa ±Nyquist, reaparece al otro lado y la medición lee una S invertida,
  // «grave». La calidad debe declararlo aliasing; con la escala adecuada, medible y normal.
  // Medido: PRF 1000–1800 «grave» (antes con el visto bueno a 1000 y 1400); PRF 5000 normal.
  it('Adulto sano: a PRF baja la VSH se pliega e imita la inversión de S, y la calidad lo declara aliasing', () => {
    const low = hepaticCaptures(NORMAL_ADULT, 'apnea-expiratory', 9, false, 1400).captures.at(-1)!;
    expect(low.pattern).toBe('severe');
    expect(low.issue).toBe('aliasing');
    const high = hepaticCaptures(NORMAL_ADULT, 'apnea-expiratory', 9, false, 5000).captures.at(-1)!;
    expect(high).toEqual(expect.objectContaining({ pattern: 'normal', issue: null }));
  });
});
