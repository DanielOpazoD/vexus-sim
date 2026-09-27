import { bestGateOnVessel, type GatePlacement } from '../../app/gatePlacement';
import { acousticWindowWeight } from '../../app/gateTransmission';
import { pwGate } from '../../app/pwGate';
import { START_POINTS, type StartPoint } from '../../app/startPoints';
import { AnatomyQuery } from '../../anatomy/query';
import { AnatomyScene } from '../../anatomy/scene';
import { captureProtocolVessel, type CaptureResult } from '../../doppler/capture';
import { PwDopplerChain } from '../../doppler/pwChain';
import type { MeasureOptions } from '../../doppler/spectralMeasure';
import type { GateVesselSample, ProtocolVessel } from '../../doppler/vesselIdentity';
import { PhysiologyEngine } from '../../physiology/engine';
import { clonePatient, type PatientState, type RespiratoryPattern } from '../../physiology/patientState';
import type { VesselId } from '../../physiology/vessels';
import { probeContact, type ProbeContact } from '../../probe/contact';
import { CONVEX_C35_PROFILE } from '../../ultrasound/transducerProfile';
import { DEFAULT_BMODE } from '../../ultrasound/renderer';

/**
 * Cadena del alumno por la RUTA DE LA APLICACIÓN (decisión 93): la geometría de la puerta sale de `pwGate` (la misma
 * que `Simulator.updateGate`, con la transmisión real hasta la puerta y el acoplamiento del contacto), la puerta se
 * actualiza una vez por «cuadro» de 8 pasos (la aplicación lo hace en cada cuadro y cada 8 pasos), la sangre del volumen de muestra alimenta la identidad del vaso y
 * la captura es `captureProtocolVessel`, la de «Capturar». Antes `examChain.test.ts` usaba una copia de la puerta con la
 * transmisión fija en 0,3 (−10 dB; la real es −29 a −32 dB en la porta) y medía a la PRF máxima: la PF dependiente de
 * la escala no se veía.
 */
export const PROFILE = CONVEX_C35_PROFILE;
export const TR = PROFILE.geometry;

export interface ChainSession {
  patient: PatientState;
  scene: AnatomyScene;
  anatomy: AnatomyQuery;
  engine: PhysiologyEngine;
  chain: PwDopplerChain;
}

/** Paciente, anatomía, fisiología (tras 2 s de transitorio) y cadena PW con la semilla del paciente. */
export function openSession(base: PatientState, respiratoryPattern: RespiratoryPattern, seedOffset = 0, historySeconds = 14): ChainSession {
  const patient = { ...clonePatient(base), respiratoryPattern, seed: base.seed + seedOffset };
  const scene = new AnatomyScene(patient);
  const anatomy = new AnatomyQuery(scene);
  const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds });
  const chain = new PwDopplerChain(anatomy, patient.seed);
  for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
  return { patient, scene, anatomy, engine, chain };
}

/** La sonda en un punto de partida con su compresión (decisión 63), como `goToStartPoint`. */
export function probeAt(session: ChainSession, window: StartPoint['id']): ProbeContact {
  const sp = START_POINTS.find((s) => s.id === window)!;
  const pose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
  const contact = probeContact(pose, TR, session.scene.torso);
  session.anatomy.setProbeCompression(contact);
  return contact;
}

/**
 * Técnica del operador (`bestGateOnVessel`): dentro de la luz y con el mejor ángulo; con `acoustic` (por defecto), además
 * ventana acústica, como el gancho `placeGate` de la e2e. La profundidad máxima por defecto es la de la imagen menos 5 mm.
 */
export function placeGate(
  session: ChainSession,
  contact: ProbeContact,
  vessels: readonly VesselId[],
  o: { acoustic?: boolean; maxDepthMm?: number } = {},
): GatePlacement | null {
  const { anatomy, engine } = session;
  const weight =
    o.acoustic === false
      ? undefined
      : acousticWindowWeight(anatomy, contact.frame, TR, contact, engine.sample, DEFAULT_BMODE.depthMm, PROFILE.dopplerEffectiveMHz);
  return bestGateOnVessel(anatomy, contact.frame, TR, engine.sample, vessels, o.maxDepthMm ?? DEFAULT_BMODE.depthMm - 5, 1.2, weight);
}

export interface AcquireOptions {
  prfHz: number;
  /** Longitud de la puerta (mm): la del equipo por defecto, 4. */
  gateMm?: number;
  gainDb?: number;
  wallFilterHz?: number;
  seconds: number;
  /** Capturas cada `every` s a partir de `firstAt` s (como pulsa el alumno «Capturar» con la puerta quieta). */
  captureEvery?: number;
  firstAt?: number;
}

/**
 * Adquiere con la puerta quieta en `best` y captura `kind` al final (o cada `captureEvery` s). Devuelve las capturas y el
 * registro de la sangre de la puerta.
 */
export function acquire<K extends ProtocolVessel>(
  session: ChainSession,
  contact: ProbeContact,
  best: GatePlacement,
  kind: K,
  o: AcquireOptions,
): { captures: Array<{ t: number; m: CaptureResult[K] | null }>; track: GateVesselSample[] } {
  const { engine, chain, anatomy } = session;
  const cursor = { theta: best.theta, depthMm: best.r, gateMm: o.gateMm ?? 4 };
  const gainDb = o.gainDb ?? 0;
  const wallFilterHz = o.wallFilterHz ?? 25;
  const opts: MeasureOptions = {
    f0Hz: TR.f0Doppler,
    angleCorrectionRad: 0,
    invert: false,
    fftSize: chain.spectral.fftSize,
    wallFilterHz,
    gainDb,
  };
  const track: GateVesselSample[] = [];
  const captures: Array<{ t: number; m: CaptureResult[K] | null }> = [];
  chain.reset();
  const t0 = engine.clock.t;
  let next = t0 + (o.captureEvery !== undefined ? (o.firstAt ?? 8) : o.seconds);
  // un «cuadro» de 8 pasos (32 ms): begin, la puerta actualizada en el primero, flush (en la app, `Simulator.advance`)
  while (engine.clock.t < t0 + o.seconds - 1e-9) {
    chain.begin(o.prfHz, TR.f0Doppler, gainDb, wallFilterHz, engine.clock.t + engine.clock.dt);
    for (let i = 0; i < 8; i++) {
      const s = engine.step();
      if (i === 0) {
        const { gate } = pwGate(anatomy, contact.frame, contact, PROFILE, DEFAULT_BMODE.focusMm, cursor, s);
        chain.setGate(gate, s);
        track.push({ t: s.t, vessels: chain.sampleVolume.lastComposition.vessels });
      }
      chain.step(s, [0, 0, 0], engine.clock.dt);
    }
    chain.flush();
    if (engine.clock.t + 1e-9 >= next) {
      const tNow = engine.clock.t;
      captures.push({ t: +tNow.toFixed(2), m: captureProtocolVessel(kind, chain.spectral.columns, engine.rhythm, tNow, opts, track) });
      if (o.captureEvery === undefined) break;
      next += o.captureEvery;
    }
  }
  return { captures, track };
}
