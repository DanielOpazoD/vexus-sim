import type { AnatomyScene, VesselCaliber } from '../anatomy/scene';
import { VESSEL_META } from '../physiology/vessels';
import { Tissue } from '../anatomy/tissues';
import { Interface, interfaceOfVessel } from '../anatomy/interfaces';
import { TISSUES, TISSUE_COUNT, attenuationDbPerCm } from '../anatomy/tissues';
import type { PhysiologySample } from '../physiology/engine';
import { lineAngle, lineCoupling, type ProbeFrame, type ProbePose, type Transducer } from '../probe/probe';
import type { TransducerProfile } from './transducerProfile';
import { COLOR_PACKET_MM, colorLineCount } from './colorTiming';
import { beamToPixel, pixelToBeam, sectorLayout, type SectorLayout } from './sectorGeometry';
import { GREY_CURVE, greyOfLevel } from './greyMap';
import { ANCHOR_SALT_STEP, ElevationAnchor } from './speckleField';
import { GLProgram, bindTarget, createTarget, createTexture, deleteTarget, drawFullscreen, type RenderTarget } from './gl';
import { GpuPassTimer, summarizeGpuTimings, type GpuFrameTimings } from './gpuTimer';
import { FRAME_PASSES, type PassId } from './passGraph';
import { MAX_NODES, MAX_TUBES, MAX_TUBE_SEGMENTS, NODE_BASE, SCENE_TEX_H, SCENE_TEX_W } from '../anatomy/gpu/anatomy.glsl';
import { evaluateSceneUniforms, uploadSceneUniforms, type SceneUniformValues } from '../anatomy/gpu/sceneUniforms';
import {
  FRAG_AXIAL,
  FRAG_BLIT,
  FRAG_COLOR,
  FRAG_LATERAL,
  FRAG_PERSIST,
  FRAG_RAWFIELD,
  FRAG_SCANCONVERT,
  FRAG_TISSUEMAP,
  FRAG_QUERY,
  FRAG_TRANS_HITS,
  FRAG_TRANS_PREFIX,
  FRAG_TRANS_SEGMENTS,
  FRAG_TRANSMISSION,
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
  transducer: Transducer;
  caliber: VesselCaliber;
  probeVelocity: Vec3;
  bmode: BModeSettings;
  color: ColorSettings;
  /** Actualizar el cuadro de color en este fotograma (cadencia propia del equipo). */
  updateColor: boolean;
  seed: number;
}

/**
 * Resultado de `queryPoints`: tejido, índice de tubo (−1 sin vaso), velocidad de la sangre (mm/s), la
 * cara de interfaz que dibuja cada punto y su distancia (`Cls.iface`, `Cls.ifd`; decisión 57) y, si se
 * pidió, la normal unitaria de esa cara que usa el eco (`faceNormal`, marco material; xyz por punto).
 */
export interface GpuPointQuery {
  tissue: Int32Array;
  vessel: Int32Array;
  velocity: Float32Array;
  iface: Int32Array;
  ifd: Float32Array;
  normal?: Float32Array;
}

export class UltrasoundRenderer {
  readonly gl: WebGL2RenderingContext;
  private pTransHits: GLProgram;
  private pTransSeg: GLProgram;
  private pTransPre: GLProgram;
  private pTrans: GLProgram;
  private pRaw: GLProgram;
  private pAxial: GLProgram;
  private pLateral: GLProgram;
  private pColor: GLProgram;
  private pScan: GLProgram;
  private pPersist: GLProgram;
  private pBlit: GLProgram;
  private pMap: GLProgram;
  private pQuery: GLProgram | null = null;
  /** Tiempo de GPU por pasada (asíncrono; null sin la extensión). */
  private readonly timer: GpuPassTimer<PassId>;
  private sceneValues: SceneUniformValues = [];
  private sceneValuesFor: FrameInputs['sample'] | null = null;
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
  private tEnv: RenderTarget;
  private tColor: RenderTarget;
  private tScan: RenderTarget | null = null;
  private tPersist: [RenderTarget, RenderTarget] | null = null;
  private persistIndex = 0;
  private couplingTex: WebGLTexture;
  private couplingData: Float32Array;
  private frameCount = 0;
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
  /** Cabeceras de TODOS los tubos (4 texels cada una); por cuadro se suben solo las del plano. */
  private headerAll = new Float32Array(MAX_TUBES * 16);
  private tubeCount = 0;
  private tubeCountTotal = 0;
  private alpha = new Float32Array(TISSUE_COUNT);
  private back = new Float32Array(TISSUE_COUNT);
  private clump = new Float32Array(Math.ceil(TISSUE_COUNT / 4) * 4);
  private flags = new Float32Array(TISSUE_COUNT);
  private lastColorFrame: { box: [number, number, number, number]; prf: number } | null = null;
  /** Geometría de presentación del último cuadro (px). */
  display: SectorLayout = { apexX: 0, apexY: 0, scale: 1, width: 1, height: 1 };

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
    const LINES = this.lines;
    this.couplingData = new Float32Array(LINES);
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 no disponible');
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float no disponible');
    gl.getExtension('OES_texture_float_linear');
    this.timer = new GpuPassTimer<PassId>(gl);
    this.pTransHits = new GLProgram(gl, VERT, FRAG_TRANS_HITS, 'transmissionHits');
    this.pTransSeg = new GLProgram(gl, VERT, FRAG_TRANS_SEGMENTS, 'transmissionSegments');
    this.pTransPre = new GLProgram(gl, VERT, FRAG_TRANS_PREFIX, 'transmissionPrefix');
    this.pTrans = new GLProgram(gl, VERT, FRAG_TRANSMISSION, 'transmission');
    this.pRaw = new GLProgram(gl, VERT, FRAG_RAWFIELD, 'rawfield');
    this.pAxial = new GLProgram(gl, VERT, FRAG_AXIAL, 'axial');
    this.pLateral = new GLProgram(gl, VERT, FRAG_LATERAL, 'lateral');
    this.pColor = new GLProgram(gl, VERT, FRAG_COLOR, 'color');
    this.pScan = new GLProgram(gl, VERT, FRAG_SCANCONVERT, 'scanconvert');
    this.pPersist = new GLProgram(gl, VERT, FRAG_PERSIST, 'persist');
    this.pBlit = new GLProgram(gl, VERT, FRAG_BLIT, 'blit');
    this.pMap = new GLProgram(gl, VERT, FRAG_TISSUEMAP, 'tissuemap');
    const f = { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.LINEAR };
    const f2 = { internal: gl.RG32F, format: gl.RG, type: gl.FLOAT, filter: gl.LINEAR };
    const f1 = { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, filter: gl.LINEAR };
    // impactos y segmentos se leen con texelFetch (NEAREST: nunca interpolar profundidades de impacto);
    // la transmisión final: 0 = (ida y vuelta con apertura, impactos), 1 = (dirección, tipo de gas),
    // 2 = un solo rayo (color y PW)
    const fn = { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST };
    this.tHits = createTarget(gl, LINES, 1, [fn, fn]);
    this.tSeg = createTarget(gl, LINES, COARSE_DEPTH, [fn]);
    this.tPre = createTarget(gl, LINES, COARSE_DEPTH, [fn, fn]);
    this.tTrans = createTarget(gl, LINES, COARSE_DEPTH, [f, fn, f]);
    this.tRaw = createTarget(gl, LINES, FINE_DEPTH, [f2]);
    this.tAxial = createTarget(gl, LINES, FINE_DEPTH, [f2]);
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
   * diez programas (≈ 200 ms con GPU, muchos segundos con SwiftShader). Se descarta todo lo
   * que pertenecía al paciente anterior: uniforms en caché, persistencia, color y mapa de tejidos.
   */
  setScene(scene: AnatomyScene): void {
    const gl = this.gl;
    this.currentScene = scene;
    this.speckleAnchor.reset();
    this.sceneValuesFor = null;
    this.sceneValuesTubes = -1;
    this.sceneData.fill(0);
    this.headerAll.fill(0);
    this.uploadSceneStatic();
    this.lastColorFrame = null;
    if (this.mapPending) gl.deleteSync(this.mapPending.sync);
    this.mapPending = null;
    this.mapLast = null;
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
      this.pTransPre,
      this.pTrans,
      this.pRaw,
      this.pAxial,
      this.pLateral,
      this.pColor,
      this.pScan,
      this.pPersist,
      this.pBlit,
      this.pMap,
    ])
      p.dispose();
    this.pQuery?.dispose();
    this.timer.dispose();
    for (const t of [this.tHits, this.tSeg, this.tPre, this.tTrans, this.tRaw, this.tAxial, this.tEnv, this.tColor, this.tMap])
      deleteTarget(gl, t);
    if (this.tScan) deleteTarget(gl, this.tScan);
    if (this.tPersist) for (const t of this.tPersist) deleteTarget(gl, t);
    gl.deleteTexture(this.couplingTex);
    gl.deleteTexture(this.sceneTex);
    if (this.mapPending) gl.deleteSync(this.mapPending.sync);
    if (this.mapPbo) gl.deleteBuffer(this.mapPbo);
    this.mapPending = null;
    this.mapPbo = null;
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
    this.tubeCountTotal = tubes.length;
    if (this.tubeCountTotal > MAX_TUBES) throw new Error('Demasiados tubos para el shader');
    let n = 0;
    tubes.forEach((t, i) => {
      const h = i * 4;
      // H2.w = índice original del tubo (el shader lo devuelve como `vessel` aunque las
      // cabeceras se compacten por cuadro)
      this.headerAll.set([n, t.tube.nodes.length, t.tube.apScale, 1], h * 4);
      // H1.w: la cara de la luz (decisión 57); el shader reconoce el conducto por ella
      this.headerAll.set([t.wallMm, t.wallTissue, t.lumen, t.iface], (h + 1) * 4);
      this.headerAll.set([0, t.refRadius, t.profileN, i], (h + 2) * 4);
      const b = s.tubeBounds[i];
      this.headerAll.set([b.center[0], b.center[1], b.center[2], b.r], (h + 3) * 4);
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
    if (this.sceneValuesFor !== inputs.sample || this.sceneValuesTubes !== this.tubeCount) {
      this.sceneValues = evaluateSceneUniforms(this.currentScene, { sample: inputs.sample, tubeCount: this.tubeCount });
      this.sceneValuesFor = inputs.sample;
      this.sceneValuesTubes = this.tubeCount;
    }
    uploadSceneUniforms(p, this.sceneValues);
    p.tex('uSceneTex', 6, this.sceneTex);
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
      const src = i * 16;
      const dst = kept * 16;
      this.sceneData.set(this.headerAll.subarray(src, src + 16), dst);
      if (i < s.vessels.length) {
        const v = s.vessels[i];
        const scale = inputs.caliber.radiusScale(v.id);
        this.sceneData[dst + 2] = VESSEL_META[v.id].system === 'ivc' ? inputs.caliber.ivcApScale : v.tube.apScale;
        this.sceneData[dst + 3] = scale;
        this.sceneData[dst + 8] = inputs.sample.velocities[v.id] * (v.flowFactor ?? 1);
        this.sceneData[dst + 9] = v.refRadius * scale;
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
    p.fv('uTissueAlpha', this.alpha);
    p.fv('uTissueBack', this.back);
    p.fv('uTissueFlag', this.flags);
  }

  private updateCoupling(inputs: FrameInputs): void {
    const gl = this.gl;
    for (let i = 0; i < this.lines; i++) {
      const theta = lineAngle(i, inputs.transducer);
      this.couplingData[i] = lineCoupling(inputs.pose, inputs.transducer, theta);
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
  }

  /**
   * Un cuadro de imagen. Pasadas, en orden (la nomenclatura A–H es la de
   * ARCHITECTURE.md y de `shaders/passes.glsl.ts`):
   *   A transmisión (marcha por rayos, atenuación, gas, hueso, espejo) →
   *   B campo complejo crudo (dispersores + especular + ruido) →
   *   C convolución axial → D convolución lateral + envolvente →
   *   F color (cadencia propia) → G conversión de barrido + mapa de grises →
   *   persistencia → presentación. (E está reservada; H es el mapa de tejidos
   *   de depuración, `tissueMap`.)
   */
  render(inputs: FrameInputs): void {
    this.frameCount++;
    this.timer.poll();
    this.updateCoupling(inputs);
    this.updateSceneDynamic(inputs);
    const c = inputs.color;
    const colorDue = c.enabled && (inputs.updateColor || !this.lastColorFrame);
    for (const pass of FRAME_PASSES) {
      if (pass.cadence === 'color' && !colorDue) continue;
      this.timer.begin(pass.id);
      this.passes[pass.id](inputs);
      this.timer.end();
    }
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
    drawFullscreen(gl);
  }

  // A2 — atenuación acumulada hasta cada profundidad (sin clasificar)
  private passTransmissionPrefix(inputs: FrameInputs): void {
    const gl = this.gl;
    bindTarget(gl, this.tPre);
    this.pTransPre.use();
    this.setBeamUniforms(this.pTransPre, inputs);
    this.pTransPre.f('uCoarseN', COARSE_DEPTH);
    this.pTransPre.tex('uSeg', 0, this.tSeg.textures[0]);
    this.pTransPre.tex('uHits0', 1, this.tHits.textures[0]);
    this.pTransPre.tex('uHits1', 2, this.tHits.textures[1]);
    drawFullscreen(gl);
  }

  // A — transmisión con la penumbra de la apertura (y la de un solo rayo para el Doppler)
  private passTransmission(inputs: FrameInputs): void {
    const gl = this.gl;
    const beam = this.profile.beam;
    bindTarget(gl, this.tTrans);
    this.pTrans.use();
    this.setBeamUniforms(this.pTrans, inputs);
    this.pTrans.f('uCoarseN', COARSE_DEPTH);
    this.pTrans.tex('uPre0', 0, this.tPre.textures[0]);
    this.pTrans.tex('uPre1', 1, this.tPre.textures[1]);
    this.pTrans.tex('uHits0', 2, this.tHits.textures[0]);
    this.pTrans.v3('uAperture', [beam.apertureTxMm, beam.apertureRxMaxMm, beam.fNumberRxMin]);
    drawFullscreen(gl);
  }

  // B — campo crudo
  private passRawField(inputs: FrameInputs): void {
    const gl = this.gl;
    const tr = inputs.transducer;
    bindTarget(gl, this.tRaw);
    this.pRaw.use();
    this.setSceneUniforms(this.pRaw, inputs);
    this.setBeamUniforms(this.pRaw, inputs);
    this.pRaw.tex('uTrans0', 0, this.tTrans.textures[0]);
    this.pRaw.tex('uTrans1', 1, this.tTrans.textures[1]);
    this.pRaw.f('uSeed', (inputs.seed % 1000) / 7.0);
    this.pRaw.f('uLattice', 0.42);
    this.pRaw.f('uElevSigma0', 1.6);
    this.pRaw.f('uElevFocus', tr.elevationFocusMm);
    // Ruido del receptor ≈ −72 dB respecto al eco hepático sin atenuar; con el techo de 60 dB
    // de compensación el campo profundo (> 20 cm) queda como «nieve» gris oscura [EXTRAPOLACIÓN PROPIA]
    this.pRaw.f('uNoise', 0.00025);
    this.pRaw.f('uFrame', this.frameCount);
    const an = this.speckleAnchor.update(inputs.frame.face, inputs.frame.elevation);
    this.lastAnchorWeight = an.w;
    this.pRaw.v3('uAnchorE0', an.a.e);
    this.pRaw.v3('uAnchorP0', an.a.p);
    this.pRaw.v3('uAnchorE1', an.b.e);
    this.pRaw.v3('uAnchorP1', an.b.p);
    this.pRaw.v2('uAnchorSalt', an.a.parity * ANCHOR_SALT_STEP, an.b.parity * ANCHOR_SALT_STEP);
    this.pRaw.f('uAnchorW', an.w);
    this.pRaw.v4v('uTissueClump4', this.clump);
    drawFullscreen(gl);
  }

  // C — convolución axial (pulso ≈ 2 ciclos a 3,5 MHz → σ ≈ 0,26 mm)
  private passAxial(inputs: FrameInputs): void {
    const gl = this.gl;
    const depth = inputs.bmode.depthMm;
    bindTarget(gl, this.tAxial);
    this.pAxial.use();
    this.pAxial.tex('uField', 0, this.tRaw.textures[0]);
    const dz = depth / FINE_DEPTH;
    this.pAxial.f('uSigmaTexels', Math.max(0.6, 0.26 / dz));
    this.pAxial.v2('uTexel', 1 / this.lines, 1 / FINE_DEPTH);
    drawFullscreen(gl);
  }

  // D — convolución lateral + envolvente
  private passLateral(inputs: FrameInputs): void {
    const gl = this.gl;
    const tr = inputs.transducer;
    const depth = inputs.bmode.depthMm;
    bindTarget(gl, this.tEnv);
    this.pLateral.use();
    this.pLateral.tex('uField', 0, this.tAxial.textures[0]);
    this.pLateral.v2('uTexel', 1 / this.lines, 1 / FINE_DEPTH);
    this.pLateral.f('uDepth', depth);
    this.pLateral.f('uCurvR', tr.curvatureRadius);
    this.pLateral.f('uHalfSector', tr.halfSector);
    this.pLateral.f('uLinesF', this.lines);
    this.pLateral.f('uFocus', inputs.bmode.focusMm);
    this.pLateral.v4(
      'uBeam',
      this.profile.beam.k * this.profile.beam.lambdaMm,
      this.profile.beam.apertureTxMm,
      this.profile.beam.apertureRxMaxMm,
      this.profile.beam.fNumberRxMin,
    );
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
    const gl = this.gl;
    const tr = inputs.transducer;
    const depth = inputs.bmode.depthMm;
    const c = inputs.color;
    this.ensureDisplayTargets();
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.display = sectorLayout(W, H, tr, depth, DISPLAY_MARGIN_PX);
    const { apexX, apexY, scale } = this.display;
    bindTarget(gl, this.tScan);
    this.pScan.use();
    this.pScan.tex('uEnv', 0, this.tEnv.textures[0]);
    this.pScan.tex('uColor', 1, this.tColor.textures[0]);
    this.pScan.v2('uCanvas', W, H);
    this.pScan.v2('uApex', apexX, apexY);
    this.pScan.f('uScale', scale);
    this.pScan.f('uCurvR', tr.curvatureRadius);
    this.pScan.f('uHalfSector', tr.halfSector);
    this.pScan.f('uDepth', depth);
    this.pScan.f('uGainDb', inputs.bmode.gainDb);
    this.pScan.f('uRefDb', DISPLAY_REF_DB);
    // Curva nominal: compensa la atenuación de ida y vuelta del hígado a la frecuencia B.
    this.pScan.f('uNominalTgcDbPerCm', nominalTgcDbPerCm(this.profile.bEffectiveMHz));
    this.pScan.f('uTgcCapDb', TGC_CAP_DB);
    this.pScan.f('uDynRange', inputs.bmode.dynamicRangeDb);
    this.pScan.f('uGreyCurve', GREY_CURVE);
    this.pScan.fv('uTgc', inputs.bmode.tgcDb);
    this.pScan.i('uColorOn', c.enabled && this.lastColorFrame ? 1 : 0);
    const lb = this.lastColorFrame?.box ?? [0, 0, 0, 0];
    this.pScan.v4('uBox', lb[0], lb[1], lb[2], lb[3]);
    this.pScan.f('uPrf', this.lastColorFrame?.prf ?? c.prfHz);
    this.pScan.f('uColorThreshold', COLOR_DISPLAY_THRESHOLD);
    this.pScan.f('uColorPriority', COLOR_PRIORITY_GREY);
    this.pScan.i('uColorInvert', c.invert ? 1 : 0);
    drawFullscreen(gl);
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
    const gl = this.gl;
    bindTarget(gl, null, this.canvas.width, this.canvas.height);
    this.pBlit.use();
    this.pBlit.tex('uTex', 0, this.tPersist![this.persistIndex].textures[0]);
    drawFullscreen(gl);
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
   * tercer adjunto: la normal de la interfaz en cada punto (siempre se crea, para que la
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
    this.pQuery ??= new GLProgram(gl, VERT, FRAG_QUERY, 'query');
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
    for (let i = 0; i < n; i++) {
      tissue[i] = Math.round(out0[i * 4]);
      vessel[i] = Math.round(out0[i * 4 + 1]);
      ifd[i] = out0[i * 4 + 3];
      velocity.set([out1[i * 4], out1[i * 4 + 1], out1[i * 4 + 2]], i * 3);
      iface[i] = Math.round(out1[i * 4 + 3]);
      if (normal && out2) normal.set([out2[i * 4], out2[i * 4 + 1], out2[i * 4 + 2]], i * 3);
    }
    return normal ? { tissue, vessel, velocity, iface, ifd, normal } : { tissue, vessel, velocity, iface, ifd };
  }

  /**
   * Celdas del último cuadro de color con potencia por encima del umbral de presentación (las que
   * la conversión de barrido puede pintar). Solo pruebas: lectura GPU→CPU bloqueante.
   */
  /** Celdas del objetivo de color (la caja entera). */
  get colorCellCount(): number {
    return COLOR_W * COLOR_H;
  }

  colorCellsAbove(threshold = COLOR_DISPLAY_THRESHOLD): number {
    const gl = this.gl;
    const px = new Float32Array(COLOR_W * COLOR_H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tColor.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, COLOR_W, COLOR_H, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
   * Envolvente detectada del último cuadro (líneas × profundidad, antes de la compresión
   * logarítmica y de la persistencia). Solo pruebas: lectura GPU→CPU bloqueante.
   */
  readEnvelope(): { lines: number; samples: number; data: Float32Array } {
    const gl = this.gl;
    const W = this.lines;
    const H = FINE_DEPTH;
    const rgba = new Float32Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tEnv.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, rgba);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const data = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) data[i] = rgba[i * 4];
    return { lines: W, samples: H, data };
  }

  /**
   * Transmisión de un solo rayo (ida y vuelta, amplitud) y profundidad del espejo por línea ×
   * profundidad gruesa, fila k a (k + 0,5)·profundidad/COARSE_DEPTH. Solo pruebas: la paridad de la
   * pasada A con el modelo de CPU (`ultrasound/transmission.ts`).
   */
  readTransmission(): { lines: number; samples: number; single: Float32Array; aperture: Float32Array; mirrorHit: Float32Array } {
    const gl = this.gl;
    const W = this.lines;
    const H = COARSE_DEPTH;
    const read = (attachment: number): Float32Array => {
      const px = new Float32Array(W * H * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.tTrans.fbo);
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return px;
    };
    const a2 = read(2);
    const a0 = read(0);
    const single = new Float32Array(W * H);
    const aperture = new Float32Array(W * H);
    const mirrorHit = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      single[i] = a2[i * 4];
      aperture[i] = a0[i * 4];
      mirrorHit[i] = a0[i * 4 + 3];
    }
    return { lines: W, samples: H, single, aperture, mirrorHit };
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
   * Imagen mostrada del último cuadro (tras la curva de grises y la persistencia, sin color
   * encima si la caja está apagada): gris 0–255 por píxel del lienzo, fila 0 arriba, en las
   * coordenadas de `display`. Solo pruebas y banco de fidelidad: lectura GPU→CPU bloqueante.
   */
  readDisplay(): DisplayFrame {
    const gl = this.gl;
    const target = this.tPersist?.[this.persistIndex];
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

  /**
   * Lectura de depuración de una textura intermedia (fila `row` de 0..1 de la
   * profundidad; devuelve `n` muestras a lo largo de la línea `line` 0..1).
   */
  debugRead(which: 'trans0' | 'trans1' | 'raw' | 'env' | 'color', line: number, samples: number): Float32Array {
    const gl = this.gl;
    const target =
      which === 'trans0' || which === 'trans1' ? this.tTrans : which === 'raw' ? this.tRaw : which === 'env' ? this.tEnv : this.tColor;
    const attachment = which === 'trans1' ? 1 : 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
    const x = Math.min(target.width - 1, Math.max(0, Math.round(line * (target.width - 1))));
    const out = new Float32Array(samples * 4);
    const px = new Float32Array(4);
    for (let i = 0; i < samples; i++) {
      const y = Math.min(target.height - 1, Math.round((i / Math.max(1, samples - 1)) * (target.height - 1)));
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, px);
      out.set(px, i * 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }
}
