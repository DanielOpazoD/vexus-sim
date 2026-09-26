import { VESSEL_META, type VesselId } from '../physiology/vessels';
import { gateInColorBox, type EquipmentCommand } from './equipment';
import {
  equivalenceSweep,
  interfaceShellEquivalence,
  volumeEquivalence,
  type EquivalencePoseReport,
  type InterfaceShellReport,
  type VolumeEquivalenceReport,
} from './equivalenceSweep';
import { bestGateOnVessel } from './gatePlacement';
import { acousticWindowWeight, gateTransmission } from './gateTransmission';
import { contactCoupling } from '../probe/contact';
import { lineAngle, pointOnLine, type ProbePose } from '../probe/probe';
import { hilumNotchActive, kidneyLocal, kidneyOuterSdf } from '../anatomy/organs/kidney';
import { FACE_GEOMETRIES, type FaceGeometry } from '../anatomy/scene';
import { Interface, isRibInterface, isWallLayerInterface } from '../anatomy/interfaces';
import { TISSUES, Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import { FRAME_PASSES, type PassId } from '../ultrasound/passGraph';
import { rayAttenuationDb } from '../ultrasound/transmission';
import { type ApertureGeometry } from '../ultrasound/aperture';
import { compareSteeredTransmission } from './steeredParity';
import { compoundActive, lookTheta } from '../ultrasound/compound';
import { levelOfGrey } from '../ultrasound/greyMap';
import { COARSE_DEPTH, type CompoundState } from '../ultrasound/renderer';
import { pixelToBeam } from '../ultrasound/sectorGeometry';
import {
  CURTAIN_LIVER_MAX_AIR,
  centralGradient,
  clearLiverGrid,
  curtainLines,
  fidelityStats,
  pleuraStats,
  slidingCorrelation,
  type CompoundStats,
  type FidelityStats,
  type LookFrames,
  type PleuraStats,
  type TransmissionFrame,
} from './fidelity';
import type { RespiratoryPattern } from '../physiology/patientState';
import { speckleStats, type SpeckleOptions, type SpeckleStats } from './speckle';
import type { RenderMeasureOptions, Simulator } from './simulator';
import { START_POINTS, type StartPoint } from './startPoints';

/**
 * Ganchos de prueba estables (e2e). Se cargan con `import()` dinámico solo en desarrollo o
 * con `?e2e`: el barrido de equivalencia y la colocación de la puerta no viajan en el bundle
 * que abre el alumno.
 */
export interface TestHooks {
  equivalenceSweep: () => EquivalencePoseReport[];
  /** Equivalencia TS ↔ GLSL en `n` puntos aleatorios de todo el tronco. */
  volumeEquivalence: (n?: number) => VolumeEquivalenceReport;
  /** Equivalencia de la cara de interfaz y su distancia a 0,01–0,6 mm de cada cara, en los planos de partida. */
  interfaceShell: () => InterfaceShellReport;
  /**
   * Estadística del speckle en parénquima hepático (guarda de imagen). Con `startPoint`, coloca
   * antes la sonda en ese punto de partida y avanza lo justo para que el marco la siga. `compound`
   * (obligatorio, decisión 58): con `false`, la imagen de una mirada de siempre; con `true`, llena el anillo
   * de miradas y mide la envolvente compuesta. El conmutador vuelve a como estaba al terminar.
   */
  speckle: (opts: SpeckleOptions & { startPoint?: StartPoint['id']; compound: boolean }) => SpeckleStats;
  /**
   * Banco de fidelidad (decisión 52): textura de la envolvente en hígado, en total y por bandas
   * de profundidad; con `display`, además la imagen mostrada y el banco de interfaces (renderiza
   * `frames` cuadros, por defecto los que la persistencia necesita para dejar < 1 % de la vista
   * anterior; clasifica en CPU ~1–3 s). `pose` bascula (`rockDeg`) o inclina (`tiltDeg`) la sonda
   * respecto a la pose de partida; `samples` devuelve un registro por pared (`faceSamples`) para
   * agregar poses con `summarizeFaces`. `compound` (obligatorio, decisión 58): con `true` llena el anillo,
   * asienta la persistencia con él lleno, mide la envolvente compuesta en el hígado puro de las tres miradas
   * y devuelve `compound` (por banda y en la costura) y la umbra del compuesto; con `false`, la mirada 0.
   */
  fidelity: (opts: {
    compound: boolean;
    startPoint?: StartPoint['id'];
    display?: boolean;
    frames?: number;
    pose?: { rockDeg?: number; tiltDeg?: number };
    samples?: boolean;
  }) => FidelityStats;
  /**
   * Pleura parietal y cortina pulmonar (decisión 61): coloca la sonda en `startPoint` con la respiración
   * `respiration` (la apnea espiratoria deja el borde de la cortina arriba; la inspiratoria, 30 mm más abajo),
   * asienta la persistencia (con `compound`, con el anillo lleno) y devuelve `pleuraStats` de la envolvente (la
   * de la mirada 0 o la compuesta) y de la imagen mostrada, con el descenso del diafragma del cuadro. Con
   * `slidingMm`, además el deslizamiento: con la respiración tranquila, dos cuadros de una mirada entre los que
   * el pulmón baja esa distancia (`slidingCorrelation`). La respiración y el compuesto vuelven a como estaban.
   */
  pleura: (opts: {
    startPoint: StartPoint['id'];
    respiration: Extract<RespiratoryPattern, 'apnea-expiratory' | 'apnea-inspiratory'>;
    compound: boolean;
    slidingMm?: number;
  }) => PleuraStats & {
    caudalMm: number;
    sliding?: { subPleural: number; wall: number; lines: number; shiftMm: number };
  };
  /**
   * Gradientes de la GPU (el que usa el eco de interfaz, `faceGradient`; `queryPoints` con `normals`)
   * frente al gradiente de `faceSdf` de TS en las caras que dan brillo: por tipo de cara (y los
   * subconjuntos de `FACE_NORMAL_SUBSETS`), |n·∇| y el error relativo de la norma en los puntos del plano
   * a 0,02–0,4 mm de ella que caen en un tejido que la dibuja, con el mismo tejido en la GPU y en la
   * CPU. `pose` bascula o inclina la sonda respecto a la pose de partida, como en `fidelity`.
   */
  faceNormals: (opts: {
    startPoint: StartPoint['id'];
    pose?: { rockDeg?: number; tiltDeg?: number };
  }) => Record<FaceNormalRow, FaceNormalStats>;
  /**
   * Caras de la pared y de las costillas (decisión 62): la cara, la normal y la norma del gradiente de la GPU
   * (`faceGradient`: `wallFaceSd`, `ribSd`) frente a las de TS (`AnatomyScene.faceGradient`) en los puntos del
   * plano a 0,02–0,4 mm de la cara que dibujan según la CPU. Ver `WallNormalStats`.
   */
  wallNormals: (opts: { startPoint: StartPoint['id'] }) => WallNormalStats;
  /**
   * Coste medio de `n` cuadros de imagen en tiempo de pared (ms), sincronizado con la GPU al
   * principio y al final: compara versiones del renderizador en la misma máquina. El reloj no avanza,
   * así que con la caja de color encendida la cadencia del color (decisión 39) saltaría casi todos los
   * cuadros: entonces exige `forceColor`, y lanza (en vez de devolver ≈ 0 ms) sin él, con la imagen
   * congelada o con `n` que no sea un entero ≥ 1. Ver `FrameCostOptions`.
   */
  frameCostMs: (n: number, opts?: FrameCostOptions) => number;
  /**
   * Paridad de la pasada A (un solo rayo) con el modelo de CPU `rayAttenuationDb` en los mismos
   * puntos de muestra, cada `every` líneas y en todas las profundidades gruesas; se saltan las líneas
   * con espejo (la CPU no sigue el rayo reflejado) y las transmisiones por debajo de −60 dB. Con `look` ≥ 1
   * (exige `compound`, decisión 58) compara la mirada dirigida de la GPU (el prefijo de A2 y la
   * transmisión con apertura de A) con sus gemelos de TS (`steeredPrefixDb`, `steeredApertureTransmission`)
   * sobre los mismos segmentos de A0/A1 de la GPU; las muestras en un empate de redondeo (desplazar los
   * redondeos de los gemelos ±`STEERED_TIE_LINES` líneas cambia el resultado) se cuentan aparte.
   */
  transmissionParity: (opts: { compound: boolean; look?: number; startPoint?: StartPoint['id']; every?: number; ambiguityMm?: number }) => {
    lines: number;
    samples: number;
    maxDiffDb: number;
    /** Solo miradas dirigidas: el peor desacuerdo de la transmisión con apertura (dB) y las muestras en empate. */
    apertureMaxDiffDb?: number;
    ambiguous?: number;
    /** Líneas cortadas en su primer segmento de tejido ambiguo (otro tejido a ±`ambiguityMm` del centro). */
    truncatedLines: number;
    /** Dónde está el peor desacuerdo (diagnóstico del mensaje de la e2e). */
    worst: { line: number; depthMm: number; cpuDb: number; gpuDb: number; tissue: string } | null;
  };
  /**
   * Persistencia del moteado al mover la sonda (decisión 55): correlación de la envolvente en el
   * hígado entre la pose de partida y la misma pose con `tiltDeg`/`yawDeg` más (`moved`), y al volver
   * a la pose (`back`). Entre cuadros avanza un solo paso de fisiología: la respiración no cuenta. Con
   * `compound`, en cada pose se forman las tres miradas (tres cuadros) y se compara la envolvente compuesta.
   */
  speckleMotion: (opts: { startPoint: StartPoint['id']; tiltDeg?: number; yawDeg?: number; compound: boolean }) => {
    samples: number;
    moved: number;
    back: number;
  };
  /**
   * Fundido del ancla del medio en la GPU (decisión 55): gira la sonda `stepDeg` por cuadro durante
   * `frames` cuadros y devuelve por cuadro el peso del fundido, la SNR y el nivel del hígado (dB
   * frente al primero, sumando los pasos de cuadro a cuadro medidos en las muestras comunes a las dos
   * máscaras) y la correlación del moteado con el cuadro anterior (sin tendencia). Con `compound`, un
   * cuadro (una mirada) por paso, como la aplicación, y la envolvente compuesta.
   */
  speckleCrossfade: (opts: { startPoint: StartPoint['id']; stepDeg: number; frames: number; compound: boolean }) => {
    w: number;
    snr: number;
    levelDb: number;
    corrPrev: number;
  }[];
  /**
   * Centra la caja de color sobre uno de los vasos (colocación del operador), avanza lo justo para
   * que toque un cuadro de color y devuelve las celdas con potencia visible; null si no ve el vaso.
   */
  colorOnVessel: (vessels: VesselId[]) => number | null;
  /** Celdas de color visibles tras forzar un cuadro de color (sin mover la caja). */
  colorCells: () => number;
  /** Funciones encendidas del equipo, puerta y centro de la caja (θ rad, r mm) y si la puerta está dentro (tríplex, 66). */
  modeState: () => {
    color: boolean;
    pw: boolean;
    gateInBox: boolean;
    frameHz: number;
    gate: { theta: number; r: number };
    box: { theta: number; r: number };
  };
  /** Coloca la puerta PW en (θ, r) como un clic del alumno. */
  placeGateAt: (theta: number, r: number) => void;
  /** Fracción de las celdas de la caja de color visibles tras forzar un cuadro (0–1). */
  colorCellFraction: () => number;
  /** Fija la ganancia de color (dB) como el deslizador. */
  setColorGainDb: (db: number) => void;
  /**
   * Transmisión de ida y vuelta (dB, con acoplamiento) en la puerta PW actual, tal como la ven el color y el PW.
   * `color`: el téxel de la pasada A de la GPU que lee el color en la puerta (NEAREST: su línea y su fila por
   * defecto), convertido a la frecuencia Doppler y con el acoplamiento que muestrea el color. `cpu`: el mismo
   * téxel en la CPU (`rayAttenuationDb` sobre los segmentos de A hasta esa fila, por el centro de esa línea),
   * como intervalo [mín, máx]: un segmento cuyo centro está a < 0,02 mm de una interfaz puede caer de un lado en
   * float32 y del otro en float64, y el intervalo admite los dos. `pw`: la marcha del PW (pasos de 2,5 mm) en la
   * puerta exacta; `pwAtTexel`, la misma marcha en el punto del téxel (su línea y el final de su fila).
   */
  gateTransmissionDb: () => {
    color: number;
    cpu: [number, number];
    pw: number;
    pwAtTexel: number;
    texel: { line: number; row: number; theta: number; depthMm: number; ambiguousSegments: number };
  };
  /** Potencia de la banda PW sobre el suelo de ruido (dB, mediana de los últimos `seconds`). */
  pwBandOverFloorDb: (seconds: number) => number | null;
  /** Coloca la sonda en un punto de partida (sin animación) y avanza lo justo para que el marco la siga. */
  goToStartPoint: (id: StartPoint['id']) => void;
  /** Lleva la sonda a una pose cualquiera (capturas del banco y búsqueda de ventanas). */
  setPose: (pose: ProbePose) => void;
  /** Separa la sonda de la piel `mm` (0 = contacto) sin tocar el resto de la pose. */
  liftProbe: (mm: number) => void;
  /** Avanza la simulación (fisiología + PW) `seconds` sin renderizar: SwiftShader es lento. */
  advance: (seconds: number) => void;
  /** Coloca la puerta PW sobre uno de los vasos con la técnica del operador; false si no lo ve. */
  placeGate: (vessels: VesselId[]) => boolean;
  /** Enciende o apaga la composición espacial con el comando del equipo (decisión 58). */
  setCompound: (on: boolean) => void;
  /** Estado del anillo de miradas tras el último cuadro (decisión 58). */
  compoundState: () => CompoundState;
  /**
   * Correlación entre miradas y composición por banda en el hígado puro (decisión 58): llena el anillo en
   * `startPoint` y devuelve la parte `compound` del banco (sin la imagen mostrada).
   */
  lookCorrelation: (opts: { startPoint: StartPoint['id'] }) => CompoundStats;
  /**
   * Estabilidad temporal del compuesto en escena quieta (decisión 58, K7): llena el anillo, asienta la
   * persistencia y dibuja `frames` cuadros más; de la imagen mostrada en el hígado despejado da la
   * correlación entre cuadros consecutivos y la modulación de periodo 3 (una mirada por cuadro) del nivel.
   */
  temporalStability: (opts: { startPoint: StartPoint['id']; frames: number }) => {
    frames: number;
    pixels: number;
    corrMin: number;
    corrMedian: number;
    /** Nivel mostrado medio por cuadro (dB bajo el techo del rango dinámico). */
    levelDb: number[];
    /** Máximo menos mínimo de los niveles medios de las tres fases del anillo (dB). */
    period3Db: number;
  };
  /**
   * La guarda de `readEnvelope` (decisión 58): con el compuesto, tras un cuadro de mirada dirigida, leer la
   * mirada 0 lanza; devuelve si lanzó, el mensaje y la mirada del último cuadro.
   */
  envelopeGuard: (opts: { startPoint: StartPoint['id'] }) => { threw: boolean; message: string; look: number };
}

/** Opciones de `frameCostMs`. */
export interface FrameCostOptions {
  /**
   * Cada cuadro es completo y CON la pasada de color. Si la caja está apagada, la enciende con el
   * comando del equipo (el camino de la aplicación) y la deja como estaba al terminar, aunque falle.
   */
  forceColor?: boolean;
  /**
   * Repite esa pasada `repeatCount` veces más (1 por defecto) dentro de cada cuadro, sin cambiar la
   * imagen: su coste es la diferencia con la medida sin repetir dividida por `repeatCount`. Metal no
   * separa el tiempo de las pasadas (decisión 47). Una pasada de cadencia de color exige `forceColor`.
   */
  repeatPass?: PassId;
  repeatCount?: number;
  /**
   * Coloca antes la sonda en ese punto de partida (como `fidelity`), para comparar medidas en la misma
   * pose: el barrido del banco (`--sweep`) deja la sonda movida entre la medida sin color y la con color.
   */
  startPoint?: StartPoint['id'];
}

/** Valida las opciones de `frameCostMs` (nada de ignorarlas en silencio) y las traduce a las de `render`. */
export function frameMeasureOptions(opts: FrameCostOptions = {}): RenderMeasureOptions {
  const { forceColor = false, repeatPass, repeatCount } = opts;
  if (repeatPass === undefined) {
    if (repeatCount !== undefined) throw new RangeError('frameCostMs: repeatCount sin repeatPass');
    return { forceColor };
  }
  const spec = FRAME_PASSES.find((p) => p.id === repeatPass);
  if (!spec) throw new RangeError(`frameCostMs: «${String(repeatPass)}» no es una pasada de FRAME_PASSES`);
  const times = repeatCount ?? 1;
  if (!Number.isInteger(times) || times < 1) throw new RangeError(`frameCostMs: repeatCount ${times} (entero ≥ 1)`);
  // sin forzar el color, la pasada de color no se dibuja en casi ningún cuadro: no habría qué repetir
  if (spec.cadence === 'color' && !forceColor) throw new RangeError(`frameCostMs: repetir «${repeatPass}» exige forceColor`);
  return { forceColor, repeat: { pass: repeatPass, times } };
}

export function createTestHooks(getSim: () => Simulator, dispatch: (cmd: EquipmentCommand) => void): TestHooks {
  const hooks: TestHooks = {
    equivalenceSweep: () => equivalenceSweep(getSim()),
    volumeEquivalence: (n) => volumeEquivalence(getSim(), n),
    interfaceShell: () => interfaceShellEquivalence(getSim()),
    speckle: (opts) => {
      const sim = getSim();
      return withCompound(sim, dispatch, opts.compound, () => {
        if (opts.startPoint) goTo(sim, opts.startPoint);
        if (opts.compound) {
          fillRing(sim);
          return speckleStats(sim, sim.renderer.readEnvelope({ source: 'compound' }), opts);
        }
        sim.render();
        return speckleStats(sim, sim.renderer.readEnvelope(), opts);
      });
    },
    fidelity: (opts) => {
      const sim = getSim();
      return withCompound(sim, dispatch, opts.compound, () => {
        if (opts.startPoint) goTo(sim, opts.startPoint);
        if (opts.pose) offsetPose(sim, opts.pose);
        // la persistencia deja p^n de la vista anterior: cuadros hasta que quede < 1 % (máx. 30)
        const p = Math.min(0.95, Math.max(0, sim.bmode.persistence));
        const settle = p > 0 ? Math.min(30, Math.ceil(Math.log(0.01) / Math.log(p))) : 1;
        const frames = opts.display ? Math.max(1, opts.frames ?? settle) : 1;
        if (!opts.compound) {
          for (let i = 0; i < frames; i++) sim.render();
          const img = opts.display ? sim.renderer.readDisplay() : null;
          const transmission = sim.renderer.readTransmission();
          return fidelityStats(sim, sim.renderer.readEnvelope(), img, { colorOn: sim.color.enabled, transmission, samples: opts.samples });
        }
        // compuesto: el anillo lleno, la persistencia asentada con él y la transmisión de cada mirada leída en el
        // cuadro que la forma (las N últimas: la escena no se mueve entre cuadros)
        fillRing(sim);
        const order = sim.profile.compound.order;
        const transmissions: TransmissionFrame[] = [];
        const total = Math.max(frames, order.length);
        for (let i = 0; i < total; i++) {
          sim.render();
          if (i >= total - order.length) {
            const look = sim.renderer.compoundState().look;
            transmissions[look] = sim.renderer.readTransmission({ look });
          }
        }
        const img = opts.display ? sim.renderer.readDisplay() : null;
        const looks: LookFrames = {
          thetas: order.map((_, i) => lookTheta(i, sim.profile.compound)),
          envelopes: order.map((_, i) => sim.renderer.readLookEnvelope(i)),
          transmissions,
        };
        return fidelityStats(sim, sim.renderer.readEnvelope({ source: 'compound' }), img, {
          colorOn: sim.color.enabled,
          transmission: transmissions[0],
          looks,
          samples: opts.samples,
        });
      });
    },
    pleura: (opts) => {
      const sim = getSim();
      const pattern = sim.patient.respiratoryPattern;
      try {
        sim.patient.respiratoryPattern = opts.respiration;
        const stats = withCompound(sim, dispatch, opts.compound, () => {
          goTo(sim, opts.startPoint);
          // la persistencia deja p^n de la vista anterior: cuadros hasta que quede < 1 % (máx. 30)
          const p = Math.min(0.95, Math.max(0, sim.bmode.persistence));
          const frames = p > 0 ? Math.min(30, Math.ceil(Math.log(0.01) / Math.log(p))) : 1;
          if (opts.compound) fillRing(sim);
          for (let i = 0; i < frames; i++) sim.render();
          const env = opts.compound ? sim.renderer.readEnvelope({ source: 'compound' }) : sim.renderer.readEnvelope();
          return pleuraStats(sim, env, sim.renderer.readDisplay(), curtainLines(sim, env.lines));
        });
        const caudalMm = sim.sample.resp.diaphragmCaudalMm;
        if (!opts.slidingMm) return { ...stats, caudalMm };
        const sliding = withCompound(sim, dispatch, false, () => slidingAt(sim, opts.slidingMm!));
        return { ...stats, caudalMm, sliding };
      } finally {
        sim.patient.respiratoryPattern = pattern;
      }
    },
    faceNormals: (opts) => {
      const sim = getSim();
      goTo(sim, opts.startPoint);
      if (opts.pose) offsetPose(sim, opts.pose);
      return faceNormalStats(sim);
    },
    wallNormals: (opts) => {
      const sim = getSim();
      goTo(sim, opts.startPoint);
      return wallNormalStats(sim);
    },
    frameCostMs: (n, opts) => {
      const measure = frameMeasureOptions(opts);
      if (!Number.isInteger(n) || n < 1) throw new RangeError(`frameCostMs: n ${n} (entero ≥ 1)`);
      const sim = getSim();
      // sin cuadros dibujados la media sería ≈ 0 ms: un número sin sentido, no una medida
      if (sim.frozen) throw new RangeError('frameCostMs: con la imagen congelada no se dibuja ningún cuadro');
      if (sim.color.enabled && !measure.forceColor)
        throw new RangeError(
          'frameCostMs: con la caja de color encendida hace falta forceColor (con el reloj quieto su cadencia salta los cuadros)',
        );
      if (opts?.startPoint) goTo(sim, opts.startPoint);
      const switchColor = measure.forceColor === true && !sim.color.enabled;
      if (switchColor) dispatch({ type: 'color', patch: { enabled: true } });
      try {
        sim.render(measure);
        sim.renderer.finishForTiming();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) sim.render(measure);
        sim.renderer.finishForTiming();
        return (performance.now() - t0) / n;
      } finally {
        if (switchColor) dispatch({ type: 'color', patch: { enabled: false } });
      }
    },
    speckleMotion: (opts) => {
      const sim = getSim();
      return withCompound(sim, dispatch, opts.compound, () => {
        goTo(sim, opts.startPoint);
        const base = { ...sim.pose };
        const rad = Math.PI / 180;
        const looks = opts.compound ? sim.profile.compound.order.length : 1;
        const a = envelopeAt(sim, base, opts.compound, looks);
        const mask = liverMask(sim, a);
        const b = envelopeAt(
          sim,
          { ...base, tilt: base.tilt + (opts.tiltDeg ?? 0) * rad, yaw: base.yaw + (opts.yawDeg ?? 0) * rad },
          opts.compound,
          looks,
        );
        const c = envelopeAt(sim, base, opts.compound, looks);
        return { samples: mask.length, moved: speckleCorrelation(a, b, mask), back: speckleCorrelation(a, c, mask) };
      });
    },
    speckleCrossfade: (opts) => {
      const sim = getSim();
      return withCompound(sim, dispatch, opts.compound, () => crossfade(sim, opts));
    },
    transmissionParity: (opts) =>
      withCompound(getSim(), dispatch, opts.compound, () => {
        const sim = getSim();
        if (opts.startPoint) goTo(sim, opts.startPoint);
        const look = opts.look ?? 0;
        if (look !== 0) return steeredParity(sim, look, Math.max(1, opts.every ?? 8));
        sim.render();
        const gpu = sim.renderer.readTransmission();
        const tr = sim.transducer;
        const depth = sim.bmode.depthMm;
        const step = depth / gpu.samples;
        const every = Math.max(1, opts.every ?? 8);
        // Un segmento cuyo centro está a menos de ε de una interfaz puede caer de un lado en float32 y del
        // otro en float64 (SwiftShader llega a 0,014 mm en la cara del diafragma; el intestino, con ruido,
        // más): la suma de A2 difiere entonces en un segmento (2·Δα·paso, 0,06–0,27 dB) de ahí en adelante.
        // La clasificación ya la comprueba la equivalencia; aquí se compara la suma hasta ese segmento.
        const eps = opts.ambiguityMm ?? 0.02;
        const classifyAt = (theta: number, r: number): Tissue =>
          sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, theta, r), sim.sample).tissue;
        let lines = 0;
        let samples = 0;
        let maxDiffDb = 0;
        let truncatedLines = 0;
        let worst: { line: number; depthMm: number; cpuDb: number; gpuDb: number; tissue: string } | null = null;
        for (let u = 0; u < gpu.lines; u += every) {
          if (gpu.mirrorHit[(gpu.samples - 1) * gpu.lines + u] >= 0) continue;
          const theta = -tr.halfSector + (2 * tr.halfSector * (u + 0.5)) / gpu.lines;
          const tissues: Tissue[] = [];
          lines++;
          for (let k = 0; k < gpu.samples; k++) {
            const r = (k + 0.5) * step;
            const t = classifyAt(theta, r);
            if (eps > 0 && (classifyAt(theta, r - eps) !== t || classifyAt(theta, r + eps) !== t)) {
              truncatedLines++;
              break;
            }
            tissues.push(t);
            const cpuDb = rayAttenuationDb(tissues, step, sim.profile.bEffectiveMHz);
            const gpuDb = -20 * Math.log10(Math.max(gpu.single[k * gpu.lines + u], 1e-12));
            if (cpuDb > 60 && gpuDb > 60) continue;
            samples++;
            const diff = Math.abs(cpuDb - gpuDb);
            if (diff > maxDiffDb) {
              maxDiffDb = diff;
              worst = { line: u, depthMm: r, cpuDb, gpuDb, tissue: TISSUES[t].name };
            }
          }
        }
        return { lines, samples, maxDiffDb, truncatedLines, worst };
      }),
    colorOnVessel: (vessels) => {
      const sim = getSim();
      const g = bestGateOnVessel(
        sim.anatomy,
        sim.frame,
        sim.transducer,
        sim.sample,
        vessels,
        sim.bmode.depthMm - 5,
        1.2,
        windowWeight(sim),
      );
      if (!g) return null;
      dispatch({ type: 'centerColorBox', theta: g.theta, r: g.r });
      return renderColorFrame(sim);
    },
    colorCells: () => renderColorFrame(getSim()),
    modeState: () => {
      const sim = getSim();
      return {
        color: sim.color.enabled,
        pw: sim.pw.enabled,
        gateInBox: gateInColorBox({ bmode: sim.bmode, color: sim.color, pw: sim.pw }),
        frameHz: sim.colorTiming.frameHz,
        gate: { theta: sim.pw.theta, r: sim.pw.depthMm },
        box: { theta: (sim.color.theta0 + sim.color.theta1) / 2, r: (sim.color.r0 + sim.color.r1) / 2 },
      };
    },
    placeGateAt: (theta, r) => dispatch({ type: 'placeGate', theta, r }),
    colorCellFraction: () => {
      const sim = getSim();
      return renderColorFrame(sim) / sim.renderer.colorCellCount;
    },
    setColorGainDb: (db) => dispatch({ type: 'color', patch: { gainDb: db } }),
    gateTransmissionDb: () => {
      const sim = getSim();
      sim.render();
      const { theta, depthMm } = sim.pw;
      const tr = sim.transducer;
      const depth = sim.bmode.depthMm;
      const lines = sim.renderer.lines;
      const u = (theta + tr.halfSector) / (2 * tr.halfSector);
      const tb = sim.renderer.transmissionAt(u, depthMm / depth);
      const fB = sim.profile.bEffectiveMHz;
      const ratio = sim.profile.dopplerEffectiveMHz / fB;
      // el téxel que lee el color (el mismo índice que `transmissionAt`) y el acoplamiento como lo muestrea:
      // textura LINEAR de `lines` téxeles con el valor de `lineAngle(i)` en el i-ésimo
      const line = Math.min(lines - 1, Math.max(0, Math.floor(u * lines)));
      const row = Math.min(COARSE_DEPTH - 1, Math.max(0, Math.floor((depthMm / depth) * COARSE_DEPTH)));
      const x = Math.min(lines - 1, Math.max(0, u * lines - 0.5));
      const i0 = Math.floor(x);
      const i1 = Math.min(lines - 1, i0 + 1);
      const cAt = (i: number) => contactCoupling(sim.contact, lineAngle(i, tr));
      const coupling = cAt(i0) + (cAt(i1) - cAt(i0)) * (x - i0);
      const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-12));
      const color = db(Math.pow(Math.max(tb, 1e-12), ratio) * coupling);
      // el mismo téxel en la CPU: segmentos de la pasada A por el centro de la línea, con los dos lados de
      // cada segmento ambiguo (centro a < 0,02 mm de una interfaz)
      const thetaTexel = -tr.halfSector + (2 * tr.halfSector * (line + 0.5)) / lines;
      const step = depth / COARSE_DEPTH;
      const at = (r: number) => sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, thetaTexel, r), sim.sample).tissue;
      const options: Tissue[][] = [];
      for (let k = 0; k <= row; k++) {
        const r = (k + 0.5) * step;
        options.push([...new Set([at(r), at(r - 0.02), at(r + 0.02)])]);
      }
      const ambiguous = options.filter((o) => o.length > 1).length;
      if (ambiguous > 12) throw new Error(`gateTransmissionDb: ${ambiguous} segmentos ambiguos en el téxel`);
      let lo = Infinity;
      let hi = -Infinity;
      const path: Tissue[] = [];
      const walk = (k: number): void => {
        if (k === options.length) {
          const v = -rayAttenuationDb(path, step, fB) * ratio + db(coupling);
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
          return;
        }
        for (const t of options[k]) {
          path.push(t);
          walk(k + 1);
          path.pop();
        }
      };
      walk(0);
      const fD = sim.profile.dopplerEffectiveMHz;
      const pw = gateTransmission(sim.anatomy, sim.frame, tr, sim.contact, theta, depthMm, sim.sample, fD);
      const pwAtTexel = gateTransmission(sim.anatomy, sim.frame, tr, sim.contact, thetaTexel, (row + 1) * step, sim.sample, fD);
      return {
        color,
        cpu: [lo, hi],
        pw: db(pw),
        pwAtTexel: db(pwAtTexel),
        texel: { line, row, theta: thetaTexel, depthMm: (row + 1) * step, ambiguousSegments: ambiguous },
      };
    },
    pwBandOverFloorDb: (seconds) => {
      const cols = getSim().spectral.columns;
      if (cols.length === 0) return null;
      const tEnd = cols[cols.length - 1].t;
      const vals = cols
        .filter((c) => c.t > tEnd - seconds)
        .map((c) => {
          const sorted = [...c.powerDb].sort((a, b) => a - b);
          return sorted[sorted.length - 3] - sorted[Math.floor(sorted.length / 2)];
        })
        .sort((a, b) => a - b);
      return vals[Math.floor(vals.length / 2)];
    },
    goToStartPoint: (id) => goTo(getSim(), id),
    setPose: (pose) => {
      const sim = getSim();
      sim.setPose(pose);
      sim.advance(0.05);
    },
    liftProbe: (mm) => {
      const sim = getSim();
      sim.setPose({ ...sim.pose, lift: mm });
      sim.advance(0.05);
    },
    advance: (seconds) => {
      const sim = getSim();
      for (let t = 0; t < seconds; t += 1 / 60) sim.advance(1 / 60);
    },
    placeGate: (vessels) => {
      const sim = getSim();
      const g = bestGateOnVessel(
        sim.anatomy,
        sim.frame,
        sim.transducer,
        sim.sample,
        vessels,
        sim.bmode.depthMm - 5,
        1.2,
        windowWeight(sim),
      );
      if (!g) return false;
      dispatch({ type: 'placeGate', theta: g.theta, r: g.r });
      return true;
    },
    setCompound: (on) => dispatch({ type: 'compound', enabled: on }),
    compoundState: () => getSim().renderer.compoundState(),
    lookCorrelation: (opts) => {
      const c = hooks.fidelity({ compound: true, startPoint: opts.startPoint }).compound;
      if (!c) throw new Error('lookCorrelation: el banco no devolvió la composición');
      return c;
    },
    temporalStability: (opts) => {
      const sim = getSim();
      return withCompound(sim, dispatch, true, () => temporalStability(sim, opts));
    },
    envelopeGuard: (opts) => {
      const sim = getSim();
      return withCompound(sim, dispatch, true, () => {
        goTo(sim, opts.startPoint);
        fillRing(sim);
        // un cuadro de mirada dirigida al final: leer la mirada 0 debe lanzar
        for (let i = 0; i < sim.profile.compound.order.length && sim.renderer.compoundState().look === 0; i++) sim.render();
        const look = sim.renderer.compoundState().look;
        try {
          sim.renderer.readEnvelope();
          return { threw: false, message: '', look };
        } catch (e) {
          return { threw: true, message: e instanceof Error ? e.message : String(e), look };
        }
      });
    },
  };
  return hooks;
}

/**
 * Pone el conmutador del compuesto en `on` con el comando del equipo mientras dura `fn` y lo deja como
 * estaba al terminar, aunque falle (decisión 58: los ganchos dicen siempre con qué imagen miden).
 */
function withCompound<T>(sim: Simulator, dispatch: (cmd: EquipmentCommand) => void, on: boolean, fn: () => T): T {
  const was = sim.bmode.compound;
  if (was !== on) dispatch({ type: 'compound', enabled: on });
  try {
    return fn();
  } finally {
    if (was !== on) dispatch({ type: 'compound', enabled: was });
  }
}

/**
 * Dibuja N cuadros (una mirada cada uno, en el orden del anillo): las N ranuras quedan escritas en el
 * instante y la pose de ahora, tanto si el primer cuadro reinicia el anillo (salto de pose) como si no (las
 * de antes serían de otro instante). Lanza si el compuesto no se forma (color encendido, regla de
 * actividad), si la imagen está congelada o si el anillo no queda lleno: medir «el compuesto» sobre una
 * sola mirada sería un número sin sentido.
 */
function fillRing(sim: Simulator): void {
  if (!compoundActive(sim.bmode, sim.color))
    throw new Error('el compuesto no se forma: conmutador apagado o caja de color encendida (compoundActive)');
  if (sim.frozen) throw new Error('con la imagen congelada no se dibuja ningún cuadro');
  const n = sim.profile.compound.order.length;
  for (let i = 0; i < n; i++) sim.render();
  if (sim.renderer.compoundState().validCount !== n)
    throw new Error(`el anillo no se llena en ${n} cuadros: ${JSON.stringify(sim.renderer.compoundState())}`);
}

/**
 * Paridad de la mirada dirigida `look` (decisión 58, G8): dibuja hasta que el último cuadro sea esa mirada,
 * lee los segmentos de A0/A1 de la GPU y compara, cada `every` líneas y en todas las filas, el prefijo de A2
 * (dB) y la transmisión con apertura de A con sus gemelos de TS sobre esos segmentos
 * (`compareSteeredTransmission`): una muestra en un empate de redondeo (la GPU calcula en float32) cuenta
 * como ambigua y no entra en el máximo.
 */
function steeredParity(sim: Simulator, look: number, every: number): ReturnType<TestHooks['transmissionParity']> {
  const n = sim.profile.compound.order.length;
  if (!Number.isInteger(look) || look < 0 || look >= n) throw new RangeError(`transmissionParity: mirada ${look} fuera del anillo (${n})`);
  if (!compoundActive(sim.bmode, sim.color)) throw new Error('transmissionParity: una mirada dirigida exige el compuesto activo');
  // al menos un cuadro en la pose pedida; luego, hasta que el último sea la mirada `look`
  for (let i = 0; i < 2 * n; i++) {
    sim.render();
    if (sim.renderer.compoundState().look === look) break;
  }
  const gpu = sim.renderer.readTransmission({ look });
  const depth = sim.bmode.depthMm;
  const grid = sim.renderer.readSegments(depth);
  const tr = sim.transducer;
  const beam = sim.profile.beam;
  const ap: ApertureGeometry = {
    lines: gpu.lines,
    halfSector: tr.halfSector,
    curvatureRadius: tr.curvatureRadius,
    apertureTxMm: beam.apertureTxMm,
    apertureRxMaxMm: beam.apertureRxMaxMm,
    fNumberRxMin: beam.fNumberRxMin,
  };
  const parity = compareSteeredTransmission(
    grid,
    ap,
    gpu.theta,
    { lines: gpu.lines, samples: gpu.samples, prefixDb: gpu.prefixDb!, aperture: gpu.aperture },
    every,
  );
  return { ...parity, truncatedLines: 0 };
}

/** Estabilidad temporal del compuesto en escena quieta (`TestHooks.temporalStability`). */
function temporalStability(
  sim: Simulator,
  opts: { startPoint: StartPoint['id']; frames: number },
): ReturnType<TestHooks['temporalStability']> {
  if (!Number.isInteger(opts.frames) || opts.frames < 3) throw new RangeError(`temporalStability: frames ${opts.frames} (entero ≥ 3)`);
  goTo(sim, opts.startPoint);
  fillRing(sim);
  const p = Math.min(0.95, Math.max(0, sim.bmode.persistence));
  const settle = p > 0 ? Math.min(30, Math.ceil(Math.log(0.01) / Math.log(p))) : 1;
  for (let i = 0; i < settle; i++) sim.render();
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  const lines = tr.lines;
  const clear = clearLiverGrid(sim, lines, 3);
  const dTheta = (2 * tr.halfSector) / lines;
  const grays: Uint8Array[] = [];
  const phases: number[] = [];
  let idx: number[] = [];
  for (let f = 0; f < opts.frames; f++) {
    sim.render();
    phases.push(sim.renderer.compoundState().look);
    const img = sim.renderer.readDisplay();
    if (f === 0) {
      // píxeles del hígado despejado (cada 2), una vez: la escena no se mueve
      for (let y = 0; y < img.height; y += 2)
        for (let x = 0; x < img.width; x += 2) {
          const b = pixelToBeam(sim.renderer.display, tr, depth, x, y);
          if (!b) continue;
          const u = Math.round((b.theta + tr.halfSector) / dTheta - 0.5);
          if (clear.at(u, b.r)) idx.push(y * img.width + x);
        }
      if (idx.length < 100) throw new Error(`temporalStability: ${idx.length} píxeles de hígado despejado`);
    }
    grays.push(img.gray);
  }
  idx = idx.filter((i) => grays.every((g) => i < g.length));
  const dr = sim.bmode.dynamicRangeDb;
  const levelDb = grays.map((g) => idx.reduce((s, i) => s + (levelOfGrey(g[i] / 255) - 1) * dr, 0) / idx.length);
  const corr: number[] = [];
  for (let f = 1; f < grays.length; f++) {
    const a = idx.map((i) => grays[f - 1][i]);
    const b = idx.map((i) => grays[f][i]);
    corr.push(pearsonOf(a, b));
  }
  const byPhase = new Map<number, number[]>();
  phases.forEach((ph, f) => byPhase.set(ph, [...(byPhase.get(ph) ?? []), levelDb[f]]));
  const phaseMeans = [...byPhase.values()].map((v) => v.reduce((s, x) => s + x, 0) / v.length);
  const sorted = [...corr].sort((x, y) => x - y);
  return {
    frames: grays.length,
    pixels: idx.length,
    corrMin: sorted[0],
    corrMedian: sorted[sorted.length >> 1],
    levelDb,
    period3Db: Math.max(...phaseMeans) - Math.min(...phaseMeans),
  };
}

function pearsonOf(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}

/** Fundido del ancla (`TestHooks.speckleCrossfade`): un cuadro por paso de giro. */
function crossfade(
  sim: Simulator,
  opts: { startPoint: StartPoint['id']; stepDeg: number; frames: number; compound: boolean },
): { w: number; snr: number; levelDb: number; corrPrev: number }[] {
  goTo(sim, opts.startPoint);
  const pose = { ...sim.pose };
  const frames: { w: number; snr: number; levelDb: number; corrPrev: number }[] = [];
  // con el compuesto, el primer cuadro llena el anillo; luego una mirada por paso, como la aplicación
  let prev = envelopeAt(sim, pose, opts.compound, opts.compound ? sim.profile.compound.order.length : 1);
  let prevMask = liverMask(sim, prev);
  // El nivel se suma paso a paso en las muestras de hígado comunes a las dos máscaras: la envolvente no lleva la
  // compensación de la atenuación, y un giro que mete o saca hígado a otra profundidad (o la sombra y la penumbra
  // de una costilla, decisión 62) cambiaba la media de toda la máscara sin que cambiara el brillo de nada.
  let levelDb = 0;
  for (let f = 0; f < opts.frames; f++) {
    pose.yaw += (opts.stepDeg * Math.PI) / 180;
    const env = envelopeAt(sim, pose, opts.compound, 1);
    const mask = liverMask(sim, env);
    const d = detrended(env, mask).filter(Number.isFinite);
    const mean = d.reduce((s, v) => s + v, 0) / d.length;
    const sd = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / d.length);
    const inPrev = new Set(prevMask);
    const common = mask.filter((i) => inPrev.has(i));
    levelDb += 20 * Math.log10(meanOf(env.data, common) / meanOf(prev.data, common));
    frames.push({
      w: sim.renderer.speckleAnchorWeight,
      snr: mean / sd,
      levelDb,
      corrPrev: speckleCorrelation(prev, env, prevMask),
    });
    prev = env;
    prevMask = mask;
  }
  return frames;
}

/** Caras de la pared y de las costillas en un plano: la GPU frente a TS (ver `TestHooks.wallNormals`). */
export interface WallNormalStats {
  points: number;
  /** Puntos por cara (nombre de `Interface`), para ver que la prueba tiene dientes. */
  byFace: Record<string, number>;
  /** Puntos con otra cara en la GPU (el reparto de dueños de la pared es una comparación real). */
  mismatched: number;
  /** |n_GPU·n_TS|: percentil 5 y mínimo, en los puntos con la misma cara. */
  p05: number;
  min: number;
  /** |g_GPU/g_TS − 1| de la norma del gradiente: percentil 95. */
  normErrP95: number;
  worst: string;
}

/** Como mucho, tantos puntos de pared por plano (la GPU los consulta de una vez). */
const WALL_POINTS_MAX = 3000;

export function wallNormalStats(sim: Simulator): WallNormalStats {
  const tr = sim.transducer;
  const scene = sim.scene;
  const caliber = sim.anatomy.caliberFor(sim.sample);
  const toMaterial = (p: Vec3): Vec3 => sim.anatomy.deformation.toMaterial(p, sim.sample.resp);
  const reach = scene.wallThickness() + 12;
  const cand: { p: Vec3; face: Interface; normal: Vec3; norm: number }[] = [];
  for (let u = 0; u < tr.lines; u += 2) {
    const theta = -tr.halfSector + (2 * tr.halfSector * (u + 0.5)) / tr.lines;
    for (let r = 0.025; r < reach; r += 0.05) {
      const p = pointOnLine(sim.frame, tr, theta, r);
      const m = toMaterial(p);
      const c = scene.classify(m, caliber);
      if (!isWallLayerInterface(c.interface) && !isRibInterface(c.interface)) continue;
      if (c.interfaceDistance < FACE_BAND_MM[0] || c.interfaceDistance > FACE_BAND_MM[1]) continue;
      const g = scene.faceGradient(m, caliber);
      if (g) cand.push({ p, face: c.interface, normal: g.normal, norm: g.norm });
    }
  }
  const step = Math.max(1, cand.length / WALL_POINTS_MAX);
  const chosen = Array.from({ length: Math.min(cand.length, WALL_POINTS_MAX) }, (_, j) => cand[Math.floor(j * step)]);
  const pts = new Float32Array(chosen.length * 3);
  chosen.forEach((c, i) => pts.set(c.p, i * 3));
  const gpu = sim.gpuQuery(pts, sim.frame, false, { normals: true });
  const byFace: Record<string, number> = {};
  const dots: { dot: number; i: number }[] = [];
  const errs: number[] = [];
  let mismatched = 0;
  chosen.forEach((c, i) => {
    byFace[Interface[c.face]] = (byFace[Interface[c.face]] ?? 0) + 1;
    const cpuFace: number = c.face;
    if (gpu.iface[i] !== cpuFace) {
      mismatched++;
      return;
    }
    const n = gpu.normal!;
    dots.push({ dot: Math.abs(n[i * 3] * c.normal[0] + n[i * 3 + 1] * c.normal[1] + n[i * 3 + 2] * c.normal[2]), i });
    if (gpu.gradNorm) errs.push(Math.abs(gpu.gradNorm[i] / c.norm - 1));
  });
  dots.sort((a, b) => a.dot - b.dot);
  errs.sort((a, b) => a - b);
  const w = dots[0];
  return {
    points: dots.length,
    byFace,
    mismatched,
    p05: dots.length ? dots[Math.floor(0.05 * dots.length)].dot : Number.NaN,
    min: w ? w.dot : Number.NaN,
    normErrP95: errs.length ? errs[Math.min(errs.length - 1, Math.floor(0.95 * errs.length))] : Number.NaN,
    worst: w ? `${Interface[chosen[w.i].face]} en (${chosen[w.i].p.map((x) => x.toFixed(2)).join(', ')}): ${w.dot.toFixed(4)}` : '',
  };
}

/** |n·∇| de una cara en un plano: la GPU frente al gradiente de `faceSdf` (ver `TestHooks.faceNormals`). */
export interface FaceNormalStats {
  points: number;
  /** Candidatos descartados porque la GPU y la CPU clasifican distinto tejido. */
  mismatched: number;
  p01: number;
  p05: number;
  p50: number;
  min: number;
  /** Fracción de los puntos con |n·∇| < 0,98 (la contingencia de la cápsula se decide con ella). */
  below098: number;
  /**
   * Error relativo de la norma del gradiente de la GPU (con la que el eco pasa `ifd` a distancia por la
   * normal) frente a |∇ faceSdf| de TS, |g_GPU/g_TS − 1|: p95 y máximo, en los puntos de tejidos con cara
   * (sin el pulmón de la cúpula). NaN si la GPU no la devuelve.
   */
  normErrP95: number;
  normErrMax: number;
  /** El peor punto, para el mensaje de la prueba. */
  worst: string;
}

/** Banda de distancia a la cara (mm) de los puntos de la e2e de normales. */
const FACE_BAND_MM = [0.02, 0.4] as const;
/** Puntos por fila y plano como máximo (la GPU los consulta de una vez). */
const FACE_POINTS_MAX = 400;
/** Tejidos que dibujan cada cara (su normal es la de esa cara en `classify` o en `faceGradient`). */
const TUBE_TISSUES: ReadonlySet<Tissue> = new Set([
  Tissue.Blood,
  Tissue.VesselWallThin,
  Tissue.VesselWallPortal,
  Tissue.ArteryWall,
  Tissue.Fluid,
  Tissue.BileDuctWall,
]);

/**
 * Subconjuntos de la e2e de normales: separan lo que la fila de su cara mezcla y se muestrean aparte
 * (hasta `FACE_POINTS_MAX` puntos cada uno), así que la fila de la cara no cambia.
 *  - `tubeIvc`: puntos del tubo cuya luz es la VCI. Su sección es elíptica: hasta el PR 5b la normal de
 *    la GPU (`tubeQuery`, d/dist) escalaba la componente AP una vez, mientras el gradiente la escala dos,
 *    y en todo el cuerpo, no solo en la tapa, se apartaba 6–10° según `ivcApScale` (|n·∇| 0,991 a 0,777,
 *    0,984 a 0,70). Mezclada con los demás tubos, no se veía en su p05.
 *  - `tubeIvcBody`: los de la VCI dentro de su segmento (0 < s < 1): sin la tapa en la aurícula ni los
 *    codos (las uniones con las suprahepáticas sí cuentan).
 *  - `kidneyOuterNotchFree` y `kidneyOuterNotch`: el contorno renal fuera o dentro del redondeo de la
 *    escotadura hiliar (`hilumNotchActive`). Fuera, la normal del elipsoide era exacta; dentro no, y
 *    desde el PR 5b la GPU usa en las dos el gradiente numérico del contorno (`faceGradient`).
 */
export const FACE_NORMAL_SUBSETS = ['tubeIvc', 'tubeIvcBody', 'kidneyOuterNotchFree', 'kidneyOuterNotch'] as const;
export type FaceNormalSubset = (typeof FACE_NORMAL_SUBSETS)[number];
/** Fila del informe de normales: una cara entera o uno de sus subconjuntos. */
export type FaceNormalRow = FaceGeometry | FaceNormalSubset;

/**
 * Puntos del plano a 0,02–0,4 mm de cada cara (rejilla de líneas × 0,5 mm y, cerca de la cara, pasos de
 * 0,05 mm) en un tejido que la dibuja: la luz y la pared del tubo, la cápsula hepática, el diafragma y el
 * pulmón bajo la cúpula (no la cortina), la cápsula renal y la mitad interna de la grasa perirrenal, la mitad
 * externa de la grasa que dibuja su cara (Morison), la bilis y la pared vesicular. En cada uno, |n·∇| entre la normal de la GPU y el gradiente de `faceSdf` en el marco
 * material (diferencias centrales de 0,02 mm). Una fila por cara y otra por subconjunto
 * (`FACE_NORMAL_SUBSETS`).
 */
export function faceNormalStats(sim: Simulator): Record<FaceNormalRow, FaceNormalStats> {
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  const scene = sim.scene;
  const caliber = sim.anatomy.caliberFor(sim.sample);
  const resp = sim.sample.resp;
  const toMaterial = (p: Vec3): Vec3 => sim.anatomy.deformation.toMaterial(p, resp);
  const sdf = (m: Vec3, face: FaceGeometry): number | null => scene.faceSdf(m, caliber, face);
  const owns = (face: FaceGeometry, m: Vec3): Tissue | null => {
    const c = scene.classify(m, caliber);
    const t = c.tissue;
    const tube = sdf(m, 'tube') !== null;
    switch (face) {
      case 'tube':
        return tube && TUBE_TISSUES.has(t) ? t : null;
      case 'liverSurface':
        return t === Tissue.LiverCapsule ? t : null;
      case 'dome': {
        // el pulmón de la cúpula (no el de la cortina) guarda su distancia a ella
        const d = sdf(m, 'dome')!;
        return t === Tissue.Diaphragm || (t === Tissue.Lung && Math.abs(c.boundaryDistance + d) < 1e-9) ? t : null;
      }
      case 'kidneyOuter':
        // la mitad externa de la grasa dibuja su propia cara (`perirenalOuter`)
        return t === Tissue.RenalCapsule || (t === Tissue.PerirenalFat && c.interface !== Interface.PerirenalFat) ? t : null;
      case 'perirenalOuter':
        return t === Tissue.PerirenalFat && c.interface === Interface.PerirenalFat ? t : null;
      case 'gallbladder':
        return !tube && (t === Tissue.Fluid || t === Tissue.BileDuctWall) ? t : null;
    }
  };
  type Candidate = { p: Vec3; m: Vec3 };
  const candidates = new Map<FaceGeometry, Candidate[]>(FACE_GEOMETRIES.map((f) => [f, []]));
  const nr = Math.floor(depth / 0.5);
  for (let u = 0; u < tr.lines; u++) {
    const theta = -tr.halfSector + (2 * tr.halfSector * (u + 0.5)) / tr.lines;
    for (let k = 0; k < nr; k++) {
      const rc = (k + 0.5) * 0.5;
      const mc = toMaterial(pointOnLine(sim.frame, tr, theta, rc));
      for (const face of FACE_GEOMETRIES) {
        const dc = sdf(mc, face);
        if (dc === null || Math.abs(dc) > 1) continue;
        for (let j = 0; j < 10; j++) {
          const p = pointOnLine(sim.frame, tr, theta, rc - 0.25 + (j + 0.5) * 0.05);
          const m = toMaterial(p);
          const d = sdf(m, face);
          if (d !== null && Math.abs(d) >= FACE_BAND_MM[0] && Math.abs(d) <= FACE_BAND_MM[1]) candidates.get(face)!.push({ p, m });
        }
      }
    }
  }
  // subconjuntos: la VCI (y su cuerpo) entre los tubos; el contorno renal con o sin escotadura (la del
  // riñón más cercano, el que da `faceSdf`)
  const ivc = candidates
    .get('tube')!
    .map((c) => {
      const t = scene.faceTube(c.m, caliber);
      return { ...c, s: t?.vessel && VESSEL_META[t.vessel].system === 'ivc' ? t.hit.s : Number.NaN };
    })
    .filter((c) => !Number.isNaN(c.s));
  const kidneys = [scene.kidneyRight, scene.kidneyLeft] as const;
  const renal = candidates.get('kidneyOuter')!.map((c) => {
    const q = kidneys.map((k) => kidneyLocal(c.m, k));
    const j = kidneyOuterSdf(q[0], kidneys[0]) <= kidneyOuterSdf(q[1], kidneys[1]) ? 0 : 1;
    return { ...c, notch: hilumNotchActive(q[j], kidneys[j]) };
  });
  const subsets: Record<FaceNormalSubset, { face: FaceGeometry; list: Candidate[] }> = {
    tubeIvc: { face: 'tube', list: ivc },
    tubeIvcBody: { face: 'tube', list: ivc.filter((c) => c.s > 0 && c.s < 1) },
    kidneyOuterNotchFree: { face: 'kidneyOuter', list: renal.filter((c) => !c.notch) },
    kidneyOuterNotch: { face: 'kidneyOuter', list: renal.filter((c) => c.notch) },
  };
  // hasta FACE_POINTS_MAX puntos por fila, repartidos por todo el plano: se clasifican ≤ 4× candidatos a
  // paso fijo y, de los que caen en un tejido que dibuja la cara, se toman FACE_POINTS_MAX equiespaciados
  const chosen: { row: FaceNormalRow; p: Vec3; m: Vec3; tissue: Tissue; grad: Vec3 }[] = [];
  const pick = (row: FaceNormalRow, face: FaceGeometry, list: readonly Candidate[]): void => {
    const stride = Math.max(1, Math.floor(list.length / (4 * FACE_POINTS_MAX)));
    const owned: { p: Vec3; m: Vec3; tissue: Tissue }[] = [];
    for (let i = 0; i < list.length; i += stride) {
      const tissue = owns(face, list[i].m);
      if (tissue !== null) owned.push({ p: list[i].p, m: list[i].m, tissue });
    }
    const step = Math.max(1, owned.length / FACE_POINTS_MAX);
    for (let j = 0; Math.floor(j * step) < owned.length; j++) {
      const { p, m, tissue } = owned[Math.floor(j * step)];
      const grad = centralGradient((q) => sdf(q, face), m);
      if (grad && Math.hypot(grad[0], grad[1], grad[2]) > 0) chosen.push({ row, p, m, tissue, grad });
    }
  };
  for (const face of FACE_GEOMETRIES) pick(face, face, candidates.get(face)!);
  for (const row of FACE_NORMAL_SUBSETS) pick(row, subsets[row].face, subsets[row].list);
  const pts = new Float32Array(chosen.length * 3);
  chosen.forEach((c, i) => pts.set(c.p, i * 3));
  const gpu = sim.gpuQuery(pts, sim.frame, false, { normals: true });
  const normal = gpu.normal!;
  const gradNorm = gpu.gradNorm;
  const out = {} as Record<FaceNormalRow, FaceNormalStats>;
  for (const row of [...FACE_GEOMETRIES, ...FACE_NORMAL_SUBSETS]) {
    const dots: { dot: number; i: number }[] = [];
    const normErr: number[] = [];
    let mismatched = 0;
    chosen.forEach((c, i) => {
      if (c.row !== row) return;
      const cpuTissue: number = c.tissue;
      if (gpu.tissue[i] !== cpuTissue) {
        mismatched++;
        return;
      }
      const g = c.grad;
      const len = Math.hypot(g[0], g[1], g[2]);
      const dot = Math.abs(normal[i * 3] * g[0] + normal[i * 3 + 1] * g[1] + normal[i * 3 + 2] * g[2]) / len;
      dots.push({ dot, i });
      // la norma solo cuenta donde hay cara (el pulmón bajo la cúpula no la dibuja)
      if (gradNorm && c.tissue !== Tissue.Lung) normErr.push(Math.abs(gradNorm[i] / len - 1));
    });
    normErr.sort((a, b) => a - b);
    dots.sort((a, b) => a.dot - b.dot);
    const pct = (q: number): number => (dots.length ? dots[Math.min(dots.length - 1, Math.floor(q * dots.length))].dot : Number.NaN);
    const w = dots[0];
    out[row] = {
      points: dots.length,
      mismatched,
      p01: pct(0.01),
      p05: pct(0.05),
      p50: pct(0.5),
      min: w ? w.dot : Number.NaN,
      below098: dots.length ? dots.filter((d) => d.dot < 0.98).length / dots.length : Number.NaN,
      normErrP95: normErr.length ? normErr[Math.min(normErr.length - 1, Math.floor(0.95 * normErr.length))] : Number.NaN,
      normErrMax: normErr.length ? normErr[normErr.length - 1] : Number.NaN,
      worst: w
        ? `${TISSUES[chosen[w.i].tissue].name} en (${chosen[w.i].m.map((x) => x.toFixed(1)).join(', ')}): |n·∇| ${w.dot.toFixed(4)}, ` +
          `GPU (${[0, 1, 2].map((a) => normal[w.i * 3 + a].toFixed(3)).join(', ')})`
        : '—',
    };
  }
  return out;
}

/**
 * Deslizamiento (decisión 61) con la respiración tranquila: avanza hasta que el diafragma se mueve, dibuja un
 * cuadro (una mirada), avanza hasta que el pulmón ha bajado o subido `shiftMm` y dibuja otro, sin mover la
 * sonda; compara las bandas de 2–6 mm bajo y sobre la pleura (`slidingCorrelation`).
 */
function slidingAt(sim: Simulator, shiftMm: number): { subPleural: number; wall: number; lines: number; shiftMm: number } {
  sim.patient.respiratoryPattern = 'quiet';
  const caudal = () => sim.sample.resp.diaphragmCaudalMm;
  // hasta la mitad de la inspiración o de la espiración (el diafragma a > 3 mm/s), como mucho un ciclo
  for (let t = 0; t < 12 && Math.abs(sim.sample.resp.diaphragmVelocityMmS) < 3; t += 0.05) sim.advance(0.05);
  sim.render();
  const a = sim.renderer.readEnvelope();
  const ca = curtainLines(sim, a.lines);
  const c0 = caudal();
  for (let t = 0; t < 6 && Math.abs(caudal() - c0) < shiftMm; t += 0.01) sim.advance(0.01);
  sim.render();
  const b = sim.renderer.readEnvelope();
  const cb = curtainLines(sim, b.lines);
  return { ...slidingCorrelation(a, b, ca, cb, sim.bmode.depthMm), shiftMm: Math.abs(caudal() - c0) };
}

/** Bascula (`rockDeg`) o inclina (`tiltDeg`) la sonda desde su pose actual y deja que el marco la siga. */
function offsetPose(sim: Simulator, pose: { rockDeg?: number; tiltDeg?: number }): void {
  const rad = Math.PI / 180;
  const { rockDeg = 0, tiltDeg = 0 } = pose;
  sim.setPose({ ...sim.pose, rock: sim.pose.rock + rockDeg * rad, tilt: sim.pose.tilt + tiltDeg * rad });
  sim.advance(0.05);
}

/** Coloca la sonda en un punto de partida (sin animación) y avanza lo justo para que el marco la siga. */
function goTo(sim: Simulator, id: StartPoint['id']): void {
  const sp = START_POINTS.find((p) => p.id === id)!;
  sim.setPose({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 });
  sim.advance(0.05);
}

/** Avanza lo que exige la cadencia del color para que el siguiente render dibuje un cuadro de color. */
function renderColorFrame(sim: Simulator): number {
  sim.advance(1 / Math.max(1, sim.colorTiming.frameHz) + 0.02);
  sim.render();
  return sim.renderer.colorCellsAbove();
}

/** Peso de ventana acústica de la pose actual (ver `acousticWindowWeight`). */
function windowWeight(sim: Simulator): (theta: number, r: number) => number {
  return acousticWindowWeight(
    sim.anatomy,
    sim.frame,
    sim.transducer,
    sim.contact,
    sim.sample,
    sim.bmode.depthMm,
    sim.profile.dopplerEffectiveMHz,
  );
}

/**
 * Envolvente con la sonda en `pose` tras un solo paso de fisiología (sin respiración apreciable): la de la
 * mirada 0 tras un cuadro o, con `compound`, la compuesta tras `frames` cuadros (una mirada cada uno; con N,
 * todas las miradas son de esta pose). Si el anillo no queda lleno, lanza.
 */
function envelopeAt(sim: Simulator, pose: ProbePose, compound = false, frames = 1): { lines: number; samples: number; data: Float32Array } {
  sim.setPose(pose);
  sim.advance(1.5 * sim.physiology.clock.dt);
  for (let i = 0; i < frames; i++) sim.render();
  if (!compound) return sim.renderer.readEnvelope();
  const st = sim.renderer.compoundState();
  if (st.validCount !== sim.profile.compound.order.length) throw new Error(`envelopeAt: anillo incompleto ${JSON.stringify(st)}`);
  return sim.renderer.readEnvelope({ source: 'compound' });
}

/** Líneas vecinas (a cada lado) cuya sombra también tapa una línea en `liverMask` (la penumbra de la apertura). */
const LIVER_MASK_SHADOW_LINES = 3;
/** Penumbra que deja fuera `liverMask`: la transmisión con apertura más de esto bajo la de un solo rayo (dB). */
const LIVER_MASK_PENUMBRA_DB = 0.5;
/** Acoplamiento mínimo de una línea de `liverMask` (el del banco, `MIN_COUPLING` de fidelity.ts). */
const LIVER_MASK_MIN_COUPLING = 0.95;

/**
 * Índices de hígado del plano actual: cada 2 líneas y 4 muestras, de 30 a 120 mm, sin lo que queda bajo la
 * pleura de la cortina donde ya toca el hígado (decisión 61, `CURTAIN_LIVER_MAX_AIR`: la imagen muestra ahí la
 * neblina y las líneas A, no el moteado del hígado) ni tras un hueso o un gas en la línea o en sus
 * `LIVER_MASK_SHADOW_LINES` vecinas, ni en la penumbra de la apertura (la transmisión de la pasada A del último
 * cuadro con apertura a más de `LIVER_MASK_PENUMBRA_DB` bajo la de un solo rayo, como el banco). Decisión 62: con
 * las costillas óseas, girar la sonda 2° desde la ventana intercostal mete la 9.ª costilla en un borde; su sombra
 * y su penumbra entraban en la máscara y el nivel del hígado bajaba 4 dB en un giro de 16° (1,2 dB en un cuadro).
 * Decisión 63: solo en las líneas acopladas (el contacto conseguido; los bordes de la intercostal no apoyan y son
 * ruido del receptor). Girar la sonda 2° cambia su contacto, pero solo empujando: el tejido comprimido se mueve por
 * ello 0,05 mm de mediana (p90 0,18 mm; gemelo), muy por debajo del grano.
 */
function liverMask(sim: Simulator, env: { lines: number; samples: number }): number[] {
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  const curtain = curtainLines(sim, env.lines);
  const tx = sim.renderer.readTransmission();
  const penumbraMin = Math.pow(10, -LIVER_MASK_PENUMBRA_DB / 20);
  const lit = (u: number, r: number): boolean => {
    const ut = Math.min(tx.lines - 1, Math.floor(((u + 0.5) / env.lines) * tx.lines));
    const kt = Math.min(tx.samples - 1, Math.floor((r / depth) * tx.samples));
    const single = tx.single[kt * tx.lines + ut];
    return single > 1e-6 && tx.aperture[kt * tx.lines + ut] >= penumbraMin * single;
  };
  const thetaOf = (u: number): number => -tr.halfSector + (2 * tr.halfSector * (u + 0.5)) / env.lines;
  // primer hueso o gas del cuerpo de cada línea (cada 1 mm hasta 120 mm; el aire de fuera no cuenta)
  const blocked = Float32Array.from({ length: env.lines }, (_, u) => {
    for (let r = 0.5; r <= 120; r += 1) {
      const tissue = sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, thetaOf(u), r), sim.sample).tissue;
      if (tissue !== Tissue.Air && (TISSUES[tissue].bone || TISSUES[tissue].gas)) return r;
    }
    return Infinity;
  });
  const shadowFrom = Float32Array.from({ length: env.lines }, (_, u) => {
    let m = Infinity;
    for (let du = -LIVER_MASK_SHADOW_LINES; du <= LIVER_MASK_SHADOW_LINES; du++)
      if (u + du >= 0 && u + du < env.lines) m = Math.min(m, blocked[u + du]);
    return m;
  });
  const idx: number[] = [];
  for (let u = 0; u < env.lines; u += 2) {
    if (contactCoupling(sim.contact, thetaOf(u)) < LIVER_MASK_MIN_COUPLING) continue;
    for (let k = 0; k < env.samples; k += 4) {
      const r = ((k + 0.5) * depth) / env.samples;
      if (r < 30 || r > 120 || r >= shadowFrom[u]) continue;
      const c = curtain[u];
      if (c && c.fAir >= CURTAIN_LIVER_MAX_AIR && r >= c.D) continue;
      if (!lit(u, r)) continue;
      const theta = thetaOf(u);
      if (sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, theta, r), sim.sample).tissue === Tissue.Liver) idx.push(k * env.lines + u);
    }
  }
  return idx;
}

const meanOf = (data: Float32Array, idx: readonly number[]): number => idx.reduce((s, i) => s + data[i], 0) / Math.max(1, idx.length);

/** Semiancho de la caja de la media local (líneas y muestras de la envolvente): ~10 × 4 mm a 8 cm. */
const LOCAL_LINES = 6;
const LOCAL_SAMPLES = 12;

/**
 * Envolvente sin la tendencia local: cada muestra dividida por la media del hígado en una caja de
 * ~10 × 4 mm a su alrededor. La atenuación de ida y vuelta sin TGC (~3 dB/cm) domina la envolvente
 * cruda, y en la ventana intercostal la penumbra de las costillas deja bandas laterales: quitar solo
 * la media por fila de profundidad todavía correlacionaba dos moteados a 8° (0,45 en GPU).
 */
function detrended(env: { lines: number; data: Float32Array }, idx: readonly number[]): number[] {
  const inMask = new Set(idx);
  const out: number[] = [];
  for (const i of idx) {
    const u = i % env.lines;
    const k = Math.floor(i / env.lines);
    let sum = 0;
    let n = 0;
    for (let dk = -LOCAL_SAMPLES; dk <= LOCAL_SAMPLES; dk++)
      for (let du = -LOCAL_LINES; du <= LOCAL_LINES; du++) {
        const j = (k + dk) * env.lines + (u + du);
        if (inMask.has(j)) {
          sum += env.data[j];
          n++;
        }
      }
    out.push(n >= 8 ? env.data[i] / (sum / n) : Number.NaN);
  }
  return out;
}

/** Correlación del moteado entre dos envolventes en las muestras de `idx`, sin la tendencia de profundidad. */
function speckleCorrelation(
  a: { lines: number; data: Float32Array },
  b: { lines: number; data: Float32Array },
  idx: readonly number[],
): number {
  const x0 = detrended(a, idx);
  const y0 = detrended(b, idx);
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < x0.length; i++)
    if (Number.isFinite(x0[i]) && Number.isFinite(y0[i])) {
      x.push(x0[i]);
      y.push(y0[i]);
    }
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}
