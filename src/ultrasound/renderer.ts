import { BOWEL_NODES, BOWEL_BOUNDS, BOWEL_GROUPS, BOWEL_ARC } from '../anatomy/organs/bowel';
import { CARTILAGE_ROWS } from '../anatomy/referenceCartilageData';
import type { AnatomyScene, VesselCaliber } from '../anatomy/scene';
import { VESSEL_META } from '../physiology/vessels';
import { Tissue } from '../anatomy/tissues';
import { Interface, interfaceOfVessel } from '../anatomy/interfaces';
import { TISSUES, TISSUE_COUNT, attenuationDbPerCm } from '../anatomy/tissues';
import type { PhysiologySample } from '../physiology/engine';
import type { ProbeCompression } from '../anatomy/compression';
import { contactCoupling } from '../probe/contact';
import { lineAngle, type ProbeFrame, type ProbePose, type Transducer } from '../probe/probe';
import type { TransducerProfile } from './transducerProfile';
import { COLOR_PACKET_MM, colorLineCount } from './colorTiming';
import { beamToPixel, pixelToBeam, sectorLayout, type SectorLayout } from './sectorGeometry';
import { GREY_CURVE, greyOfLevel } from './greyMap';
import { axialSigmaMm, focalReferenceFwhmMm, txApertureMm } from './beamModel';
import { ANCHOR_SALT_STEP, ElevationAnchor } from './speckleField';
import { interfaceUniforms } from './interfaceEcho';
import {
  GLProgram,
  bindTarget,
  bindTargetFor,
  createTarget,
  createTexture,
  deleteTarget,
  drawFullscreen,
  setActiveOutputs,
  type RenderTarget,
  type TargetFormat,
} from './gl';
import { GpuPassTimer, summarizeGpuTimings, type GpuFrameTimings } from './gpuTimer';
import { RECEIVER_NOISE, RECEIVER_NOISE_FRAMES } from './receiver';
import { ELEV_SIGMA0_MM } from './pleura';
import { CLUTTER, clutterParams, type ClutterParams } from './clutter';
import { harmonicNearUniform, noiseGain, transientGain } from './harmonic';
import { refractionBeam } from './aperture';
import { bmodeBeam, bmodeTxApertureMm } from './transducerProfile';
import { FRAME_PASSES, type PassId } from './passGraph';
import { CompoundRing, compoundActive, lookTheta, type CompoundLook } from './compound';
import { CINE_FRAMES, CineRing, persistenceReplay } from './cine';
import { M_COLUMNS, M_SAMPLES, MColumnRing, mLineU } from './mmode';
import { lookWavenumber } from './steering';
import type { SegmentGrid } from './transmission';
import {
  BODY_BASE,
  RIB_BASE,
  RIB_TEXELS,
  CARTILAGE_BASE,
  COMPRESSION_BASE,
  BOWEL_BASE,
  MAX_NODES,
  MAX_TUBES,
  MAX_TUBE_SEGMENTS,
  NODE_BASE,
  TUBE_HEADER_TEXELS,
  SCENE_TEX_H,
  SCENE_TEX_W,
} from '../anatomy/gpu/anatomy.glsl';
import { ribAnteriorEndX, ribShape, tubeShapeTexel } from '../anatomy/primitives';
import { evaluateSceneUniforms, uploadSceneUniforms, type SceneUniformValues } from '../anatomy/gpu/sceneUniforms';
import {
  FRAG_AXIAL,
  FRAG_BLIT,
  FRAG_COLOR,
  FRAG_COMPOUND,
  FRAG_LATERAL,
  FRAG_MLINE,
  FRAG_MSTRIP,
  FRAG_PERSIST,
  FRAG_RAWFIELD,
  FRAG_RAWFIELD_STEERED,
  FRAG_SCANCONVERT,
  FRAG_TISSUEMAP,
  FRAG_QUERY,
  FRAG_TRIAD_QUERY,
  FRAG_TRANS_HITS,
  FRAG_TRANS_PREFIX,
  FRAG_TRANS_PREFIX_STEERED,
  FRAG_TRANS_SEGMENTS,
  FRAG_TRANSMISSION,
  FRAG_TRANSMISSION_STEERED,
  TISSUE_VEC4,
  VERT,
} from './shaders/passes.glsl';
import type { Vec3 } from '../core/vec3';

/** Ajustes del ecógrafo que afectan a la formación de imagen (guía §16). */
export interface BModeSettings {
  depthMm: number;
  focusMm: number;
  gainDb: number;
  tgcDb: readonly number[]; // 8 bandas
  dynamicRangeDb: number;
  persistence: number; // 0–0.8
  /**
   * Composición espacial (decisión 58): tres miradas (0, ±θ) intercaladas, una por cuadro, promediadas
   * en lineal. Solo se forma con el color apagado (`compoundActive`).
   */
  compound: boolean;
  /**
   * Armónica tisular (decisión 77, `harmonic.ts`): emisión a 1,75 MHz e imagen con el armónico de 3,5 MHz.
   * Solo cambia el modo B; el color y el PW siguen en fundamental.
   */
  harmonic: boolean;
}

/** Imagen mostrada leída de la GPU (`readDisplay`): gris 0–255, fila 0 arriba. */
export interface DisplayFrame {
  width: number;
  height: number;
  gray: Uint8Array;
}

export interface ColorSettings {
  enabled: boolean;
  /** Cuadro en coordenadas de haz: ángulos (rad) y profundidades (mm). */
  theta0: number;
  theta1: number;
  r0: number;
  r1: number;
  prfHz: number;
  wallFilterHz: number;
  /** Ganancia de color (dB sobre la referencia `COLOR_GAIN_REF`). */
  gainDb: number;
  invert: boolean;
  ensemble: number;
}

export const DEFAULT_BMODE: BModeSettings = {
  depthMm: 180, // abdomen adulto: VCI y confluencia de suprahepáticas a 12–16 cm

  focusMm: 90,
  gainDb: 0,
  tgcDb: [0, 0, 0, 0, 0, 0, 0, 0],
  // preajuste abdominal (decisión 53): 70 dB, como el equipo moderno de referencia
  dynamicRangeDb: 70,
  persistence: 0.35,
  compound: true,
  // La física calibrada de las pruebas es la del fundamental; la aplicación arranca en armónica
  // (decisión 77, `main.ts`), como un equipo abdominal moderno, salvo en la e2e.
  harmonic: false,
};

/**
 * Nivel de referencia de la presentación (dB): con 0 dB de ganancia y el rango por defecto deja el
 * hígado a media escala (mediana ≈ 100 de gris, como en los equipos reales; decisión 53). Con −20 dB
 * y 60 dB quedaba en 141–147, con el contraste de un moteado crudo.
 */
export const DISPLAY_REF_DB = -33;

/**
 * Prioridad del color: gris del modo B por encima del cual no se pinta el color (en un equipo es un
 * umbral de gris). Se calibra para bloquear el mismo tejido que antes del preajuste: el que queda
 * 6 dB por encima del nivel de referencia con la ganancia y el rango por defecto (0,62 con el
 * preajuste anterior).
 */
export const COLOR_PRIORITY_GREY = greyOfLevel((6 + DISPLAY_REF_DB + DEFAULT_BMODE.dynamicRangeDb) / DEFAULT_BMODE.dynamicRangeDb);

export const DEFAULT_COLOR: ColorSettings = {
  enabled: false,
  theta0: -0.25,
  theta1: 0.25,
  r0: 60,
  r1: 120,
  prfHz: 2000,
  wallFilterHz: 60,
  gainDb: 0,
  invert: false,
  ensemble: 8,
};

/**
 * Compensación nominal del equipo (dB/cm de ida y vuelta): la atenuación del hígado a la frecuencia B
 * efectiva (MHz). La suma la pasada de escaneo (`uNominalTgcDbPerCm`) y el banco de fidelidad la aplica
 * a la envolvente para comparar una cara con el hígado de su entorno a la misma escala.
 */
export function nominalTgcDbPerCm(fMHz: number): number {
  return 2 * attenuationDbPerCm(Tissue.Liver, fMHz);
}

/** Margen del sector en el lienzo de imagen (px); el corte usa el mismo módulo con su propio margen. */
export const DISPLAY_MARGIN_PX = 8;
/**
 * Techo de la compensación nominal + TGC (dB): ganancia máxima del amplificador. Con
 * 3 dB/cm de ida y vuelta (hígado a 2,5 MHz) compensa por completo hasta ~17 cm; más allá la
 * imagen se oscurece y el ruido gana, como en un convexo real al límite de penetración.
 */
const TGC_CAP_DB = 50;
const FINE_DEPTH = 1024;
/** Muestras gruesas en profundidad de la transmisión (pasada A). */
export const COARSE_DEPTH = 160;
const COLOR_W = 96;
/** Umbral de potencia para pintar una celda de color (unidades de sangre a transmisión 1). */
export const COLOR_DISPLAY_THRESHOLD = 0.0035;
/**
 * Ganancia lineal del color a 0 dB del deslizador. Calibrada con GPU real (ruido puro con la sonda
 * levantada; factor ×1 → celdas con color): 0 % hasta ×1 +14 dB, 0,11 % a +18, 4,8 % a +22, 29 % a
 * +26, 64 % a +30. Con ×2 (+6 dB) el 0 dB muestra la suprahepática desde la ventana intercostal
 * (−18 dB de transmisión: 1 400 celdas; con ×1, 32) sin una sola celda de ruido, y el máximo del
 * deslizador (+24 dB) llena de ruido el 64 % de la caja, como un equipo real al límite.
 */
export const COLOR_GAIN_REF = 2;
const COLOR_H = 160;
const MAP_W = 96;
const MAP_H = 128;

export interface FrameInputs {
  sample: PhysiologySample;
  frame: ProbeFrame;
  pose: ProbePose;
  /**
   * Contacto de la sonda del cuadro (decisión 63, `probe/contact.ts`): la compresión del tejido (uniforms
   * `uComp*`, la misma que la CPU en `AnatomyQuery`) y el acoplamiento por línea.
   */
  compression: ProbeCompression;
  transducer: Transducer;
  caliber: VesselCaliber;
  probeVelocity: Vec3;
  bmode: BModeSettings;
  color: ColorSettings;
  /** Actualizar el cuadro de color en este fotograma (cadencia propia del equipo). */
  updateColor: boolean;
  seed: number;
  /** Modo M (decisión 80): ángulo de la línea M, que el cuadro copia a la franja; sin él, nada. */
  mline?: number;
}

/**
 * Cuadro del cine (decisión 80): su instante, los ajustes con que se formó y se mostró (instantáneas inmutables
 * del equipo) y el cuadro de color que pintó G (con él, su capa de color está en el anillo).
 */
export interface CineFrame {
  t: number;
  /** Cuadro dibujado (`frameCount`): entre dos guardados puede haber varios, y la persistencia los pesa todos. */
  n: number;
  bmode: BModeSettings;
  color: ColorSettings;
  colorFrame: { box: [number, number, number, number]; prf: number } | null;
}

/**
 * Repetición de una pasada dentro del cuadro, solo para medir su coste (`frameCostMs`; la aplicación no
 * la pasa nunca): tras dibujar la pasada se emite su mismo dibujo `times` veces más, con el programa,
 * los uniforms y las texturas que dejó puestos, en destinos de prueba con el tamaño y los formatos de su
 * salida, alternando dos: cada repetición es su propio pase de render, que una GPU de teselas no puede
 * descartar (ver `drawRepeats`). La salida real no se toca, así que el cuadro no cambia; el coste de la
 * pasada sale por diferencia del tiempo de pared, también en Metal, donde el temporizador no separa las
 * pasadas (decisión 47).
 */
export interface PassRepeat {
  pass: PassId;
  times: number;
}

/**
 * Resultado de `queryPoints`: tejido, índice de tubo (−1 sin vaso), velocidad de la sangre (mm/s), la
 * cara de interfaz que dibuja cada punto y su distancia (`Cls.iface`, `Cls.ifd`; decisión 57) y, si se
 * pidió, el gradiente de esa cara que usa el eco (`faceGradient`, marco material): la normal unitaria
 * (xyz por punto) y su norma (con la que el eco pasa `ifd` a distancia por la normal).
 */
export interface GpuPointQuery {
  tissue: Int32Array;
  vessel: Int32Array;
  velocity: Float32Array;
  iface: Int32Array;
  ifd: Float32Array;
  normal?: Float32Array;
  gradNorm?: Float32Array;
}

/** Envolvente detectada leída de la GPU (solo pruebas): `data[muestra · lines + línea]`. */
export interface EnvelopeRead {
  lines: number;
  samples: number;
  data: Float32Array;
}

/**
 * Transmisión de la pasada A de una mirada (solo pruebas, `readTransmission`), por línea × profundidad
 * gruesa (fila k a (k + 0,5)·profundidad/COARSE_DEPTH): la de un solo rayo, la de la apertura y la
 * profundidad del espejo (−1 sin espejo hasta esa fila). En una mirada dirigida (decisión 58) son las de su
 * camino, que llega a la celda de la rejilla común: el espejo, en mm a lo largo del camino, y además el
 * prefijo de A2 (dB) y el primer gas del camino.
 */
export interface TransmissionRead {
  lines: number;
  samples: number;
  single: Float32Array;
  aperture: Float32Array;
  mirrorHit: Float32Array;
  /**
   * La de los ecos especulares (A o2.w, decisión 91): la de la mirada del cuadro, así que la de la mirada 0 solo tras un
   * cuadro suyo (si no, falta).
   */
  specular?: Float32Array;
  /** Mirada (índice del anillo) y su θ (rad). */
  look: number;
  theta: number;
  prefixDb?: Float32Array;
  sGas?: Float32Array;
}

/** Composición espacial tras el último cuadro (`compoundState`, decisión 58). */
export interface CompoundState {
  /** Regla de actividad del último cuadro (`compoundActive`). */
  active: boolean;
  /** Mirada que formó el último cuadro (índice del anillo; la 0 es la mirada 0) y su θ (rad). */
  look: number;
  theta: number;
  /** Ranuras válidas del anillo y cuántas. */
  valid: readonly boolean[];
  validCount: number;
  /** Reinicios del anillo contados desde la creación del renderizador. */
  resets: number;
}

/**
 * Los dos programas de una pasada con miradas (A2, A y B; decisión 58), de una sola fuente: el de la mirada 0
 * (θ = 0; el de antes de la composición, sin nada de la dirigida) y el de las miradas ±θ. Se elige uno por
 * cuadro (`lookProgram`). Con uno solo y la rama dirigida detrás de `uSteer.x != 0`, B costaba ~2 ms más
 * por cuadro en el M4 aun con el compuesto apagado.
 */
interface LookPrograms {
  look0: GLProgram;
  steered: GLProgram;
}

export class UltrasoundRenderer {
  readonly gl: WebGL2RenderingContext;
  private pTransHits: GLProgram;
  private pTransSeg: GLProgram;
  private pTransPre: LookPrograms;
  private pTrans: LookPrograms;
  private pRaw: LookPrograms;
  private pAxial: GLProgram;
  private pLateral: GLProgram;
  private pCompound: GLProgram;
  private pColor: GLProgram;
  private pScan: GLProgram;
  private pPersist: GLProgram;
  private pBlit: GLProgram;
  private pMap: GLProgram;
  private pMLine: GLProgram;
  private pMStrip: GLProgram;
  private pQuery: GLProgram | null = null;
  private pTriadQuery: GLProgram | null = null;
  /** Tiempo de GPU por pasada (asíncrono; null sin la extensión). */
  private readonly timer: GpuPassTimer<PassId>;
  private sceneValues: SceneUniformValues = [];
  private sceneValuesFor: FrameInputs['sample'] | null = null;
  private sceneValuesCompression: ProbeCompression | null = null;
  private sceneValuesTubes = -1;
  private tMap: RenderTarget;
  private mapPixels = new Uint8Array(0);
  private mapPbo: WebGLBuffer | null = null;
  private mapPending: { sync: WebGLSync; pbo: WebGLBuffer } | null = null;
  private mapLast: { width: number; height: number; tissue: Uint8Array; vessel: Int8Array } | null = null;
  /** Pasada A en cuatro etapas (decisión 54): impactos por línea, segmentos, suma y apertura. */
  private tHits: RenderTarget;
  private tSeg: RenderTarget;
  private tPre: RenderTarget;
  private tTrans: RenderTarget;
  private tRaw: RenderTarget;
  private tAxial: RenderTarget;
  /**
   * Anillo de miradas (decisión 58): la envolvente de D de cada mirada, en su ranura; K compone las válidas
   * en `tEnv`, la que convierte G.
   */
  private readonly tEnvLooks: RenderTarget[];
  private tEnv: RenderTarget;
  private tColor: RenderTarget;
  private tScan: RenderTarget | null = null;
  private tPersist: [RenderTarget, RenderTarget] | null = null;
  private persistIndex = 0;
  /**
   * Destinos de prueba de `PassRepeat`, dos por pasada. Solo existen si se ha pedido medir con
   * repeticiones (`frameCostMs`); `dispose` los libera.
   */
  private repeatTargets = new Map<PassId, [RenderTarget, RenderTarget]>();
  private couplingTex: WebGLTexture;
  private couplingData: Float32Array;
  private frameCount = 0;
  /** Adquisición intercalada de la composición espacial (decisión 58): una mirada por cuadro. */
  private readonly ring: CompoundRing;
  /** Mirada del último cuadro (null antes del primero) y la regla de actividad con que se formó. */
  private look: CompoundLook | null = null;
  private lookActive = false;
  /** Número de onda de ida y vuelta de la fase de mirada (4π/λ, rad/mm). */
  private readonly k2: number;
  /** Ancla del medio de dispersores (decisión 55): fija con la sonda, se renueva con giros grandes. */
  private readonly speckleAnchor = new ElevationAnchor();
  private lastAnchorWeight = 1;
  /** Peso del fundido del ancla en el último cuadro (1 fuera del fundido). Solo pruebas. */
  get speckleAnchorWeight(): number {
    return this.lastAnchorWeight;
  }
  /** Textura de datos de la escena (cabeceras de tubos + nodos, decisión 24). */
  private sceneTex: WebGLTexture;
  private sceneData = new Float32Array(SCENE_TEX_W * SCENE_TEX_H * 4);
  /** Cabeceras de TODOS los tubos (`TUBE_HEADER_TEXELS` texels cada una); por cuadro se suben solo las del plano. */
  private headerAll = new Float32Array(MAX_TUBES * TUBE_HEADER_TEXELS * 4);
  private tubeCount = 0;
  private tubeCountTotal = 0;
  /** Tablas por tejido de 4 en 4 (`TISSUE_VEC4` vec4; el relleno tras el último tejido queda a 0). */
  private alpha = new Float32Array(TISSUE_VEC4 * 4);
  private back = new Float32Array(TISSUE_VEC4 * 4);
  private clump = new Float32Array(TISSUE_VEC4 * 4);
  private flags = new Float32Array(TISSUE_VEC4 * 4);
  /** Número de onda del perfil (2π/λ, 1/mm) y un vec4 por cara de interfaz (decisión 57). */
  private readonly ifaceK0: number;
  private readonly ifaceUniforms: Float32Array;
  private lastColorFrame: { box: [number, number, number, number]; prf: number } | null = null;
  /** Geometría de presentación del último cuadro (px). */
  display: SectorLayout = { apexX: 0, apexY: 0, scale: 1, width: 1, height: 1 };
  /**
   * Cine (decisión 80): anillo de cuadros en la GPU antes de la conversión de barrido, en dos texturas de capas
   * que se crean con el primer cuadro que las usa: la envolvente compuesta (R16F) y el campo de color (RG16F).
   */
  private readonly cine = new CineRing<CineFrame>();
  private cineEnv: WebGLTexture | null = null;
  private cineColor: WebGLTexture | null = null;
  private cineFbo: WebGLFramebuffer | null = null;
  /** Último cuadro dibujado en vivo y si la historia de la persistencia es aún la suya (tamaño del lienzo). */
  private lastFrame: CineFrame | null = null;
  private liveValid = false;
  /** Cuadro del cine en pantalla (índice y tamaño del lienzo): null en vivo. */
  private cineShown: { index: number; w: number; h: number } | null = null;
  /** Destino que muestra la pantalla (el que lee `readDisplay`). */
  private presented: RenderTarget | null = null;
  /** `tEnv` y `tColor` tienen aún el último cuadro en vivo (el cine no los ha reescrito). */
  private envIsLive = false;
  /**
   * Modo M (decisión 80): la franja en la GPU, un anillo de columnas (R8, ranura × fila) con sus instantes, y la
   * ranura de cada píxel de la franja en pantalla (R32F, se sube en cada dibujo).
   */
  readonly mStrip = new MColumnRing();
  private tMStrip: RenderTarget | null = null;
  private mSlots = new Float32Array(0);
  private mSlotsTex: WebGLTexture | null = null;

  /** Número de líneas del sector (viene del transductor; fija el ancho de las texturas). */
  readonly lines: number;

  /** Escena que se dibuja; `setScene` la cambia sin recompilar los programas. */
  get scene(): AnatomyScene {
    return this.currentScene;
  }

  constructor(
    readonly canvas: HTMLCanvasElement,
    private currentScene: AnatomyScene,
    readonly profile: TransducerProfile,
  ) {
    this.lines = profile.geometry.lines;
    this.ring = new CompoundRing(profile.compound);
    this.k2 = lookWavenumber(profile.beam);
    this.ifaceK0 = (2 * Math.PI) / profile.beam.lambdaMm;
    this.ifaceUniforms = interfaceUniforms(this.ifaceK0);
    const LINES = this.lines;
    this.couplingData = new Float32Array(LINES);
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 no disponible');
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float no disponible');
    gl.getExtension('OES_texture_float_linear');
    // compilación en hilos de fondo del navegador (opcional; sin ella, el mismo lote en serie): se pide antes
    // de compilar, y `linkAll` encarga todos los programas antes de comprobar ninguno (decisión 58)
    gl.getExtension('KHR_parallel_shader_compile');
    this.timer = new GpuPassTimer<PassId>(gl);
    const p = GLProgram.linkAll(gl, VERT, {
      transmissionHits: FRAG_TRANS_HITS,
      transmissionSegments: FRAG_TRANS_SEGMENTS,
      transmissionPrefix: FRAG_TRANS_PREFIX,
      transmissionPrefixSteered: FRAG_TRANS_PREFIX_STEERED,
      transmission: FRAG_TRANSMISSION,
      transmissionSteered: FRAG_TRANSMISSION_STEERED,
      rawfield: FRAG_RAWFIELD,
      rawfieldSteered: FRAG_RAWFIELD_STEERED,
      axial: FRAG_AXIAL,
      lateral: FRAG_LATERAL,
      compound: FRAG_COMPOUND,
      color: FRAG_COLOR,
      scanconvert: FRAG_SCANCONVERT,
      persist: FRAG_PERSIST,
      blit: FRAG_BLIT,
      tissuemap: FRAG_TISSUEMAP,
      mline: FRAG_MLINE,
      mstrip: FRAG_MSTRIP,
    });
    this.pTransHits = p.transmissionHits;
    this.pTransSeg = p.transmissionSegments;
    this.pTransPre = { look0: p.transmissionPrefix, steered: p.transmissionPrefixSteered };
    this.pTrans = { look0: p.transmission, steered: p.transmissionSteered };
    this.pRaw = { look0: p.rawfield, steered: p.rawfieldSteered };
    this.pAxial = p.axial;
    this.pLateral = p.lateral;
    this.pCompound = p.compound;
    this.pColor = p.color;
    this.pScan = p.scanconvert;
    this.pPersist = p.persist;
    this.pBlit = p.blit;
    this.pMap = p.tissuemap;
    this.pMLine = p.mline;
    this.pMStrip = p.mstrip;
    const f = { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.LINEAR };
    const f2 = { internal: gl.RG32F, format: gl.RG, type: gl.FLOAT, filter: gl.LINEAR };
    const f1 = { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, filter: gl.LINEAR };
    // impactos y segmentos se leen con texelFetch (NEAREST: nunca interpolar profundidades de impacto);
    // la transmisión final: 0 = (ida y vuelta con apertura, impactos), 1 = (dirección, tipo de gas),
    // 2 = un solo rayo (color y PW; en .z y .w, la fracción del haz que sobrevive a los huesos de la mirada 0 y de la
    // dirigida, que lee D para su pedestal, decisión 88), 3 = la mirada dirigida del cuadro (decisión 58; su .x se
    // interpola como la 0); la suma A2, además, el prefijo de esa mirada (2 y 3)
    const fn = { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST };
    // A0: espejo e impactos (0 y 1) y la pleura parietal de cada línea (2, decisión 61), que lee la pasada B
    this.tHits = createTarget(gl, LINES, 1, [fn, fn, fn]);
    this.tSeg = createTarget(gl, LINES, COARSE_DEPTH, [fn]);
    this.tPre = createTarget(gl, LINES, COARSE_DEPTH, [fn, fn, fn, fn]);
    this.tTrans = createTarget(gl, LINES, COARSE_DEPTH, [f, fn, f, f]);
    this.tRaw = createTarget(gl, LINES, FINE_DEPTH, [f2]);
    // C deja el campo y, en su segundo adjunto, el ruido del receptor de cada línea (decisión 89)
    this.tAxial = createTarget(gl, LINES, FINE_DEPTH, [f2, f2]);
    // anillo de miradas: K las lee con texelFetch, en la misma celda
    const f1n = { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, filter: gl.NEAREST };
    this.tEnvLooks = profile.compound.order.map(() => createTarget(gl, LINES, FINE_DEPTH, [f1n]));
    this.tEnv = createTarget(gl, LINES, FINE_DEPTH, [f1]);
    this.tColor = createTarget(gl, COLOR_W, COLOR_H, [f]);
    this.tMap = createTarget(gl, MAP_W, MAP_H, [{ internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST }]);
    this.couplingTex = createTexture(gl, LINES, 1, gl.R32F, gl.RED, gl.FLOAT, gl.LINEAR);
    this.sceneTex = createTexture(gl, SCENE_TEX_W, SCENE_TEX_H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    this.uploadSceneStatic();
  }

  /**
   * Cambia de paciente conservando programas y destinos: los shaders no dependen de la escena
   * (solo sus uniforms y la textura de datos), así que el cambio de caso deja de recompilar
   * sus 18 programas (con diez eran ≈ 200 ms con GPU y muchos segundos con SwiftShader). Se descarta todo lo
   * que pertenecía al paciente anterior: uniforms en caché, persistencia, color, mapa de tejidos, cine y
   * columnas del modo M en vuelo.
   */
  setScene(scene: AnatomyScene): void {
    const gl = this.gl;
    this.currentScene = scene;
    this.speckleAnchor.reset();
    // las miradas guardadas son de otro paciente: el siguiente cuadro reinicia el anillo con la mirada 0
    this.ring.invalidate();
    this.sceneValuesFor = null;
    this.sceneValuesTubes = -1;
    this.sceneValuesCompression = null;
    this.sceneData.fill(0);
    this.headerAll.fill(0);
    this.uploadSceneStatic();
    this.lastColorFrame = null;
    if (this.mapPending) gl.deleteSync(this.mapPending.sync);
    this.mapPending = null;
    this.mapLast = null;
    this.cine.clear();
    this.lastFrame = null;
    this.liveValid = false;
    this.cineShown = null;
    this.mStrip.clear();
    if (this.tPersist)
      for (const t of this.tPersist) {
        bindTarget(gl, t);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Libera programas, texturas, FBO y el PBO del mapa. Obligatorio al reconstruir tras una
   * pérdida de contexto o al cerrar: el canvas es el mismo y los recursos no liberados se
   * acumulan en la GPU. (El cambio de caso usa `setScene`.)
   */
  dispose(): void {
    const gl = this.gl;
    for (const p of [
      this.pTransHits,
      this.pTransSeg,
      ...[this.pTransPre, this.pTrans, this.pRaw].flatMap((l) => [l.look0, l.steered]),
      this.pAxial,
      this.pLateral,
      this.pCompound,
      this.pColor,
      this.pScan,
      this.pPersist,
      this.pBlit,
      this.pMap,
      this.pMLine,
      this.pMStrip,
    ])
      p.dispose();
    this.pQuery?.dispose();
    this.pTriadQuery?.dispose();
    this.timer.dispose();
    for (const t of [
      this.tHits,
      this.tSeg,
      this.tPre,
      this.tTrans,
      this.tRaw,
      this.tAxial,
      ...this.tEnvLooks,
      this.tEnv,
      this.tColor,
      this.tMap,
    ])
      deleteTarget(gl, t);
    if (this.tScan) deleteTarget(gl, this.tScan);
    if (this.tPersist) for (const t of this.tPersist) deleteTarget(gl, t);
    gl.deleteTexture(this.couplingTex);
    gl.deleteTexture(this.sceneTex);
    if (this.mapPending) gl.deleteSync(this.mapPending.sync);
    if (this.mapPbo) gl.deleteBuffer(this.mapPbo);
    this.mapPending = null;
    this.mapPbo = null;
    for (const pair of this.repeatTargets.values()) for (const t of pair) deleteTarget(gl, t);
    this.repeatTargets.clear();
    gl.deleteTexture(this.cineEnv);
    gl.deleteTexture(this.cineColor);
    gl.deleteFramebuffer(this.cineFbo);
    this.cineEnv = this.cineColor = this.cineFbo = null;
    this.cine.clear();
    if (this.tMStrip) deleteTarget(gl, this.tMStrip);
    gl.deleteTexture(this.mSlotsTex);
    this.tMStrip = this.mSlotsTex = null;
    this.mSlots = new Float32Array(0);
    this.mStrip.clear();
  }

  /** Datos estáticos de la escena (nodos, cabeceras de tubos, tejidos). */
  private uploadSceneStatic(): void {
    const s = this.currentScene;
    const tubes = [
      ...s.vessels.map((v) => ({
        tube: v.tube,
        wallMm: v.wallMm,
        wallTissue: v.wallTissue,
        lumen: Tissue.Blood,
        iface: interfaceOfVessel(v.id, v.wallTissue),
        refRadius: v.refRadius,
        profileN: v.profileN,
      })),
      ...s.ducts.map((d) => ({
        tube: d.tube,
        wallMm: d.wallMm,
        wallTissue: Tissue.BileDuctWall,
        lumen: Tissue.Fluid,
        iface: Interface.DuctLumen,
        refRadius: 1,
        profileN: 2,
      })),
    ];
    if (s.torso.profile) this.sceneData.set(s.torso.profile, BODY_BASE * 4);
    s.ribs.forEach((r, i) => {
      this.sceneData.set([r.zAnterior, r.tilt, r.halfWidth, r.halfThickness], (RIB_BASE + i * RIB_TEXELS) * 4);
      this.sceneData.set(ribShape(r, s.torso), (RIB_BASE + i * RIB_TEXELS + 1) * 4);
      this.sceneData.set(
        [ribAnteriorEndX(r), r.shape || !Number.isFinite(r.cartilageFromPhi) ? 1 : 0, r.sourceCartilage ? 1 : 0, r.frontPhi ?? 0],
        (RIB_BASE + i * RIB_TEXELS + 2) * 4,
      );
    });
    if (s.torso.profile) CARTILAGE_ROWS.forEach((row, i) => this.sceneData.set(row, (CARTILAGE_BASE + i) * 4));
    BOWEL_BOUNDS.forEach((row, i) => this.sceneData.set(row, (BOWEL_BASE + i) * 4));
    BOWEL_NODES.forEach((p, i) => this.sceneData.set([...p, BOWEL_ARC[i]], (BOWEL_BASE + BOWEL_GROUPS + i) * 4));
    s.bowelRadii.forEach((r, i) => this.sceneData.set([r, 0, 0, 0], (BOWEL_BASE + BOWEL_GROUPS + BOWEL_NODES.length + i) * 4));
    this.tubeCountTotal = tubes.length;
    if (this.tubeCountTotal > MAX_TUBES) throw new Error('Demasiados tubos para el shader');
    let n = 0;
    tubes.forEach((t, i) => {
      const h = i * TUBE_HEADER_TEXELS;
      // H2.w = índice original del tubo (el shader lo devuelve como `vessel` aunque las
      // cabeceras se compacten por cuadro)
      this.headerAll.set([n, t.tube.nodes.length, t.tube.apScale, 1], h * 4);
      // H1.w: la cara de la luz (decisión 57); el shader reconoce el conducto por ella
      this.headerAll.set([t.wallMm, t.wallTissue, t.lumen, t.iface], (h + 1) * 4);
      this.headerAll.set([0, t.refRadius, t.profileN, i], (h + 2) * 4);
      const b = s.tubeBounds[i];
      this.headerAll.set([b.center[0], b.center[1], b.center[2], b.r], (h + 3) * 4);
      // H4: la forma orgánica (decisión 90) con la escala de radio 1 (por cuadro, con la del instante) o la marca del radio
      // smoothstep de la VCI infrahepática
      this.headerAll.set(tubeShapeTexel(t.tube, 1), (h + 4) * 4);
      if (t.tube.nodes.length - 1 > MAX_TUBE_SEGMENTS)
        throw new Error(`Tubo con ${t.tube.nodes.length - 1} segmentos (máximo del shader ${MAX_TUBE_SEGMENTS})`);
      for (const node of t.tube.nodes) {
        if (n >= MAX_NODES) throw new Error('Demasiados nodos de tubo para el shader');
        this.sceneData.set([node.p[0], node.p[1], node.p[2], node.r], (NODE_BASE + n) * 4);
        n++;
      }
    });
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SCENE_TEX_W, SCENE_TEX_H, gl.RGBA, gl.FLOAT, this.sceneData);
    for (let i = 0; i < TISSUE_COUNT; i++) {
      // Frecuencia efectiva de penetración del perfil (banda baja por atenuación)
      this.alpha[i] = attenuationDbPerCm(i, this.profile.bEffectiveMHz);
      this.back[i] = TISSUES[i].backscatter;
      this.clump[i] = TISSUES[i].speckleClump ?? 0;
      this.flags[i] = TISSUES[i].gas ? 1 : TISSUES[i].bone ? 2 : 0;
    }
  }

  /**
   * Uniforms de la anatomía desde el esquema único (`anatomy/gpu/sceneUniforms.ts`): se evalúan una vez por
   * instante y se suben a cada programa; la textura de escena va aparte (unidad 6).
   */
  private setSceneUniforms(p: GLProgram, inputs: FrameInputs): void {
    if (
      this.sceneValuesFor !== inputs.sample ||
      this.sceneValuesTubes !== this.tubeCount ||
      this.sceneValuesCompression !== inputs.compression
    ) {
      this.sceneValues = evaluateSceneUniforms(this.currentScene, {
        sample: inputs.sample,
        tubeCount: this.tubeCount,
        compression: inputs.compression,
      });
      this.sceneValuesFor = inputs.sample;
      this.sceneValuesTubes = this.tubeCount;
      if (this.sceneValuesCompression !== inputs.compression) this.uploadCompressionTable(inputs.compression);
      this.sceneValuesCompression = inputs.compression;
    }
    uploadSceneUniforms(p, this.sceneValues);
    p.tex('uSceneTex', 6, this.sceneTex);
  }

  /**
   * Tabla de la compresión de la sonda (decisión 63) en la textura de escena, desde COMPRESSION_BASE: un téxel por
   * nodo, (s₀, s_D, D, R). Se sube la fila entera que la contiene (los nodos de tubo de esa fila no cambian).
   */
  private uploadCompressionTable(k: ProbeCompression): void {
    this.currentScene.bowelRadii.forEach((r, i) =>
      this.sceneData.set([r, 0, 0, 0], (BOWEL_BASE + BOWEL_GROUPS + BOWEL_NODES.length + i) * 4),
    );
    k.nodes.forEach((n, i) => this.sceneData.set([n[0], n[1], n[2], k.radiusMm], (COMPRESSION_BASE + i) * 4));
    const row0 = Math.floor(COMPRESSION_BASE / SCENE_TEX_W);
    const row1 = Math.floor((BOWEL_BASE + BOWEL_GROUPS + 2 * BOWEL_NODES.length - 1) / SCENE_TEX_W);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      row0,
      SCENE_TEX_W,
      row1 - row0 + 1,
      gl.RGBA,
      gl.FLOAT,
      this.sceneData.subarray(row0 * SCENE_TEX_W * 4, (row1 + 1) * SCENE_TEX_W * 4),
    );
  }

  /**
   * Cabeceras de tubo del cuadro: calibre y u_ref del instante, y SOLO los tubos cuya
   * esfera envolvente corta la losa del plano de imagen (elevación ± 12 mm). Con
   * ~90 tubos (árbol hepático procedural) el bucle por muestra era el coste dominante;
   * por cuadro sobreviven 20–40. La lista compacta lleva el índice original en H2.w.
   */
  private updateSceneDynamic(inputs: FrameInputs, allTubes = false): void {
    const s = this.currentScene;
    const fr = inputs.frame;
    const total = this.tubeCountTotal;
    let kept = 0;
    for (let i = 0; i < total; i++) {
      const b = s.tubeBounds[i];
      const d =
        (b.center[0] - fr.face[0]) * fr.elevation[0] +
        (b.center[1] - fr.face[1]) * fr.elevation[1] +
        (b.center[2] - fr.face[2]) * fr.elevation[2];
      if (!allTubes && Math.abs(d) > b.r + 12) continue;
      const size = TUBE_HEADER_TEXELS * 4;
      const src = i * size;
      const dst = kept * size;
      this.sceneData.set(this.headerAll.subarray(src, src + size), dst);
      if (i < s.vessels.length) {
        const v = s.vessels[i];
        const scale = inputs.caliber.radiusScale(v.id);
        this.sceneData[dst + 2] = VESSEL_META[v.id].system === 'ivc' ? inputs.caliber.ivcApScale : v.tube.apScale;
        this.sceneData[dst + 3] = scale;
        this.sceneData[dst + 8] = inputs.sample.velocities[v.id] * (v.flowFactor ?? 1);
        this.sceneData[dst + 9] = v.refRadius * scale;
        // H4: la forma orgánica con la dilatación del instante (la vena distendida se redondea, decisión 90)
        if (v.tube.shape) this.sceneData.set(tubeShapeTexel(v.tube, scale), dst + 16);
      }
      kept++;
    }
    this.tubeCount = kept;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    // Solo las cabeceras (NODE_BASE texels) cambian por cuadro
    const rows = Math.ceil(NODE_BASE / SCENE_TEX_W);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SCENE_TEX_W, rows, gl.RGBA, gl.FLOAT, this.sceneData.subarray(0, SCENE_TEX_W * rows * 4));
  }

  private setBeamUniforms(p: GLProgram, inputs: FrameInputs): void {
    const fr = inputs.frame;
    const tr = inputs.transducer;
    p.v3('uFace', fr.face);
    p.v3('uAxial', fr.axial);
    p.v3('uLateral', fr.lateral);
    p.v3('uElev', fr.elevation);
    p.v3('uCurvC', fr.curvatureCenter);
    p.f('uCurvR', tr.curvatureRadius);
    p.f('uHalfSector', tr.halfSector);
    p.f('uDepth', inputs.bmode.depthMm);
    p.f('uLinesF', this.lines);
    p.tex('uCoupling', 7, this.couplingTex);
    p.v4v('uTissueAlpha4', this.alpha);
    p.v4v('uTissueBack4', this.back);
    p.v4v('uTissueFlag4', this.flags);
  }

  private updateCoupling(inputs: FrameInputs): void {
    const gl = this.gl;
    for (let i = 0; i < this.lines; i++) {
      const theta = lineAngle(i, inputs.transducer);
      this.couplingData[i] = contactCoupling(inputs.compression, theta);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.couplingTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.lines, 1, gl.RED, gl.FLOAT, this.couplingData);
  }

  /** Acoplamiento medio del último cuadro (0–1), para la UI. */
  meanCoupling(): number {
    let s = 0;
    for (let i = 0; i < this.lines; i++) s += this.couplingData[i];
    return s / this.lines;
  }

  private ensureDisplayTargets(): void {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.tScan && this.tScan.width === w && this.tScan.height === h) return;
    // liberar los destinos del tamaño anterior (antes se filtraban ~25 MB por redimensionado)
    if (this.tScan) deleteTarget(gl, this.tScan);
    if (this.tPersist) for (const t of this.tPersist) deleteTarget(gl, t);
    const f = { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR };
    this.tScan = createTarget(gl, w, h, [f]);
    this.tPersist = [createTarget(gl, w, h, [f]), createTarget(gl, w, h, [f])];
    // la historia de la persistencia (el cuadro congelado) se perdió con el tamaño anterior
    this.liveValid = false;
  }

  /**
   * Un cuadro de imagen. Pasadas, en orden (la nomenclatura A–H es la de
   * ARCHITECTURE.md y de `shaders/passes.glsl.ts`):
   *   A transmisión (marcha por rayos, atenuación, gas, hueso, espejo) →
   *   B campo complejo crudo (dispersores + eco de interfaz) →
   *   C convolución axial (y el ruido del receptor de cada línea, decisión 89) →
   *   D convolución lateral + ruido de la línea + envolvente →
   *   K composición espacial (media de las miradas del anillo; paso directo exacto con una) →
   *   F color (cadencia propia) → G conversión de barrido + mapa de grises →
   *   persistencia → presentación. (E está reservada; H es el mapa de tejidos
   *   de depuración, `tissueMap`.)
   * `repeat` (solo medida, ver `PassRepeat`) vuelve a dibujar una pasada dentro del cuadro; sin él no
   * cuesta nada.
   */
  render(inputs: FrameInputs, repeat?: PassRepeat): void {
    this.frameCount++;
    this.timer.poll();
    this.updateCoupling(inputs);
    this.updateSceneDynamic(inputs);
    // mirada de este cuadro (decisión 58): con el compuesto inactivo, siempre la 0
    const fr = inputs.frame;
    this.lookActive = compoundActive(inputs.bmode, inputs.color);
    this.look = this.ring.next({
      active: this.lookActive,
      harmonic: inputs.bmode.harmonic,
      depthMm: inputs.bmode.depthMm,
      focusMm: inputs.bmode.focusMm,
      lines: this.lines,
      face: fr.face,
      axial: fr.axial,
      elevation: fr.elevation,
    });
    const c = inputs.color;
    const colorDue = c.enabled && (inputs.updateColor || !this.lastColorFrame);
    // los destinos de prueba se crean antes de las pasadas: crear una textura cambia la de la unidad activa,
    // que la pasada ya habría dejado puesta para sus repeticiones
    const rep = repeat === undefined ? null : { ...repeat, targets: this.ensureRepeatTargets(repeat.pass) };
    for (const pass of FRAME_PASSES) {
      if (pass.cadence === 'color' && !colorDue) continue;
      this.timer.begin(pass.id);
      this.passes[pass.id](inputs);
      if (rep !== null && rep.pass === pass.id) this.drawRepeats(pass.id, rep.targets, rep.times);
      this.timer.end();
    }
    this.afterFrame(inputs);
  }

  /**
   * Tomas del cuadro para el cine y el modo M (decisión 80), tras la presentación y fuera del grafo (no forman la
   * imagen): el cine guarda la envolvente compuesta y el color que convirtió G (≤ `CINE_RATE_HZ`); con el modo M,
   * se copia la columna de su línea.
   */
  private afterFrame(inputs: FrameInputs): void {
    const c = inputs.color;
    const frame: CineFrame = {
      t: inputs.sample.t,
      n: this.frameCount,
      bmode: inputs.bmode,
      color: c,
      colorFrame: c.enabled ? this.lastColorFrame : null,
    };
    this.lastFrame = frame;
    this.liveValid = true;
    this.envIsLive = true;
    this.cineShown = null;
    const n = this.cine.count;
    // otra profundidad: la geometría de los cuadros guardados ya no es la de la pantalla
    if (n && this.cine.at(n - 1).bmode.depthMm !== inputs.bmode.depthMm) this.cine.clear();
    if (this.cine.due(frame.t)) this.cineStore(frame);
    // sin modo M la franja se interrumpe: al volver, el barrido empieza de nuevo (sin unir los dos tramos)
    if (inputs.mline !== undefined) this.mCapture(inputs, inputs.mline);
    else if (this.mStrip.count) this.mStrip.clear();
  }

  /** Guarda en el anillo la envolvente (y el color, si se ve) que tienen ahora `tEnv` y `tColor`. */
  private cineStore(frame: CineFrame): void {
    const gl = this.gl;
    const slot = this.cine.push(frame.t, frame);
    this.cineEnv ??= this.cineLayers(gl.R16F, this.lines, FINE_DEPTH);
    this.blitLayer(this.cineEnv, slot, this.tEnv, true);
    if (frame.colorFrame) {
      this.cineColor ??= this.cineLayers(gl.RG16F, COLOR_W, COLOR_H);
      this.blitLayer(this.cineColor, slot, this.tColor, true);
    }
  }

  /** Textura de capas del anillo (una por cuadro): R16F y RG16F son destinos con EXT_color_buffer_float. */
  private cineLayers(internal: number, w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture();
    this.cineFbo ??= gl.createFramebuffer();
    if (!t || !this.cineFbo) throw new Error('cine: sin textura o FBO');
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, internal, w, h, CINE_FRAMES);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }

  /**
   * Copia exacta, con la conversión de formato de la GPU (R32F ↔ R16F, RGBA32F ↔ RG16F), entre el destino `t` y la
   * capa `slot` del anillo: hacia la capa (`store`) o de vuelta a `t`, donde la lee G.
   */
  private blitLayer(layers: WebGLTexture, slot: number, t: RenderTarget, store: boolean): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cineFbo);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, layers, 0, slot);
    if (store) this.blit(t.fbo, this.cineFbo, t.width, t.height);
    else {
      this.blit(this.cineFbo, t.fbo, t.width, t.height);
      this.envIsLive = false;
    }
  }

  /** Copia exacta de w × h píxeles entre dos FBO (con la conversión de formato de la GPU). */
  private blit(from: WebGLFramebuffer | null, to: WebGLFramebuffer | null, w: number, h: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }

  /** Cuadros del cine guardados (decisión 80). */
  get cineCount(): number {
    return this.cine.count;
  }

  /** Cuadro i del cine (0 = el más viejo): su instante y sus ajustes. */
  cineFrame(i: number): CineFrame {
    return this.cine.at(i);
  }

  /** Cuadro del cine en pantalla, o null en vivo. */
  get cineShownFrame(): CineFrame | null {
    return this.cineShown ? this.cine.at(this.cineShown.index) : null;
  }

  /**
   * Al congelar (decisión 80): el último cuadro dibujado entra en el anillo si la cadencia lo había saltado, para
   * que el final del cine sea el cuadro congelado (su envolvente y su color siguen en `tEnv` y `tColor`).
   */
  cineSeal(): void {
    const n = this.cine.count;
    if (this.lastFrame && this.envIsLive && (!n || this.cine.at(n - 1) !== this.lastFrame)) this.cineStore(this.lastFrame);
  }

  /**
   * Muestra el cuadro `index` del cine (0 = el más viejo; decisión 80). La envolvente y el color guardados vuelven
   * a la pasada G con los ajustes de su cuadro, y los anteriores que aún pesan en la persistencia
   * (`persistenceReplay`) se funden en el mismo destino con la mezcla de la GPU, (1 − p^k)·G + p^k·destino: la de la
   * pasada P tras los k cuadros dibujados desde el guardado anterior. El cuadro se ve como se vio. El último, mientras
   * la historia de la persistencia siga intacta, es ella misma: el cuadro exacto de la congelación; si el lienzo
   * cambió (la historia se perdió), la historia pasa a ser el cuadro mostrado, para que al descongelar la imagen siga
   * desde él. Con el mismo cuadro y el mismo lienzo no dibuja nada.
   */
  showCine(index: number): void {
    const n = this.cine.count;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const i = Math.min(n - 1, Math.max(0, Math.round(index)));
    const shown = this.cineShown;
    if (!n || (shown && shown.index === i && shown.w === W && shown.h === H)) return;
    const live = this.tPersist?.[this.persistIndex];
    const last = this.lastFrame;
    if (i === n - 1 && this.liveValid && last && this.cine.at(i) === last && live && live.width === W && live.height === H) {
      this.display = sectorLayout(W, H, this.profile.geometry, last.bmode.depthMm, DISPLAY_MARGIN_PX);
      this.present(live);
    } else {
      const gl = this.gl;
      const first = Math.max(0, i - persistenceReplay(this.cine.at(i).bmode.persistence));
      for (let j = first; j <= i; j++) {
        const f = this.cine.at(j);
        const slot = this.cine.slot(j);
        this.blitLayer(this.cineEnv!, slot, this.tEnv, false);
        if (f.colorFrame) this.blitLayer(this.cineColor!, slot, this.tColor, false);
        if (j > first) {
          gl.enable(gl.BLEND);
          gl.blendColor(0, 0, 0, 1 - f.bmode.persistence ** Math.max(1, f.n - this.cine.at(j - 1).n));
          gl.blendFuncSeparate(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA, gl.ONE, gl.ZERO);
        }
        this.scanConvert(f.bmode, f.color, f.colorFrame, this.profile.geometry);
        gl.disable(gl.BLEND);
      }
      this.present(this.tScan!);
      if (!this.liveValid) this.blit(this.tScan!.fbo, this.tPersist![this.persistIndex].fbo, W, H);
    }
    this.cineShown = { index: i, w: W, h: H };
  }

  /**
   * Al descongelar (decisión 80): si en pantalla había un cuadro viejo del cine, la historia de la persistencia (el
   * cuadro congelado) vuelve a la pantalla ya, sin esperar al primer cuadro en vivo (con color, hasta su cadencia).
   */
  cineExit(): void {
    const live = this.tPersist?.[this.persistIndex];
    if (this.cineShown && live && this.presented !== live) this.present(live);
    this.cineShown = null;
  }

  /**
   * Modo M (decisión 80): copia la línea θ de la envolvente mostrada, con el mapa de grises del cuadro, a su columna
   * del anillo de la franja (la «textura que se desplaza»): un dibujo de 1 × M_SAMPLES píxeles, sin lecturas.
   */
  private mCapture(inputs: FrameInputs, theta: number): void {
    const gl = this.gl;
    const slot = this.mStrip.push(inputs.sample.t, inputs.bmode.depthMm, theta);
    const f = { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST };
    this.tMStrip ??= createTarget(gl, M_COLUMNS, M_SAMPLES, [f]);
    bindTarget(gl, this.tMStrip);
    gl.viewport(slot, 0, 1, M_SAMPLES);
    const p = this.pMLine;
    p.use();
    p.tex('uEnv', 0, this.tEnv.textures[0]);
    p.f('uU', mLineU(theta, inputs.transducer.halfSector));
    this.setGreyUniforms(p, inputs.bmode);
    drawFullscreen(gl);
  }

  /**
   * Modo M (decisión 80): la franja (profundidad × tiempo, con el eje de tiempo de las franjas) en los W × H píxeles
   * de abajo a la izquierda del lienzo. La vista la copia a su lienzo con `drawImage` (en la GPU) y `represent`
   * devuelve la imagen a la pantalla en el mismo cuadro: nada vuelve a la CPU.
   */
  drawMStrip(tRight: number, secondsVisible: number, W: number, H: number): void {
    const gl = this.gl;
    if (this.mSlots.length !== W) {
      this.mSlots = new Float32Array(W);
      gl.deleteTexture(this.mSlotsTex);
      this.mSlotsTex = createTexture(gl, W, 1, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST);
    }
    this.mStrip.pixelSlots(tRight, secondsVisible, W, this.mSlots);
    if (!this.tMStrip) this.mSlots.fill(-1);
    gl.bindTexture(gl.TEXTURE_2D, this.mSlotsTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, 1, gl.RED, gl.FLOAT, this.mSlots);
    bindTarget(gl, null, W, H);
    const p = this.pMStrip;
    p.use();
    // sin franja todavía, cualquier textura: ningún píxel la lee
    p.tex('uStrip', 0, (this.tMStrip ?? this.tEnv).textures[0]);
    p.tex('uSlots', 1, this.mSlotsTex!);
    p.f('uH', H);
    drawFullscreen(gl);
  }

  /** La imagen en pantalla otra vez: tras usar el lienzo para la franja M (decisión 80). */
  represent(): void {
    if (this.presented) this.present(this.presented);
  }

  /**
   * Destino que deja escrito cada pasada (null = la pantalla); lo usan sus repeticiones de medida. Las de
   * la presentación dependen del lienzo: antes, `ensureDisplayTargets`.
   */
  private readonly passOutputs: Record<PassId, () => RenderTarget | null> = {
    transmissionHits: () => this.tHits,
    transmissionSegments: () => this.tSeg,
    transmissionPrefix: () => this.tPre,
    transmission: () => this.tTrans,
    rawField: () => this.tRaw,
    axial: () => this.tAxial,
    lateral: () => this.tEnvLooks[this.look?.index ?? 0],
    compound: () => this.tEnv,
    color: () => this.tColor,
    scanConvert: () => this.tScan!,
    // tras la pasada, `persistIndex` ya apunta a la historia recién escrita
    persistence: () => this.tPersist![this.persistIndex],
    present: () => null,
  };

  /** Los dos destinos de prueba de una pasada, con el tamaño y los formatos de su salida (se rehacen si cambia). */
  private ensureRepeatTargets(id: PassId): [RenderTarget, RenderTarget] {
    const gl = this.gl;
    this.ensureDisplayTargets();
    const screen: TargetFormat = { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR };
    const spec = this.passOutputs[id]() ?? { width: this.canvas.width, height: this.canvas.height, formats: [screen] };
    const have = this.repeatTargets.get(id);
    if (have && have[0].width === spec.width && have[0].height === spec.height) return have;
    if (have) for (const t of have) deleteTarget(gl, t);
    const pair: [RenderTarget, RenderTarget] = [
      createTarget(gl, spec.width, spec.height, spec.formats),
      createTarget(gl, spec.width, spec.height, spec.formats),
    ];
    this.repeatTargets.set(id, pair);
    return pair;
  }

  /**
   * Repeticiones de medida de una pasada (`PassRepeat`): su mismo dibujo, con el programa, los uniforms y
   * las texturas que dejó puestos, alternando los dos destinos de prueba. Cada repetición es así su propio
   * pase de render (otro FBO que el del dibujo anterior). Si fueran al mismo destino, una GPU de teselas
   * (Apple M: TBDR) podría sombrear solo el último de los triángulos opacos que se tapan unos a otros
   * (eliminación de superficies ocultas: no hay mezcla, ni `discard`, ni profundidad) y la diferencia no
   * mediría nada. Cada repetición paga, como la pasada real, la carga y la escritura de sus teselas. Al
   * terminar vuelve a quedar puesto el destino de la pasada.
   */
  private drawRepeats(id: PassId, targets: readonly [RenderTarget, RenderTarget], times: number): void {
    const gl = this.gl;
    // los destinos de prueba, con los mismos adjuntos activos que el de la pasada (el programa puesto es el suyo)
    const outputs = this.passOutputs[id]()?.activeOutputs;
    for (let k = 0; k < times; k++) {
      bindTarget(gl, targets[k % 2]);
      if (outputs !== undefined) setActiveOutputs(gl, targets[k % 2], outputs);
      drawFullscreen(gl);
    }
    bindTarget(gl, this.passOutputs[id](), this.canvas.width, this.canvas.height);
  }

  /**
   * Tiempo medio de GPU del cuadro y, si el navegador los separa, por pasada (ms); null si no
   * expone temporizadores o aún no hay medidas. El campo crudo (B) frente a la presentación (S)
   * delata los backends que devuelven el cuadro entero en cada consulta.
   */
  gpuTimings(): GpuFrameTimings<PassId> | null {
    return summarizeGpuTimings(this.timer.timings(), 'rawField', 'present');
  }

  /** Implementación de cada pasada de `FRAME_PASSES` (el tipo exige una por identificador). */
  private readonly passes: Record<PassId, (inputs: FrameInputs) => void> = {
    transmissionHits: (inputs) => this.passTransmissionHits(inputs),
    transmissionSegments: (inputs) => this.passTransmissionSegments(inputs),
    transmissionPrefix: (inputs) => this.passTransmissionPrefix(inputs),
    transmission: (inputs) => this.passTransmission(inputs),
    rawField: (inputs) => this.passRawField(inputs),
    axial: (inputs) => this.passAxial(inputs),
    lateral: (inputs) => this.passLateral(inputs),
    compound: (inputs) => this.passCompound(inputs),
    color: (inputs) => this.passColor(inputs),
    scanConvert: (inputs) => this.passScanConvert(inputs),
    persistence: (inputs) => this.passPersistence(inputs),
    present: () => this.passPresent(),
  };

  // A0 — primeros impactos por línea (una marcha por línea)
  private passTransmissionHits(inputs: FrameInputs): void {
    const gl = this.gl;
    bindTarget(gl, this.tHits);
    this.pTransHits.use();
    this.setSceneUniforms(this.pTransHits, inputs);
    this.setBeamUniforms(this.pTransHits, inputs);
    this.pTransHits.f('uCoarseN', COARSE_DEPTH);
    drawFullscreen(gl);
  }

  // A1 — un segmento grueso por celda, sobre el camino (reflejado o no) de A0
  private passTransmissionSegments(inputs: FrameInputs): void {
    const gl = this.gl;
    bindTarget(gl, this.tSeg);
    this.pTransSeg.use();
    this.setSceneUniforms(this.pTransSeg, inputs);
    this.setBeamUniforms(this.pTransSeg, inputs);
    this.pTransSeg.f('uCoarseN', COARSE_DEPTH);
    this.pTransSeg.tex('uHits0', 0, this.tHits.textures[0]);
    this.pTransSeg.tex('uHits1', 1, this.tHits.textures[1]);
    // el pulmón de la cortina de cada línea (decisión 61) se marca aparte: no es un impacto de gas
    this.pTransSeg.tex('uHits2', 2, this.tHits.textures[2]);
    drawFullscreen(gl);
  }

  // A2 — atenuación acumulada hasta cada profundidad (sin clasificar); con una mirada dirigida, también la
  // de su camino (o2, o3)
  private passTransmissionPrefix(inputs: FrameInputs): void {
    const gl = this.gl;
    const steered = this.steeredLook();
    const p = this.lookProgram(this.pTransPre);
    // la mirada 0 escribe 2 de sus 4 adjuntos: con los otros activos WebGL no dibujaría
    bindTargetFor(gl, this.tPre, p);
    p.use();
    this.setBeamUniforms(p, inputs);
    p.f('uCoarseN', COARSE_DEPTH);
    p.tex('uSeg', 0, this.tSeg.textures[0]);
    p.tex('uHits0', 1, this.tHits.textures[0]);
    p.tex('uHits1', 2, this.tHits.textures[1]);
    if (steered) this.setSteerUniforms(p, inputs);
    drawFullscreen(gl);
  }

  /** El cuadro es de una mirada dirigida (θ ≠ 0, decisión 58): A2, A y B usan su programa dirigido. */
  private steeredLook(): boolean {
    return (this.look?.theta ?? 0) !== 0;
  }

  /** Programa de la mirada del cuadro (`LookPrograms`); el que queda puesto repiten `drawRepeats`. */
  private lookProgram(p: LookPrograms): GLProgram {
    return this.steeredLook() ? p.steered : p.look0;
  }

  /**
   * Mirada del cuadro (decisión 58) para los programas dirigidos de A2, A y B: uSteer = (θ, R·sin θ, R·cos θ,
   * k2). Los de la mirada 0 no la declaran.
   */
  private setSteerUniforms(p: GLProgram, inputs: FrameInputs): void {
    const th = this.look?.theta ?? 0;
    const R = inputs.transducer.curvatureRadius;
    p.v4('uSteer', th, R * Math.sin(th), R * Math.cos(th), this.k2);
  }

  // A — transmisión con la penumbra de la apertura (y la de un solo rayo para el Doppler); con una mirada
  // dirigida, también la de su camino (o3)
  private passTransmission(inputs: FrameInputs): void {
    const gl = this.gl;
    const beam = this.profile.beam;
    const steered = this.steeredLook();
    const p = this.lookProgram(this.pTrans);
    // la mirada 0 escribe 3 de sus 4 adjuntos (ver A2)
    bindTargetFor(gl, this.tTrans, p);
    p.use();
    this.setBeamUniforms(p, inputs);
    p.f('uCoarseN', COARSE_DEPTH);
    p.tex('uPre0', 0, this.tPre.textures[0]);
    p.tex('uPre1', 1, this.tPre.textures[1]);
    p.tex('uHits0', 2, this.tHits.textures[0]);
    // la dirección reflejada del espejo, que A pone en su o1 (decisión 86: A2 o1 lleva la refracción)
    p.tex('uHits1', 5, this.tHits.textures[1]);
    // la emisión de la imagen B a su foco (decisión 84: F/2,5 con el foco somero) y su haz en la refracción de las luces
    // (decisión 86)
    const refr = refractionBeam(bmodeBeam(this.profile, inputs.bmode), inputs.bmode.focusMm);
    p.v4('uAperture', bmodeTxApertureMm(this.profile, inputs.bmode), beam.apertureRxMaxMm, beam.fNumberRxMin, refr.cRxMm);
    p.v4('uRefr', refr.focusMm, refr.txScale, refr.cTxMm, refr.diffractionMm);
    p.v2('uRefrK', refr.kappaTx, refr.kappaRx);
    if (steered) {
      // el prefijo de la mirada del cuadro, que A2 acaba de escribir con su programa dirigido
      p.tex('uPreSteer', 3, this.tPre.textures[2]);
      p.tex('uPreSteerX', 4, this.tPre.textures[3]);
      this.setSteerUniforms(p, inputs);
    }
    drawFullscreen(gl);
  }

  // B — campo crudo: la mirada 0 o, en su programa, la dirigida del cuadro (decisión 58)
  private passRawField(inputs: FrameInputs): void {
    const gl = this.gl;
    const tr = inputs.transducer;
    const steered = this.steeredLook();
    const p = this.lookProgram(this.pRaw);
    bindTarget(gl, this.tRaw);
    p.use();
    this.setSceneUniforms(p, inputs);
    this.setBeamUniforms(p, inputs);
    if (steered) {
      // la dirigida lee A o1 (la dirección reflejada de la línea del espejo) y o3 (su camino), no o0
      p.tex('uTrans1', 1, this.tTrans.textures[1]);
      p.tex('uTrans3', 2, this.tTrans.textures[3]);
      this.setSteerUniforms(p, inputs);
      p.f('uLookSalt', this.look?.salt ?? 0);
    } else {
      p.tex('uTrans0', 0, this.tTrans.textures[0]);
      p.tex('uTrans1', 1, this.tTrans.textures[1]);
    }
    // la pleura parietal de A0 (decisión 61): su cruce, el borde de la cortina y la pérdida de la lámina; y el
    // rayo único de A (tope de la transmisión sin la lámina)
    p.tex('uHits2', 3, this.tHits.textures[2]);
    p.tex('uTrans2', 4, this.tTrans.textures[2]);
    p.f('uSeed', (inputs.seed % 1000) / 7.0);
    p.f('uLattice', 0.42);
    p.f('uElevSigma0', ELEV_SIGMA0_MM);
    p.f('uElevFocus', tr.elevationFocusMm);
    p.f('uElevHarmonic', inputs.bmode.harmonic ? 1 : 0);
    // el transitorio, de banda fundamental, se rechaza en armónica (decisión 77); el ruido del receptor va en C y D
    p.f('uTransientGain', transientGain(inputs.bmode.harmonic));
    p.v2('uHarmonicNear', ...harmonicNearUniform(inputs.bmode.harmonic));
    const an = this.speckleAnchor.update(inputs.frame.face, inputs.frame.elevation, inputs.sample.t);
    this.lastAnchorWeight = an.w;
    p.v3('uAnchorE0', an.a.e);
    p.v3('uAnchorP0', an.a.p);
    p.v3('uAnchorE1', an.b.e);
    p.v3('uAnchorP1', an.b.p);
    p.v2('uAnchorSalt', an.a.parity * ANCHOR_SALT_STEP, an.b.parity * ANCHOR_SALT_STEP);
    p.f('uAnchorW', an.w);
    p.v4v('uTissueClump4', this.clump);
    // eco de interfaz (decisión 57): tabla de caras y PSF lateral para la coherencia de curvatura
    p.v4v('uIface', this.ifaceUniforms);
    p.f('uIfaceK0', this.ifaceK0);
    this.setLateralPsfUniforms(p, inputs);
    drawFullscreen(gl);
  }

  /** Ecos parásitos del modo (decisión 76): de la pared del paciente de la escena y del modo de imagen. */
  private clutterFor(inputs: FrameInputs): ClutterParams {
    const t = this.currentScene.torso;
    return clutterParams(this.currentScene.wallThickness(), t.fatMm, inputs.bmode.harmonic);
  }

  /**
   * PSF lateral de dos vías (`LATERAL_PSF_GLSL`): la pasada D y el eco de interfaz de la B, con el haz del modo
   * B (el armónico en armónica, decisión 77).
   */
  private setLateralPsfUniforms(p: GLProgram, inputs: FrameInputs): void {
    const b = bmodeBeam(this.profile, inputs.bmode);
    // focalGain: (y/FWHM_tx)^z·√(w/|FWHM|), con las FWHM del foco del preajuste
    const ref = focalReferenceFwhmMm(b);
    p.v4('uFocus', inputs.bmode.focusMm, ref.tx, b.focalExponent - 0.5, Math.hypot(ref.tx, ref.rx));
    // la apodización de la emisión va en su apertura: el cono c·D y, en el foco, (kTx·λ_tx·c)·F/(c·D) = kTx·λ_tx·F/D,
    // con la apertura de emisión de ese foco (`txApertureMm`: F/F#_tx,min si es menor que la máxima)
    const cone = b.txConeFraction * txApertureMm(inputs.bmode.focusMm, b);
    p.v4('uBeam', b.k * b.lambdaMm, cone, b.apertureRxMaxMm, b.fNumberRxMin);
    p.v4('uBeamTx', b.kTx * b.lambdaTxMm * b.txConeFraction, b.txScale, b.downshiftTxPerMm, b.downshiftRxPerMm);
  }

  // C — convolución axial (pulso ≈ 2 ciclos a 3,5 MHz en la cara, σ 0,26 mm, que se alarga con la bajada de la
  // frecuencia central: `axialSigmaMm`, decisión 84). σ en la fila i = x + y·i, con la fila i en (i + ½)·dz
  private passAxial(inputs: FrameInputs): void {
    const gl = this.gl;
    const depth = inputs.bmode.depthMm;
    bindTarget(gl, this.tAxial);
    this.pAxial.use();
    this.pAxial.tex('uField', 0, this.tRaw.textures[0]);
    const dz = depth / FINE_DEPTH;
    const beam = bmodeBeam(this.profile, inputs.bmode);
    const s0 = axialSigmaMm(0.5 * dz, beam) / dz;
    this.pAxial.v2('uSigmaTexels', s0, axialSigmaMm(1.5 * dz, beam) / dz - s0);
    this.pAxial.v2('uTexel', 1 / this.lines, 1 / FINE_DEPTH);
    // réplicas de reverberación de la pared (decisión 76): desplazamiento entero en texeles; cada orden paga la
    // transmisión de ida y vuelta de la línea hasta la pared, la del camino de la mirada del cuadro
    const cp = this.clutterFor(inputs);
    const w = Math.round(cp.wallMm / dz);
    this.pAxial.v4('uReverb', w, cp.reverb[0], cp.reverb[1], w + Math.round(CLUTTER.reverbSourceMarginMm / dz));
    this.pAxial.tex('uTrans', 1, this.tTrans.textures[this.steeredLook() ? 3 : 0]);
    // Ruido del receptor de cada línea (decisión 89, receiver.ts): la escala con la que B omite el transitorio; en
    // armónica (decisión 77) sube respecto al eco. Nuevo en cada cuadro (cada mirada es otro disparo)
    this.pAxial.f('uNoise', RECEIVER_NOISE * noiseGain(inputs.bmode.harmonic));
    this.pAxial.f('uFrame', this.frameCount % RECEIVER_NOISE_FRAMES);
    drawFullscreen(gl);
  }

  // D — convolución lateral + envolvente
  private passLateral(inputs: FrameInputs): void {
    const gl = this.gl;
    const tr = inputs.transducer;
    const depth = inputs.bmode.depthMm;
    // la envolvente de la mirada del cuadro va a su ranura del anillo; K la compone en tEnv
    bindTarget(gl, this.tEnvLooks[this.look?.index ?? 0]);
    this.pLateral.use();
    this.pLateral.tex('uField', 0, this.tAxial.textures[0]);
    this.pLateral.tex('uRxNoise', 2, this.tAxial.textures[1]);
    this.pLateral.v2('uTexel', 1 / this.lines, 1 / FINE_DEPTH);
    this.pLateral.f('uDepth', depth);
    this.pLateral.f('uCurvR', tr.curvatureRadius);
    this.pLateral.f('uHalfSector', tr.halfSector);
    this.pLateral.f('uLinesF', this.lines);
    const cp = this.clutterFor(inputs);
    this.pLateral.v2('uSidelobe', cp.sidelobeIslr, cp.sidelobeWidth);
    this.pLateral.tex('uCoupling', 1, this.couplingTex);
    // la fracción del haz de cada línea de la mirada del cuadro que sobrevive a los huesos (A o2.z; decisiones 88 y 91)
    this.pLateral.tex('uShadow', 3, this.tTrans.textures[2]);
    this.setLateralPsfUniforms(this.pLateral, inputs);
    drawFullscreen(gl);
  }

  // K — composición espacial (decisión 58): media de las miradas válidas del anillo ponderada por cobertura
  // (y, bajo la pleura de la cortina, por 1 − fAir de la mirada 0: decisión 61)
  private passCompound(inputs: FrameInputs): void {
    const gl = this.gl;
    const tr = inputs.transducer;
    const order = this.profile.compound.order;
    bindTarget(gl, this.tEnv);
    this.pCompound.use();
    this.tEnvLooks.forEach((t, i) => this.pCompound.tex(`uLook${i}`, i, t.textures[0]));
    this.pCompound.fv(
      'uLookSteer',
      order.map((_, i) => lookTheta(i, this.profile.compound)),
    );
    this.pCompound.fv(
      'uLookValid',
      order.map((_, i) => (this.look?.valid[i] ? 1 : 0)),
    );
    this.pCompound.f('uCurvR', tr.curvatureRadius);
    this.pCompound.f('uHalfSector', tr.halfSector);
    this.pCompound.f('uLinesF', this.lines);
    this.pCompound.f('uDepth', inputs.bmode.depthMm);
    // la cortina de la mirada 0 (decisión 61): su pleura (A0 h2) y lo que pide su fracción de aire, como en B
    this.pCompound.tex('uHits2', order.length, this.tHits.textures[2]);
    this.pCompound.v3('uAxial', inputs.frame.axial);
    this.pCompound.v3('uLateral', inputs.frame.lateral);
    this.pCompound.v3('uElev', inputs.frame.elevation);
    this.pCompound.f('uElevSigma0', ELEV_SIGMA0_MM);
    this.pCompound.f('uElevFocus', tr.elevationFocusMm);
    this.pCompound.f('uElevHarmonic', inputs.bmode.harmonic ? 1 : 0);
    this.setLateralPsfUniforms(this.pCompound, inputs);
    drawFullscreen(gl);
  }

  // F — color (a su propia cadencia: `render` decide si toca)
  private passColor(inputs: FrameInputs): void {
    const gl = this.gl;
    const tr = inputs.transducer;
    const c = inputs.color;
    bindTarget(gl, this.tColor);
    this.pColor.use();
    this.setSceneUniforms(this.pColor, inputs);
    this.setBeamUniforms(this.pColor, inputs);
    // el color usa la transmisión de un solo rayo, la misma que el PW (decisión 50)
    this.pColor.tex('uTrans0', 0, this.tTrans.textures[2]);
    this.pColor.tex('uCoupling', 1, this.couplingTex);
    this.pColor.v4('uBox', c.theta0, c.theta1, c.r0, c.r1);
    this.pColor.v2(
      'uCells',
      colorLineCount(c.theta0, c.theta1, this.profile.colorLineSpacingRad),
      Math.max(4, Math.round((c.r1 - c.r0) / COLOR_PACKET_MM)),
    );
    this.pColor.v4(
      'uBeam',
      this.profile.beam.k * this.profile.beam.lambdaMm,
      this.profile.beam.apertureTxMm,
      this.profile.beam.apertureRxMaxMm,
      this.profile.beam.fNumberRxMin,
    );
    this.pColor.f('uPrf', c.prfHz);
    this.pColor.f('uF0', tr.f0Doppler);
    this.pColor.f('uWallHz', c.wallFilterHz);
    this.pColor.f('uColorGain', COLOR_GAIN_REF * Math.pow(10, c.gainDb / 20));
    this.pColor.f('uDopplerFreqRatio', this.profile.dopplerEffectiveMHz / this.profile.bEffectiveMHz);
    this.pColor.f('uEnsemble', c.ensemble);
    this.pColor.v3('uProbeVel', inputs.probeVelocity);
    this.pColor.f('uFrame', this.frameCount);
    drawFullscreen(gl);
    this.lastColorFrame = { box: [c.theta0, c.theta1, c.r0, c.r1], prf: c.prfHz };
  }

  // G — conversión de barrido + mapa de grises + superposición del color
  private passScanConvert(inputs: FrameInputs): void {
    this.scanConvert(inputs.bmode, inputs.color, this.lastColorFrame, inputs.transducer);
  }

  /** G con unos ajustes y un cuadro de color: los del cuadro en vivo o los de uno del cine (decisión 80). */
  private scanConvert(b: BModeSettings, c: ColorSettings, cf: CineFrame['colorFrame'], tr: Transducer): void {
    const gl = this.gl;
    this.ensureDisplayTargets();
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.display = sectorLayout(W, H, tr, b.depthMm, DISPLAY_MARGIN_PX);
    const { apexX, apexY, scale } = this.display;
    const p = this.pScan;
    bindTarget(gl, this.tScan);
    p.use();
    p.tex('uEnv', 0, this.tEnv.textures[0]);
    p.tex('uColor', 1, this.tColor.textures[0]);
    p.v2('uCanvas', W, H);
    p.v2('uApex', apexX, apexY);
    p.f('uScale', scale);
    p.f('uCurvR', tr.curvatureRadius);
    p.f('uHalfSector', tr.halfSector);
    this.setGreyUniforms(p, b);
    p.i('uColorOn', c.enabled && cf ? 1 : 0);
    const lb = cf?.box ?? [0, 0, 0, 0];
    p.v4('uBox', lb[0], lb[1], lb[2], lb[3]);
    p.f('uPrf', cf?.prf ?? c.prfHz);
    p.f('uColorThreshold', COLOR_DISPLAY_THRESHOLD);
    p.f('uColorPriority', COLOR_PRIORITY_GREY);
    p.i('uColorInvert', c.invert ? 1 : 0);
    drawFullscreen(gl);
  }

  /** Mapa de grises de la presentación (`DISPLAY_GREY_GLSL`): lo comparten G y la línea M. */
  private setGreyUniforms(p: GLProgram, b: BModeSettings): void {
    p.f('uDepth', b.depthMm);
    p.f('uGainDb', b.gainDb);
    p.f('uRefDb', DISPLAY_REF_DB);
    // Curva nominal: compensa la atenuación de ida y vuelta del hígado a la frecuencia B.
    p.f('uNominalTgcDbPerCm', nominalTgcDbPerCm(this.profile.bEffectiveMHz));
    p.f('uTgcCapDb', TGC_CAP_DB);
    p.f('uDynRange', b.dynamicRangeDb);
    p.f('uGreyCurve', GREY_CURVE);
    p.fv('uTgc', b.tgcDb);
  }

  // Persistencia (ping-pong): mezcla el cuadro con la historia
  private passPersistence(inputs: FrameInputs): void {
    const gl = this.gl;
    const prev = this.tPersist![this.persistIndex];
    const next = this.tPersist![1 - this.persistIndex];
    bindTarget(gl, next);
    this.pPersist.use();
    this.pPersist.tex('uCur', 0, this.tScan!.textures[0]);
    this.pPersist.tex('uPrev', 1, prev.textures[0]);
    this.pPersist.f('uPersist', inputs.bmode.persistence);
    drawFullscreen(gl);
    this.persistIndex = 1 - this.persistIndex;
  }

  // Presentación: la historia recién escrita, a pantalla
  private passPresent(): void {
    this.present(this.tPersist![this.persistIndex]);
  }

  /** Un destino a pantalla (volteado): el cuadro en vivo o uno del cine; `readDisplay` lee el último. */
  private present(t: RenderTarget): void {
    const gl = this.gl;
    bindTarget(gl, null, this.canvas.width, this.canvas.height);
    this.pBlit.use();
    this.pBlit.tex('uTex', 0, t.textures[0]);
    drawFullscreen(gl);
    this.presented = t;
  }

  /** Convierte píxel de pantalla → (θ rad, r mm) o null fuera del sector. */
  pixelToBeam(px: number, py: number, tr: Transducer, depthMm: number): { theta: number; r: number } | null {
    return pixelToBeam(this.display, tr, depthMm, px, py);
  }

  /** (θ, r) → píxel. */
  beamToPixel(theta: number, r: number, tr: Transducer): { x: number; y: number } {
    return beamToPixel(this.display, tr, theta, r);
  }

  /**
   * Mapa de tejidos del plano actual (docente): por celda (línea, profundidad)
   * devuelve clase de tejido e índice de vaso (−1 si ninguno). Lectura
   * ASÍNCRONA: la pasada se dibuja y se lee a un búfer PBO con una valla; la
   * llamada devuelve el último mapa completado (o null) sin bloquear la CPU
   * (un readPixels síncrono esperaba a toda la cola de la GPU, 80–90 ms).
   */
  tissueMap(inputs: FrameInputs): { width: number; height: number; tissue: Uint8Array; vessel: Int8Array } | null {
    const gl = this.gl;
    const n = MAP_W * MAP_H;
    if (this.mapPending) {
      const status = gl.clientWaitSync(this.mapPending.sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) return this.mapLast;
      gl.deleteSync(this.mapPending.sync);
      if (this.mapPixels.length !== n * 4) this.mapPixels = new Uint8Array(n * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.mapPending.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.mapPixels);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.mapPending = null;
      const tissue = new Uint8Array(n);
      const vessel = new Int8Array(n);
      for (let i = 0; i < n; i++) {
        tissue[i] = this.mapPixels[i * 4];
        vessel[i] = this.mapPixels[i * 4 + 1] - 1;
      }
      this.mapLast = { width: MAP_W, height: MAP_H, tissue, vessel };
    }
    // Encolar la siguiente lectura con el calibre del instante pedido (la textura de
    // escena la actualiza `render()` con el cuadro actual; aquí se sincroniza al mapa).
    this.updateSceneDynamic(inputs);
    bindTarget(gl, this.tMap);
    this.pMap.use();
    this.setSceneUniforms(this.pMap, inputs);
    this.setBeamUniforms(this.pMap, inputs);
    drawFullscreen(gl);
    if (!this.mapPbo) {
      this.mapPbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.mapPbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 4, gl.STREAM_READ);
    } else gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.mapPbo);
    gl.readPixels(0, 0, MAP_W, MAP_H, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (sync) this.mapPending = { sync, pbo: this.mapPbo };
    gl.flush();
    return this.mapLast;
  }

  /**
   * Consulta síncrona de la anatomía GLSL en una lista de puntos del mundo (xyz por
   * punto). Solo para pruebas y el gate de equivalencia TS ↔ GLSL: lee de la GPU de
   * forma bloqueante, así que nunca se llama por cuadro. Con `normals`, lee además el
   * tercer adjunto: el gradiente de la cara en cada punto (siempre se crea, para que la
   * salida `o2` del shader tenga destino).
   */
  queryPoints(points: Float32Array, inputs: FrameInputs, allTubes = false, opts: { normals?: boolean } = {}): GpuPointQuery {
    const gl = this.gl;
    const n = Math.floor(points.length / 3);
    const W = 256;
    const H = Math.max(1, Math.ceil(n / W));
    const data = new Float32Array(W * H * 4);
    for (let i = 0; i < n; i++) data.set([points[i * 3], points[i * 3 + 1], points[i * 3 + 2], 1], i * 4);
    const pts = createTexture(gl, W, H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, data);
    const f = { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST };
    const target = createTarget(gl, W, H, [f, f, f]);
    this.pQuery ??= GLProgram.link(gl, VERT, FRAG_QUERY, 'query');
    // puntos fuera del plano (equivalencia volumétrica): todos los tubos, sin recorte por losa
    this.updateSceneDynamic(inputs, allTubes);
    bindTarget(gl, target);
    this.pQuery.use();
    this.setSceneUniforms(this.pQuery, inputs);
    this.setBeamUniforms(this.pQuery, inputs);
    this.pQuery.tex('uPoints', 0, pts);
    drawFullscreen(gl);
    const out0 = new Float32Array(W * H * 4);
    const out1 = new Float32Array(W * H * 4);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, out0);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, out1);
    const out2 = opts.normals ? new Float32Array(W * H * 4) : null;
    if (out2) {
      gl.readBuffer(gl.COLOR_ATTACHMENT2);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, out2);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    deleteTarget(gl, target);
    gl.deleteTexture(pts);
    const tissue = new Int32Array(n);
    const vessel = new Int32Array(n);
    const velocity = new Float32Array(n * 3);
    const iface = new Int32Array(n);
    const ifd = new Float32Array(n);
    const normal = out2 ? new Float32Array(n * 3) : undefined;
    const gradNorm = out2 ? new Float32Array(n) : undefined;
    for (let i = 0; i < n; i++) {
      tissue[i] = Math.round(out0[i * 4]);
      vessel[i] = Math.round(out0[i * 4 + 1]);
      ifd[i] = out0[i * 4 + 3];
      velocity.set([out1[i * 4], out1[i * 4 + 1], out1[i * 4 + 2]], i * 3);
      iface[i] = Math.round(out1[i * 4 + 3]);
      if (normal && gradNorm && out2) {
        normal.set([out2[i * 4], out2[i * 4 + 1], out2[i * 4 + 2]], i * 3);
        gradNorm[i] = out2[i * 4 + 3];
      }
    }
    return normal ? { tissue, vessel, velocity, iface, ifd, normal, gradNorm } : { tissue, vessel, velocity, iface, ifd };
  }

  /**
   * Factor de las tríadas portales (`portalTriad`, decisión 78) en puntos MATERIALES (x, y, z por punto), con el GLSL
   * de la pasada B. Solo pruebas: programa propio y lectura bloqueante.
   */
  queryTriads(points: Float32Array): Float32Array {
    const gl = this.gl;
    const n = Math.floor(points.length / 3);
    const W = 256;
    const H = Math.max(1, Math.ceil(n / W));
    const data = new Float32Array(W * H * 4);
    for (let i = 0; i < n; i++) data.set([points[i * 3], points[i * 3 + 1], points[i * 3 + 2], 1], i * 4);
    const pts = createTexture(gl, W, H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, data);
    const target = createTarget(gl, W, H, [{ internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST }]);
    this.pTriadQuery ??= GLProgram.link(gl, VERT, FRAG_TRIAD_QUERY, 'triadQuery');
    bindTarget(gl, target);
    this.pTriadQuery.use();
    this.pTriadQuery.tex('uPoints', 0, pts);
    drawFullscreen(gl);
    const out = new Float32Array(W * H * 4);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    deleteTarget(gl, target);
    gl.deleteTexture(pts);
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = out[i * 4];
    return g;
  }

  /**
   * Celdas del último cuadro de color con potencia por encima del umbral de presentación (las que
   * la conversión de barrido puede pintar). Solo pruebas: lectura GPU→CPU bloqueante.
   */
  /** Celdas del objetivo de color (la caja entera). */
  get colorCellCount(): number {
    return COLOR_W * COLOR_H;
  }

  /** Campo del último cuadro de color (RGBA: frecuencia, potencia, fracción de sangre). Solo pruebas: lectura bloqueante. */
  readColorField(): { width: number; height: number; data: Float32Array } {
    const gl = this.gl;
    const px = new Float32Array(COLOR_W * COLOR_H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tColor.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, COLOR_W, COLOR_H, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { width: COLOR_W, height: COLOR_H, data: px };
  }

  colorCellsAbove(threshold = COLOR_DISPLAY_THRESHOLD): number {
    const px = this.readColorField().data;
    let n = 0;
    for (let i = 0; i < COLOR_W * COLOR_H; i++) if (px[i * 4 + 1] > threshold) n++;
    return n;
  }

  /**
   * Transmisión de amplitud de ida y vuelta de la pasada A (a la frecuencia B) en (u, v) del sector
   * (u: línea 0–1, v: profundidad / profundidad del sector). Solo pruebas: lectura GPU→CPU bloqueante.
   */
  transmissionAt(u: number, v: number): number {
    const gl = this.gl;
    const x = Math.min(this.lines - 1, Math.max(0, Math.floor(u * this.lines)));
    const y = Math.min(COARSE_DEPTH - 1, Math.max(0, Math.floor(v * COARSE_DEPTH)));
    const px = new Float32Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tTrans.fbo);
    // un solo rayo: la transmisión que ven el color y el PW
    gl.readBuffer(gl.COLOR_ATTACHMENT2);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px[0];
  }

  /**
   * Envolvente detectada (líneas × profundidad, antes de la compresión logarítmica y de la persistencia).
   * Solo pruebas: lectura GPU→CPU bloqueante. La fuente es explícita (decisión 58):
   *  - `'look0'` (por defecto): la mirada 0, la imagen de una mirada de siempre. Lanza si la mirada 0 no es
   *    la del último cuadro (compuesto activo y el último cuadro fue una mirada dirigida): una guarda de una
   *    mirada no debe medir en silencio una envolvente de otro cuadro;
   *  - `'compound'`: la salida de K, la que se ve (con el compuesto apagado, la mirada 0 bit a bit).
   */
  readEnvelope(opts: { source?: 'look0' | 'compound' } = {}): EnvelopeRead {
    const source = opts.source ?? 'look0';
    if (source === 'compound') return this.readR32F(this.tEnv);
    const last = this.look;
    if (last !== null && last.index !== 0)
      throw new Error(
        `readEnvelope: la mirada 0 no es del último cuadro (compuesto activo, mirada ${last.index}); ` +
          "lee { source: 'compound' } o mide con el compuesto apagado",
      );
    return this.readR32F(this.tEnvLooks[0]);
  }

  /**
   * Envolvente de una ranura del anillo de miradas (decisión 58), con su θ. Solo pruebas: lectura GPU→CPU
   * bloqueante. Lanza si la ranura no tiene una mirada válida (anillo reiniciado o compuesto apagado).
   */
  readLookEnvelope(slot: number): EnvelopeRead & { theta: number } {
    const valid = this.look?.valid ?? [];
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.tEnvLooks.length)
      throw new RangeError(`readLookEnvelope: ranura ${slot} fuera del anillo (${this.tEnvLooks.length})`);
    if (!valid[slot]) throw new Error(`readLookEnvelope: la ranura ${slot} no tiene una mirada válida (anillo ${JSON.stringify(valid)})`);
    return { ...this.readR32F(this.tEnvLooks[slot]), theta: lookTheta(slot, this.profile.compound) };
  }

  /** Estado de la composición espacial tras el último cuadro (decisión 58). */
  compoundState(): CompoundState {
    const st = this.ring.state();
    const last = st.last;
    const n = this.profile.compound.order.length;
    return {
      active: this.lookActive,
      look: last?.index ?? 0,
      theta: last?.theta ?? 0,
      valid: last ? [...last.valid] : Array<boolean>(n).fill(false),
      validCount: last?.validCount ?? 0,
      resets: st.resets,
    };
  }

  /** Lectura bloqueante de un destino R32F (solo pruebas). */
  private readR32F(t: RenderTarget): EnvelopeRead {
    const W = t.width;
    const H = t.height;
    const rgba = this.readRgba(t, 0);
    const data = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) data[i] = rgba[i * 4];
    return { lines: W, samples: H, data };
  }

  /** Un adjunto RGBA32F entero de un destino (solo pruebas: lectura bloqueante). */
  private readRgba(t: RenderTarget, attachment: number): Float32Array {
    const gl = this.gl;
    const px = new Float32Array(t.width * t.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
    gl.readPixels(0, 0, t.width, t.height, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px;
  }

  /**
   * Transmisión de la pasada A por línea × profundidad gruesa (`TransmissionRead`). Solo pruebas: la
   * paridad de la pasada A con el modelo de CPU (`ultrasound/transmission.ts`) y las máscaras del banco.
   * `look` (0 por defecto) es la mirada: la 0 se calcula en todos los cuadros; una dirigida, solo en el
   * cuadro que la forma, así que lanza si el último cuadro fue de otra mirada (decisión 58).
   */
  readTransmission(opts: { look?: number } = {}): TransmissionRead {
    const look = opts.look ?? 0;
    const W = this.lines;
    const H = COARSE_DEPTH;
    const n = W * H;
    if (look === 0) {
      const a2 = this.readRgba(this.tTrans, 2);
      const a0 = this.readRgba(this.tTrans, 0);
      const single = new Float32Array(n);
      const aperture = new Float32Array(n);
      const mirrorHit = new Float32Array(n);
      const specular = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        single[i] = a2[i * 4];
        aperture[i] = a0[i * 4];
        mirrorHit[i] = a0[i * 4 + 3];
        specular[i] = a2[i * 4 + 3];
      }
      const own = this.look === null || this.look.index === 0;
      return { lines: W, samples: H, single, aperture, mirrorHit, look: 0, theta: 0, ...(own ? { specular } : {}) };
    }
    const last = this.look;
    if (last === null || last.index !== look)
      throw new Error(`readTransmission: la mirada ${look} no es la del último cuadro (mirada ${last?.index ?? '—'})`);
    const pre = this.readRgba(this.tPre, 2);
    const a3 = this.readRgba(this.tTrans, 3);
    const a2 = this.readRgba(this.tTrans, 2);
    const single = new Float32Array(n);
    const aperture = new Float32Array(n);
    const mirrorHit = new Float32Array(n);
    const prefixDb = new Float32Array(n);
    const sGas = new Float32Array(n);
    const specular = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      prefixDb[i] = pre[i * 4];
      single[i] = Math.pow(10, -pre[i * 4] / 20);
      aperture[i] = a3[i * 4];
      sGas[i] = a3[i * 4 + 1];
      mirrorHit[i] = a3[i * 4 + 3];
      specular[i] = a2[i * 4 + 3];
    }
    return { lines: W, samples: H, single, aperture, mirrorHit, look, theta: last.theta, prefixDb, sGas, specular };
  }

  /**
   * Salidas de A0 y A1 del último cuadro como rejilla de segmentos (`SegmentGrid`): la entrada de los
   * gemelos de A2 (`prefixDb`, `steeredPrefixDb`). Solo pruebas: la paridad del prefijo dirigido de la GPU
   * con el de TS sobre los mismos segmentos (decisión 58).
   */
  readSegments(depthMm: number): SegmentGrid {
    const W = this.lines;
    const H = COARSE_DEPTH;
    const seg = this.readRgba(this.tSeg, 0);
    const h0 = this.readRgba(this.tHits, 0);
    const h1 = this.readRgba(this.tHits, 1);
    const n = W * H;
    const grid: SegmentGrid = {
      lines: W,
      rows: H,
      stepMm: depthMm / H,
      db: new Float64Array(n),
      air: new Uint8Array(n),
      excess: new Float64Array(n),
      bone: new Uint8Array(n),
      gas: new Uint8Array(n),
      mirrorSeg: new Int32Array(W),
      mirrorR: new Float64Array(W),
      hitGasSeg: new Int32Array(W),
      hitBoneSeg: new Int32Array(W),
    };
    // la textura va por filas (fila s, línea l); la rejilla, por línea (l·rows + s). El aire lleva el dB en negativo y
    // .y, el camino de más de las luces (decisión 86)
    for (let s = 0; s < H; s++)
      for (let l = 0; l < W; l++) {
        const t = (s * W + l) * 4;
        const i = l * H + s;
        grid.db[i] = Math.abs(seg[t]);
        grid.air[i] = seg[t] < 0 ? 1 : 0;
        grid.excess[i] = seg[t + 1];
        grid.bone[i] = seg[t + 2] > 0.5 ? 1 : 0;
        grid.gas[i] = Math.round(seg[t + 3]);
      }
    for (let l = 0; l < W; l++) {
      grid.mirrorSeg[l] = Math.round(h0[l * 4]);
      grid.mirrorR[l] = h0[l * 4] >= 0 ? h1[l * 4 + 3] : -1;
      grid.hitGasSeg![l] = Math.round(h0[l * 4 + 1]);
      grid.hitBoneSeg![l] = Math.round(h0[l * 4 + 2]);
    }
    return grid;
  }

  /**
   * Espera a que la GPU acabe lo encolado (lectura de 1 píxel de la pantalla). Solo pruebas y banco:
   * sirve para medir el coste de un cuadro en tiempo de pared.
   */
  finishForTiming(): void {
    const px = new Uint8Array(4);
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
  }

  /**
   * Imagen mostrada (tras la curva de grises y la persistencia, sin color encima si la caja está apagada): la
   * del último cuadro o, con la imagen congelada, la del cuadro del cine en pantalla (decisión 80). Gris 0–255
   * por píxel del lienzo, fila 0 arriba, en las coordenadas de `display`. Solo pruebas y banco de fidelidad:
   * lectura GPU→CPU bloqueante.
   */
  readDisplay(): DisplayFrame {
    const gl = this.gl;
    const target = this.presented ?? this.tPersist?.[this.persistIndex];
    if (!target) return { width: 0, height: 0, gray: new Uint8Array(0) };
    const { width, height } = target;
    const rgba = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // la pasada de conversión escribe con y hacia abajo en la fila 0 del destino (la presentación
    // la invierte al volcarla a pantalla): la fila 0 leída es la parte de arriba de la imagen
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) gray[i] = rgba[i * 4];
    return { width, height, gray };
  }
}
