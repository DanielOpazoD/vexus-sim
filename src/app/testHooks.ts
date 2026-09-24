import { VESSEL_META, type VesselId } from '../physiology/vessels';
import type { EquipmentCommand } from './equipment';
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
import { lineCoupling, pointOnLine, type ProbePose } from '../probe/probe';
import { hilumNotchActive, kidneyLocal, kidneyOuterSdf } from '../anatomy/organs/kidney';
import { FACE_GEOMETRIES, type FaceGeometry } from '../anatomy/scene';
import { TISSUES, Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import { rayAttenuationDb } from '../ultrasound/transmission';
import { centralGradient, fidelityStats, type FidelityStats } from './fidelity';
import { speckleStats, type SpeckleOptions, type SpeckleStats } from './speckle';
import type { Simulator } from './simulator';
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
   * antes la sonda en ese punto de partida y avanza lo justo para que el marco la siga.
   */
  speckle: (opts?: SpeckleOptions & { startPoint?: StartPoint['id'] }) => SpeckleStats;
  /**
   * Banco de fidelidad (decisión 52): textura de la envolvente en hígado, en total y por bandas
   * de profundidad; con `display`, además la imagen mostrada y el banco de interfaces (renderiza
   * `frames` cuadros, por defecto los que la persistencia necesita para dejar < 1 % de la vista
   * anterior; clasifica en CPU ~1–3 s). `pose` bascula (`rockDeg`) o inclina (`tiltDeg`) la sonda
   * respecto a la pose de partida; `samples` devuelve un registro por pared (`faceSamples`) para
   * agregar poses con `summarizeFaces`.
   */
  fidelity: (opts?: {
    startPoint?: StartPoint['id'];
    display?: boolean;
    frames?: number;
    pose?: { rockDeg?: number; tiltDeg?: number };
    samples?: boolean;
  }) => FidelityStats;
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
   * Coste medio de `n` cuadros de imagen en tiempo de pared (ms), sincronizado con la GPU al
   * principio y al final: compara versiones del renderizador en la misma máquina.
   */
  frameCostMs: (n: number) => number;
  /**
   * Paridad de la pasada A (un solo rayo) con el modelo de CPU `rayAttenuationDb` en los mismos
   * puntos de muestra, cada `every` líneas y en todas las profundidades gruesas; se saltan las líneas
   * con espejo (la CPU no sigue el rayo reflejado) y las transmisiones por debajo de −60 dB.
   */
  transmissionParity: (opts?: { startPoint?: StartPoint['id']; every?: number }) => { lines: number; samples: number; maxDiffDb: number };
  /**
   * Persistencia del moteado al mover la sonda (decisión 55): correlación de la envolvente en el
   * hígado entre la pose de partida y la misma pose con `tiltDeg`/`yawDeg` más (`moved`), y al volver
   * a la pose (`back`). Entre cuadros avanza un solo paso de fisiología: la respiración no cuenta.
   */
  speckleMotion: (opts: { startPoint: StartPoint['id']; tiltDeg?: number; yawDeg?: number }) => {
    samples: number;
    moved: number;
    back: number;
  };
  /**
   * Fundido del ancla del medio en la GPU (decisión 55): gira la sonda `stepDeg` por cuadro durante
   * `frames` cuadros y devuelve por cuadro el peso del fundido, la SNR y el nivel del hígado (dB
   * frente al primero) y la correlación del moteado con el cuadro anterior (sin tendencia).
   */
  speckleCrossfade: (opts: { startPoint: StartPoint['id']; stepDeg: number; frames: number }) => {
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
  /** Fracción de las celdas de la caja de color visibles tras forzar un cuadro (0–1). */
  colorCellFraction: () => number;
  /** Fija la ganancia de color (dB) como el deslizador. */
  setColorGainDb: (db: number) => void;
  /**
   * Transmisión de ida y vuelta (dB, con acoplamiento) en la puerta PW actual, tal como la ven el
   * color (pasada A de la GPU a la frecuencia B, convertida a la Doppler) y el PW (marcha en CPU).
   */
  gateTransmissionDb: () => { color: number; pw: number };
  /** Potencia de la banda PW sobre el suelo de ruido (dB, mediana de los últimos `seconds`). */
  pwBandOverFloorDb: (seconds: number) => number | null;
  /** Coloca la sonda en un punto de partida (sin animación) y avanza lo justo para que el marco la siga. */
  goToStartPoint: (id: StartPoint['id']) => void;
  /** Separa la sonda de la piel `mm` (0 = contacto) sin tocar el resto de la pose. */
  liftProbe: (mm: number) => void;
  /** Avanza la simulación (fisiología + PW) `seconds` sin renderizar: SwiftShader es lento. */
  advance: (seconds: number) => void;
  /** Coloca la puerta PW sobre uno de los vasos con la técnica del operador; false si no lo ve. */
  placeGate: (vessels: VesselId[]) => boolean;
}

export function createTestHooks(getSim: () => Simulator, dispatch: (cmd: EquipmentCommand) => void): TestHooks {
  return {
    equivalenceSweep: () => equivalenceSweep(getSim()),
    volumeEquivalence: (n) => volumeEquivalence(getSim(), n),
    interfaceShell: () => interfaceShellEquivalence(getSim()),
    speckle: (opts) => {
      const sim = getSim();
      if (opts?.startPoint) goTo(sim, opts.startPoint);
      sim.render();
      return speckleStats(sim, sim.renderer.readEnvelope(), opts);
    },
    fidelity: (opts) => {
      const sim = getSim();
      if (opts?.startPoint) goTo(sim, opts.startPoint);
      if (opts?.pose) offsetPose(sim, opts.pose);
      // la persistencia deja p^n de la vista anterior: cuadros hasta que quede < 1 % (máx. 30)
      const p = Math.min(0.95, Math.max(0, sim.bmode.persistence));
      const settle = p > 0 ? Math.min(30, Math.ceil(Math.log(0.01) / Math.log(p))) : 1;
      const frames = opts?.display ? Math.max(1, opts.frames ?? settle) : 1;
      for (let i = 0; i < frames; i++) sim.render();
      const img = opts?.display ? sim.renderer.readDisplay() : null;
      const transmission = sim.renderer.readTransmission();
      return fidelityStats(sim, sim.renderer.readEnvelope(), img, { colorOn: sim.color.enabled, transmission, samples: opts?.samples });
    },
    faceNormals: (opts) => {
      const sim = getSim();
      goTo(sim, opts.startPoint);
      if (opts.pose) offsetPose(sim, opts.pose);
      return faceNormalStats(sim);
    },
    frameCostMs: (n) => {
      const sim = getSim();
      sim.render();
      sim.renderer.finishForTiming();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) sim.render();
      sim.renderer.finishForTiming();
      return (performance.now() - t0) / n;
    },
    speckleMotion: (opts) => {
      const sim = getSim();
      goTo(sim, opts.startPoint);
      const base = { ...sim.pose };
      const rad = Math.PI / 180;
      const a = envelopeAt(sim, base);
      const mask = liverMask(sim, a);
      const b = envelopeAt(sim, { ...base, tilt: base.tilt + (opts.tiltDeg ?? 0) * rad, yaw: base.yaw + (opts.yawDeg ?? 0) * rad });
      const c = envelopeAt(sim, base);
      return { samples: mask.length, moved: speckleCorrelation(a, b, mask), back: speckleCorrelation(a, c, mask) };
    },
    speckleCrossfade: (opts) => {
      const sim = getSim();
      goTo(sim, opts.startPoint);
      const pose = { ...sim.pose };
      const frames: { w: number; snr: number; levelDb: number; corrPrev: number }[] = [];
      let prev = envelopeAt(sim, pose);
      let prevMask = liverMask(sim, prev);
      const level0 = meanOf(prev.data, prevMask);
      for (let f = 0; f < opts.frames; f++) {
        pose.yaw += (opts.stepDeg * Math.PI) / 180;
        const env = envelopeAt(sim, pose);
        const mask = liverMask(sim, env);
        const d = detrended(env, mask).filter(Number.isFinite);
        const mean = d.reduce((s, v) => s + v, 0) / d.length;
        const sd = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / d.length);
        frames.push({
          w: sim.renderer.speckleAnchorWeight,
          snr: mean / sd,
          levelDb: 20 * Math.log10(meanOf(env.data, mask) / level0),
          corrPrev: speckleCorrelation(prev, env, prevMask),
        });
        prev = env;
        prevMask = mask;
      }
      return frames;
    },
    transmissionParity: (opts) => {
      const sim = getSim();
      if (opts?.startPoint) goTo(sim, opts.startPoint);
      sim.render();
      const gpu = sim.renderer.readTransmission();
      const tr = sim.transducer;
      const depth = sim.bmode.depthMm;
      const step = depth / gpu.samples;
      const every = Math.max(1, opts?.every ?? 8);
      let lines = 0;
      let samples = 0;
      let maxDiffDb = 0;
      for (let u = 0; u < gpu.lines; u += every) {
        if (gpu.mirrorHit[(gpu.samples - 1) * gpu.lines + u] >= 0) continue;
        const theta = -tr.halfSector + (2 * tr.halfSector * (u + 0.5)) / gpu.lines;
        const tissues: Tissue[] = [];
        lines++;
        for (let k = 0; k < gpu.samples; k++) {
          tissues.push(sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, theta, (k + 0.5) * step), sim.sample).tissue);
          const cpuDb = rayAttenuationDb(tissues, step, sim.profile.bEffectiveMHz);
          const gpuDb = -20 * Math.log10(Math.max(gpu.single[k * gpu.lines + u], 1e-12));
          if (cpuDb > 60 && gpuDb > 60) continue;
          samples++;
          maxDiffDb = Math.max(maxDiffDb, Math.abs(cpuDb - gpuDb));
        }
      }
      return { lines, samples, maxDiffDb };
    },
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
      const u = (theta + tr.halfSector) / (2 * tr.halfSector);
      const tb = sim.renderer.transmissionAt(u, depthMm / sim.bmode.depthMm);
      const ratio = sim.profile.dopplerEffectiveMHz / sim.profile.bEffectiveMHz;
      const color = Math.pow(Math.max(tb, 1e-12), ratio) * lineCoupling(sim.pose, tr, theta);
      const pw = gateTransmission(sim.anatomy, sim.frame, tr, sim.pose, theta, depthMm, sim.sample, sim.profile.dopplerEffectiveMHz);
      const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));
      return { color: db(color), pw: db(pw) };
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
 * pulmón bajo la cúpula (no la cortina), la cápsula renal y la grasa perirrenal, la bilis y la pared
 * vesicular. En cada uno, |n·∇| entre la normal de la GPU y el gradiente de `faceSdf` en el marco
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
        return t === Tissue.RenalCapsule || t === Tissue.PerirenalFat ? t : null;
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
    sim.pose,
    sim.sample,
    sim.bmode.depthMm,
    sim.profile.dopplerEffectiveMHz,
  );
}

/** Envolvente con la sonda en `pose` tras un solo paso de fisiología (sin respiración apreciable). */
function envelopeAt(sim: Simulator, pose: ProbePose): { lines: number; samples: number; data: Float32Array } {
  sim.setPose(pose);
  sim.advance(1.5 * sim.physiology.clock.dt);
  sim.render();
  return sim.renderer.readEnvelope();
}

/** Índices de hígado del plano actual: cada 2 líneas y 4 muestras, de 30 a 120 mm. */
function liverMask(sim: Simulator, env: { lines: number; samples: number }): number[] {
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  const idx: number[] = [];
  for (let u = 0; u < env.lines; u += 2)
    for (let k = 0; k < env.samples; k += 4) {
      const r = ((k + 0.5) * depth) / env.samples;
      if (r < 30 || r > 120) continue;
      const theta = -tr.halfSector + (2 * tr.halfSector * (u + 0.5)) / env.lines;
      if (sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, theta, r), sim.sample).tissue === Tissue.Liver) idx.push(k * env.lines + u);
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
