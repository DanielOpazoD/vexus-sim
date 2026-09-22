import { nyquistVelocityCms } from '../core/units';
import { apertureAngleSigmaRad, lateralSigmaMm } from '../ultrasound/beamModel';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { TISSUES, attenuationDbPerCm } from '../anatomy/tissues';
import type { DopplerAudio } from '../audio/dopplerAudio';
import { dopplerShiftHz } from '../core/units';
import type { Vec3 } from '../core/vec3';
import { PwDopplerChain } from '../doppler/pwChain';
import type { GateGeometry } from '../doppler/sampleVolume';
import { PhysiologyEngine, type PhysiologySample } from '../physiology/engine';
import type { PatientState } from '../physiology/patientState';
import {
  CONVEX_C35,
  clampPose,
  defaultPose,
  lineDirection,
  pointOnLine,
  probeFrame,
  probeVelocity,
  type ProbeFrame,
  type ProbePose,
  type Transducer,
} from '../probe/probe';
import { DEFAULT_BMODE, DEFAULT_COLOR, UltrasoundRenderer, type BModeSettings, type ColorSettings } from '../ultrasound/renderer';

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

export interface EquipmentSettings {
  bmode: BModeSettings;
  color: ColorSettings;
  pw: PwSettings;
}

/** Límites del equipo (deslizadores y atajos comparten estos valores). */
export const EQUIPMENT_LIMITS = {
  depthMm: { min: 60, max: 240, step: 5 },
  gainDb: { min: -20, max: 20, step: 1 },
} as const;

export function defaultEquipment(): EquipmentSettings {
  return {
    bmode: { ...DEFAULT_BMODE, tgcDb: [...DEFAULT_BMODE.tgcDb] },
    color: { ...DEFAULT_COLOR },
    pw: { ...DEFAULT_PW },
  };
}

const TISSUE_ATTEN_DOPPLER = TISSUES.map((t, i) => ({ gas: t.gas, bone: t.bone, alpha: attenuationDbPerCm(i, 2.5) }));

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
  readonly transducer: Transducer = CONVEX_C35;
  readonly pwChain: PwDopplerChain;
  renderer: UltrasoundRenderer;
  pose: ProbePose = defaultPose();
  equipment: EquipmentSettings = defaultEquipment();
  frozen = false;
  private lastFrame: ProbeFrame;
  private lastFrameT = 0;
  private probeVel: Vec3 = [0, 0, 0];
  private lastColorUpdate = -1;
  private lastGate: GateGeometry | null = null;
  /** Información de la puerta para la UI/depuración. */
  gateInfo: { world: Vec3; transmission: number; beamAngleToFlowDeg: number | null; vessel: string | null } | null = null;

  constructor(patient: PatientState, canvas: HTMLCanvasElement, audio?: DopplerAudio) {
    this.patient = patient;
    this.scene = new AnatomyScene(patient);
    this.anatomy = new AnatomyQuery(this.scene);
    this.physiology = new PhysiologyEngine(patient, this.scene.vesselAreas());
    this.renderer = new UltrasoundRenderer(canvas, this.scene, this.transducer);
    this.pwChain = new PwDopplerChain(this.anatomy, patient.seed, audio);
    this.lastFrame = probeFrame(this.pose, this.scene.torso, this.transducer);
  }

  get bmode(): BModeSettings {
    return this.equipment.bmode;
  }
  get color(): ColorSettings {
    return this.equipment.color;
  }
  get pw(): PwSettings {
    return this.equipment.pw;
  }
  get audio(): DopplerAudio {
    return this.pwChain.audio;
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
  get frame(): ProbeFrame {
    return this.lastFrame;
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
    this.renderer = new UltrasoundRenderer(canvas, this.scene, this.transducer);
  }

  /** Libera los recursos GPU; el simulador no debe usarse después. */
  dispose(): void {
    this.renderer.dispose();
  }

  /** Avanza la simulación el tiempo real transcurrido y genera la IQ correspondiente. */
  advance(elapsedSeconds: number): void {
    if (this.frozen) return;
    const clock = this.physiology.clock;
    const t0 = clock.t;
    const steps = clock.requestSteps(elapsedSeconds);
    if (steps === 0) return;
    // Sonda: velocidad estimada entre cuadros (clutter y destello por movimiento)
    const newFrame = probeFrame(this.pose, this.scene.torso, this.transducer);
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

  /** Geometría de la puerta a partir del cursor PW y la pose actual. */
  private updateGate(s: PhysiologySample): void {
    const fr = this.lastFrame;
    const tr = this.transducer;
    const pw = this.pw;
    const dir = lineDirection(fr, pw.theta);
    const center = pointOnLine(fr, tr, pw.theta, pw.depthMm);
    const c = Math.cos(pw.theta);
    const sn = Math.sin(pw.theta);
    const lateral: Vec3 = [
      fr.lateral[0] * c - fr.axial[0] * sn,
      fr.lateral[1] * c - fr.axial[1] * sn,
      fr.lateral[2] * c - fr.axial[2] * sn,
    ];
    const r = pw.depthMm;
    // Anchura lateral del volumen de muestra = PSF de dos vías (mismo modelo que la imagen)
    const latSigma = lateralSigmaMm(r, this.bmode.focusMm) * 1.2;
    const elevSigma = 1.6 * Math.sqrt(1 + ((r - tr.elevationFocusMm) / 45) ** 2);
    const transmission = this.estimateTransmission(fr, pw.theta, r, s);
    const gate: GateGeometry = {
      center,
      beamDir: dir,
      lateral,
      elevation: fr.elevation,
      lengthMm: pw.gateMm,
      lateralSigmaMm: latSigma,
      elevationSigmaMm: elevSigma,
      pulseSigmaMm: 0.5,
      apertureAngleSigmaRad: apertureAngleSigmaRad(r),
      transmission,
    };
    this.pwChain.setGate(gate, s);
    this.lastGate = gate;
    const q = this.anatomy.classifyWorld(center, s);
    let angle: number | null = null;
    if (q.vesselHit) {
      const t = q.vesselHit.tangent;
      const cosA = Math.abs(t[0] * dir[0] + t[1] * dir[1] + t[2] * dir[2]);
      angle = (Math.acos(Math.min(1, cosA)) * 180) / Math.PI;
    }
    this.gateInfo = { world: center, transmission, beamAngleToFlowDeg: angle, vessel: q.vessel };
  }

  /** Transmisión aproximada hasta la puerta (marcha CPU gruesa a la frecuencia Doppler). */
  private estimateTransmission(fr: ProbeFrame, theta: number, rEnd: number, s: PhysiologySample): number {
    const step = 2.5;
    let attenDb = 0;
    let entered = false;
    const n = Math.ceil(rEnd / step);
    for (let i = 0; i < n; i++) {
      const rr = (i + 0.5) * step;
      const p = pointOnLine(fr, this.transducer, theta, rr);
      const q = this.anatomy.classifyWorld(p, s);
      const props = TISSUE_ATTEN_DOPPLER[q.tissue];
      if (q.tissue === 0 && !entered) continue; // gel de acoplamiento
      entered = true;
      if (props.gas) attenDb += 60 * (step / 10);
      else if (props.bone) attenDb += 6 + 2 * props.alpha * (step / 10);
      else attenDb += 2 * props.alpha * (step / 10);
    }
    return Math.pow(10, -attenDb / 20);
  }

  /** Dibuja un cuadro con el estado actual. */
  render(): void {
    if (this.frozen) return;
    const s = this.sample;
    const t = this.physiology.clock.t;
    const colorPeriod = 1 / 15;
    const updateColor = t - this.lastColorUpdate >= colorPeriod;
    if (updateColor) this.lastColorUpdate = t;
    this.renderer.render({
      sample: s,
      frame: this.lastFrame,
      pose: this.pose,
      transducer: this.transducer,
      caliber: this.anatomy.caliberFor(s),
      probeVelocity: this.probeVel,
      bmode: this.bmode,
      color: this.color,
      updateColor,
      seed: this.patient.seed,
    });
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
      transducer: this.transducer,
      caliber: this.anatomy.caliberFor(s),
      probeVelocity: this.probeVel,
      bmode: { ...this.bmode, depthMm: at.depthMm },
      color: this.color,
      updateColor: false,
      seed: this.patient.seed,
    });
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
