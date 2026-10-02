import { C_RECONSTRUCTION_MM_S, nyquistVelocityCms } from '../core/units';
import { colorTiming, pwDutyCycle, type ColorTiming } from '../ultrasound/colorTiming';
import { CONVEX_C35_PROFILE, type TransducerProfile } from '../ultrasound/transducerProfile';
import type { ProbeCompression } from '../anatomy/compression';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { DopplerAudio } from '../audio/dopplerAudio';
import { dopplerShiftHz } from '../core/units';
import type { Vec3 } from '../core/vec3';
import { PwDopplerChain } from '../doppler/pwChain';
import { pwGate, type PwGateInfo } from './pwGate';
import type { GateVesselSample } from '../doppler/vesselIdentity';
import type { GateGeometry } from '../doppler/sampleVolume';
import { PhysiologyEngine, type PhysiologySample } from '../physiology/engine';
import type { PatientState } from '../physiology/patientState';
import { probeContact, type ProbeContact } from '../probe/contact';
import { clampPose, defaultPose, probeVelocity, type ProbeFrame, type ProbePose, type Transducer } from '../probe/probe';
import {
  DEFAULT_BMODE,
  DEFAULT_COLOR,
  UltrasoundRenderer,
  type BModeSettings,
  type ColorSettings,
  type GpuPointQuery,
  type PassRepeat,
} from '../ultrasound/renderer';

/**
 * Segundos de composición de la puerta que se guardan: más que los 7 s de una captura. Por tiempo, no por número: la
 * puerta se actualiza en cada cuadro (60 por segundo) y cada 8 pasos.
 */
const GATE_TRACK_SECONDS = 10;

/** Misma pose, campo a campo (el contacto se reutiliza con la sonda quieta). */
function samePose(a: ProbePose, b: ProbePose): boolean {
  return a.phi === b.phi && a.z === b.z && a.lift === b.lift && a.yaw === b.yaw && a.rock === b.rock && a.tilt === b.tilt;
}

/** Ajustes del Doppler pulsado (guía §9, §16). */
export interface PwSettings {
  enabled: boolean;
  /** Cursor: ángulo de línea (rad) y profundidad (mm) del centro de la puerta. */
  theta: number;
  depthMm: number;
  gateMm: number;
  prfHz: number;
  wallFilterHz: number;
  /** Desplazamiento de la línea de base como fracción de PRF (−0,5…0,5). */
  baselineShift: number;
  invert: boolean;
  /** Corrección angular del usuario (rad). */
  angleCorrection: number;
  /** Ganancia espectral (dB). */
  gainDb: number;
  sweepMmS: number;
}

export const DEFAULT_PW: PwSettings = {
  enabled: false,
  theta: 0,
  depthMm: 90,
  gateMm: 4,
  prfHz: 2600,
  wallFilterHz: 25,
  baselineShift: 0,
  invert: false,
  angleCorrection: 0,
  gainDb: 0,
  sweepMmS: 50,
};

/** Modo M (decisión 80): encendido y ángulo de la línea M (rad, el de las líneas del sector). */
export interface MModeSettings {
  enabled: boolean;
  theta: number;
}

export interface EquipmentSettings {
  bmode: BModeSettings;
  color: ColorSettings;
  pw: PwSettings;
  mmode: MModeSettings;
}

/**
 * Opciones de medida de `Simulator.render`, solo para los ganchos de prueba y el banco (la aplicación
 * llama a `render()` sin ellas, así que su comportamiento no cambia):
 *  - `forceColor`: dibuja el cuadro entero con la pasada de color aunque la cadencia física del color
 *    (decisión 39) lo saltaría. Exige la caja encendida: sin ella no hay pasada que forzar.
 *  - `repeat`: repite el dibujo de una pasada dentro del cuadro (`PassRepeat`).
 */
export interface RenderMeasureOptions {
  forceColor?: boolean;
  repeat?: PassRepeat;
}

/** Límites del equipo (deslizadores y atajos comparten estos valores). */
export function defaultEquipment(): EquipmentSettings {
  return {
    bmode: { ...DEFAULT_BMODE, tgcDb: [...DEFAULT_BMODE.tgcDb] },
    color: { ...DEFAULT_COLOR },
    pw: { ...DEFAULT_PW },
    mmode: { enabled: false, theta: 0 },
  };
}

/**
 * Orquestador de un caso: un reloj (el de la fisiología) gobierna latido,
 * respiración, deformación, adquisición IQ, espectro, color, ECG y audio.
 *
 * Responsabilidades separadas (guía §3, §19):
 *  - PhysiologyEngine: estado del paciente y señales continuas;
 *  - AnatomyScene/AnatomyQuery: geometría, deformación y campo de velocidades;
 *  - UltrasoundRenderer: adquisición/imagen en GPU (modo B, color);
 *  - PwDopplerChain: puerta física, IQ, espectro y audio.
 * La UI solo lee estado y modifica sonda y ajustes del equipo; nunca toca el
 * PatientState en marcha salvo maniobras respiratorias explícitas.
 */
export class Simulator {
  readonly patient: PatientState;
  readonly scene: AnatomyScene;
  readonly anatomy: AnatomyQuery;
  readonly physiology: PhysiologyEngine;
  /** Perfil del transductor (geometría, haz, frecuencias efectivas): una sola fuente. */
  readonly profile: TransducerProfile = CONVEX_C35_PROFILE;
  get transducer(): Transducer {
    return this.profile.geometry;
  }
  readonly pwChain: PwDopplerChain;
  renderer: UltrasoundRenderer;
  pose: ProbePose = defaultPose();
  /** Instantánea inmutable que asigna `EquipmentController` (sobrevive a los cambios de caso). */
  equipment: EquipmentSettings = defaultEquipment();
  frozen = false;
  private lastFrame: ProbeFrame;
  /** Contacto de la sonda del cuadro (decisión 63): el marco efectivo (hundido), la compresión y el acoplamiento. */
  private lastContact: ProbeContact;
  private contactPose: ProbePose;
  private lastFrameT = 0;
  private probeVel: Vec3 = [0, 0, 0];
  private lastColorUpdate = -1;
  private lastGate: GateGeometry | null = null;
  /** Información de la puerta para la UI/depuración. */
  gateInfo: PwGateInfo | null = null;
  /** Sangre de cada vaso en el volumen de muestra en cada actualización de la puerta (identidad del vaso, decisión 93). */
  readonly gateTrack: GateVesselSample[] = [];

  /** Salida de audio del navegador; la cadena PW solo ve su interfaz `AudioSink`. */
  readonly audio: DopplerAudio;

  /**
   * `renderer`: el de otro simulador (cambio de caso), que se queda con sus programas compilados y
   * recibe esta escena al FINAL, cuando todo lo demás se ha construido sin errores.
   */
  constructor(patient: PatientState, canvas: HTMLCanvasElement, audio?: DopplerAudio, renderer?: UltrasoundRenderer) {
    this.patient = patient;
    this.audio = audio ?? new DopplerAudio();
    this.scene = new AnatomyScene(patient);
    this.anatomy = new AnatomyQuery(this.scene);
    this.physiology = new PhysiologyEngine(patient, this.scene.vesselAreas());
    this.pwChain = new PwDopplerChain(this.anatomy, patient.seed, this.audio);
    this.lastContact = probeContact(this.pose, this.transducer, this.scene.torso);
    this.lastFrame = this.lastContact.frame;
    this.contactPose = this.pose;
    this.anatomy.setProbeCompression(this.lastContact);
    if (renderer) renderer.setScene(this.scene);
    this.renderer = renderer ?? new UltrasoundRenderer(canvas, this.scene, this.profile);
  }

  // Ajustes de solo lectura: se cambian con comandos (`EquipmentController`), nunca en sitio
  get bmode(): Readonly<BModeSettings> {
    return this.equipment.bmode;
  }
  get color(): Readonly<ColorSettings> {
    return this.equipment.color;
  }
  get pw(): Readonly<PwSettings> {
    return this.equipment.pw;
  }
  get mmode(): Readonly<MModeSettings> {
    return this.equipment.mmode;
  }
  /**
   * Ajustes de la imagen en pantalla: los del equipo o, con un cuadro del cine a la vista (decisión 80), los
   * de ese cuadro (profundidad, foco y caja de color con que se formó).
   */
  get displayed(): { bmode: Readonly<BModeSettings>; color: Readonly<ColorSettings> } {
    return (this.frozen && this.renderer.cineShownFrame) || this.equipment;
  }
  get spectral(): PwDopplerChain['spectral'] {
    return this.pwChain.spectral;
  }
  get sampleVolume(): PwDopplerChain['sampleVolume'] {
    return this.pwChain.sampleVolume;
  }
  get sample(): PhysiologySample {
    return this.physiology.sample;
  }
  /** Marco efectivo de la sonda: el de la pose hundido lo que aprieta el operador (decisión 63). */
  get frame(): ProbeFrame {
    return this.lastFrame;
  }
  /** Contacto de la sonda del último marco (decisión 63): la misma compresión que ven la CPU y la GPU. */
  get contact(): ProbeContact {
    return this.lastContact;
  }
  get probeVelocity(): Vec3 {
    return this.probeVel;
  }

  setPose(p: ProbePose): void {
    this.pose = clampPose(p);
  }

  /** Reconstruye el renderizador tras una pérdida de contexto GPU; el estado del paciente se conserva. */
  rebuildRenderer(canvas: HTMLCanvasElement): void {
    this.renderer.dispose();
    this.renderer = new UltrasoundRenderer(canvas, this.scene, this.profile);
  }

  /**
   * Libera los recursos GPU; el simulador no debe usarse después. Con `keepRenderer` (cambio de
   * caso) el renderizador sigue vivo porque ya lo usa el simulador siguiente.
   */
  dispose(opts: { keepRenderer?: boolean } = {}): void {
    if (!opts.keepRenderer) this.renderer.dispose();
  }

  /** Avanza la simulación el tiempo real transcurrido y genera la IQ correspondiente. */
  advance(elapsedSeconds: number): void {
    if (this.frozen) return;
    const clock = this.physiology.clock;
    const t0 = clock.t;
    const steps = clock.requestSteps(elapsedSeconds);
    if (steps === 0) return;
    // la compresión sigue a la sonda (decisión 63): todo el cuadro (CPU, GPU, puerta) ve el mismo tejido y el
    // mismo marco, el efectivo (la sonda hundida). Con la sonda quieta el contacto no cambia (sale solo de la
    // pose): se reutiliza
    if (!samePose(this.pose, this.contactPose)) {
      this.lastContact = probeContact(this.pose, this.transducer, this.scene.torso);
      this.contactPose = this.pose;
      this.anatomy.setProbeCompression(this.lastContact);
    }
    // Sonda: velocidad estimada entre cuadros (clutter y destello por movimiento)
    const newFrame = this.lastContact.frame;
    const dtFrame = Math.max(1e-3, clock.t - this.lastFrameT + steps * clock.dt);
    const v = probeVelocity(this.lastFrame, newFrame, dtFrame);
    this.probeVel = [v[0] * 0.6, v[1] * 0.6, v[2] * 0.6];
    this.lastFrame = newFrame;
    this.lastFrameT = clock.t;

    const pw = this.pw;
    if (pw.enabled) this.pwChain.begin(pw.prfHz, this.transducer.f0Doppler, pw.gainDb, pw.wallFilterHz, t0 + clock.dt);
    for (let i = 0; i < steps; i++) {
      const s = this.physiology.step();
      if (!pw.enabled) continue;
      if (i === 0 || i % 8 === 0) this.updateGate(s);
      this.pwChain.step(s, this.probeVel, clock.dt);
    }
    if (pw.enabled) this.pwChain.flush();
  }

  /** Geometría de la puerta a partir del cursor PW y la pose actual (`pwGate`, la misma que la cadena del alumno). */
  private updateGate(s: PhysiologySample): void {
    const { gate, info } = pwGate(this.anatomy, this.lastFrame, this.lastContact, this.profile, this.bmode.focusMm, this.pw, s);
    this.pwChain.setGate(gate, s);
    this.lastGate = gate;
    this.gateInfo = info;
    // la sangre que ve la puerta, para la identidad del vaso de una captura (decisión 93)
    this.gateTrack.push({ t: s.t, vessels: this.pwChain.sampleVolume.lastComposition.vessels });
    let old = 0;
    while (old < this.gateTrack.length && this.gateTrack[old].t < s.t - GATE_TRACK_SECONDS) old++;
    if (old > 0) this.gateTrack.splice(0, old);
  }

  /**
   * Cadencia física del color con la caja, PRF y ensemble actuales (decisión 39); en tríplex el PW
   * intercalado se lleva su parte del tiempo de disparo (decisión 66).
   */
  get colorTiming(): ColorTiming {
    const c = this.color;
    const pw = this.pw;
    return colorTiming(
      c.theta0,
      c.theta1,
      c.prfHz,
      c.ensemble,
      this.transducer.lines,
      this.bmode.depthMm,
      C_RECONSTRUCTION_MM_S,
      this.profile.colorLineSpacingRad,
      pw.enabled ? pwDutyCycle(pw.prfHz, pw.depthMm + pw.gateMm / 2, C_RECONSTRUCTION_MM_S) : 0,
    );
  }

  /** Dibuja un cuadro con el estado actual; `measure` solo lo pasan los ganchos de medida. */
  render(measure?: RenderMeasureOptions): void {
    if (this.frozen) return;
    const s = this.sample;
    const t = this.physiology.clock.t;
    // Con color, la imagen entera (B + color) se refresca a la cadencia que permite
    // la caja: cada cuadro de color cuesta líneas × ensemble disparos a la PRF.
    const colorPeriod = this.color.enabled ? 1 / this.colorTiming.frameHz : 0;
    const forceColor = measure?.forceColor === true;
    if (forceColor && !this.color.enabled) throw new Error('render({ forceColor }) exige la caja de color encendida');
    const updateColor = forceColor || t - this.lastColorUpdate >= colorPeriod;
    if (this.color.enabled && !updateColor) return;
    if (updateColor) this.lastColorUpdate = t;
    this.renderer.render(
      {
        sample: s,
        frame: this.lastFrame,
        pose: this.pose,
        compression: this.lastContact,
        transducer: this.transducer,
        caliber: this.anatomy.caliberFor(s),
        probeVelocity: this.probeVel,
        bmode: this.bmode,
        color: this.color,
        updateColor,
        seed: this.patient.seed,
        mline: this.mmode.enabled ? this.mmode.theta : undefined,
      },
      measure?.repeat,
    );
  }

  /**
   * Mapa de tejidos del plano según la GPU (asíncrono; null hasta que haya uno),
   * para el instante indicado (muestra, marco, profundidad): así la comparación
   * TS ↔ GLSL no confunde calibre pulsátil o respiración con desacuerdo.
   * Solo docente/depuración.
   */
  gpuTissueMap(at: { sample: PhysiologySample; frame: ProbeFrame; depthMm: number }): ReturnType<UltrasoundRenderer['tissueMap']> {
    const s = at.sample;
    return this.renderer.tissueMap({
      sample: s,
      frame: at.frame,
      pose: this.pose,
      compression: this.lastContact,
      transducer: this.transducer,
      caliber: this.anatomy.caliberFor(s),
      probeVelocity: this.probeVel,
      bmode: { ...this.bmode, depthMm: at.depthMm },
      color: this.color,
      updateColor: false,
      seed: this.patient.seed,
    });
  }

  /**
   * Consulta la anatomía GLSL en puntos del mundo con el estado fisiológico actual y el
   * plano `frame` (que decide qué tubos entran en la lista por cuadro). Solo para el
   * gate de equivalencia y la e2e de normales (`normals`); bloqueante. `compression`: el contacto de la sonda
   * que deforma el tejido (decisión 63); por omisión, el del último marco.
   */
  gpuQuery(
    points: Float32Array,
    frame: ProbeFrame,
    allTubes = false,
    opts: { normals?: boolean; compression?: ProbeCompression } = {},
  ): GpuPointQuery {
    const s = this.sample;
    return this.renderer.queryPoints(
      points,
      {
        sample: s,
        frame,
        pose: this.pose,
        compression: opts.compression ?? this.lastContact,
        transducer: this.transducer,
        caliber: this.anatomy.caliberFor(s),
        probeVelocity: [0, 0, 0],
        bmode: this.bmode,
        color: this.color,
        updateColor: false,
        seed: this.patient.seed,
      },
      allTubes,
      opts,
    );
  }

  /** Velocidad de Nyquist rotulada (cm/s) para la escala PW actual. */
  pwNyquistCms(): number {
    return nyquistVelocityCms(this.pw.prfHz, this.transducer.f0Doppler, this.pw.angleCorrection);
  }

  /** Frecuencia Doppler física esperada en el centro de la puerta (Hz), para depuración. */
  gateExpectedShiftHz(): number | null {
    if (!this.lastGate) return null;
    const q = this.anatomy.classifyWorld(this.lastGate.center, this.sample);
    if (!q.bloodVelocity) return null;
    const b = this.lastGate.beamDir;
    const v = q.bloodVelocity;
    const vAlong = -(v[0] * b[0] + v[1] * b[1] + v[2] * b[2]);
    return dopplerShiftHz(vAlong, this.transducer.f0Doppler);
  }
}
