import type { VesselId } from '../physiology/vessels';
import type { EquipmentCommand } from './equipment';
import { equivalenceSweep, volumeEquivalence, type EquivalencePoseReport, type VolumeEquivalenceReport } from './equivalenceSweep';
import { bestGateOnVessel } from './gatePlacement';
import { acousticWindowWeight, gateTransmission } from './gateTransmission';
import { lineCoupling, pointOnLine, type ProbePose } from '../probe/probe';
import { Tissue } from '../anatomy/tissues';
import { rayAttenuationDb } from '../ultrasound/transmission';
import { fidelityStats, type FidelityStats } from './fidelity';
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
  /**
   * Estadística del speckle en parénquima hepático (guarda de imagen). Con `startPoint`, coloca
   * antes la sonda en ese punto de partida y avanza lo justo para que el marco la siga.
   */
  speckle: (opts?: SpeckleOptions & { startPoint?: StartPoint['id'] }) => SpeckleStats;
  /**
   * Banco de fidelidad (decisión 52): textura de la envolvente en hígado, en total y por bandas
   * de profundidad; con `display`, además la imagen mostrada (renderiza `frames` cuadros, por
   * defecto los que la persistencia necesita para dejar < 1 % de la vista anterior; clasifica en
   * CPU ~1–3 s).
   */
  fidelity: (opts?: { startPoint?: StartPoint['id']; display?: boolean; frames?: number }) => FidelityStats;
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
    speckle: (opts) => {
      const sim = getSim();
      if (opts?.startPoint) goTo(sim, opts.startPoint);
      sim.render();
      return speckleStats(sim, sim.renderer.readEnvelope(), opts);
    },
    fidelity: (opts) => {
      const sim = getSim();
      if (opts?.startPoint) goTo(sim, opts.startPoint);
      // la persistencia deja p^n de la vista anterior: cuadros hasta que quede < 1 % (máx. 30)
      const p = Math.min(0.95, Math.max(0, sim.bmode.persistence));
      const settle = p > 0 ? Math.min(30, Math.ceil(Math.log(0.01) / Math.log(p))) : 1;
      const frames = opts?.display ? Math.max(1, opts.frames ?? settle) : 1;
      for (let i = 0; i < frames; i++) sim.render();
      const img = opts?.display ? sim.renderer.readDisplay() : null;
      const transmission = sim.renderer.readTransmission();
      return fidelityStats(sim, sim.renderer.readEnvelope(), img, { colorOn: sim.color.enabled, transmission });
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
        const d = detrended(env, mask);
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

/**
 * Envolvente sin la tendencia de profundidad: cada muestra dividida por la media del hígado de su fila
 * (la atenuación de ida y vuelta, ~3 dB/cm sin TGC, domina la envolvente cruda: dos moteados
 * independientes correlacionaban 0,6 sin quitarla). Filas con < 4 muestras fuera.
 */
function detrended(env: { lines: number; data: Float32Array }, idx: readonly number[]): number[] {
  const rows = new Map<number, number[]>();
  for (const i of idx) {
    const k = Math.floor(i / env.lines);
    const row = rows.get(k) ?? [];
    row.push(i);
    rows.set(k, row);
  }
  const out: number[] = [];
  for (const row of rows.values()) {
    if (row.length < 4) continue;
    const m = meanOf(env.data, row);
    for (const i of row) out.push(env.data[i] / m);
  }
  return out;
}

/** Correlación del moteado entre dos envolventes en las muestras de `idx`, sin la tendencia de profundidad. */
function speckleCorrelation(
  a: { lines: number; data: Float32Array },
  b: { lines: number; data: Float32Array },
  idx: readonly number[],
): number {
  const x = detrended(a, idx);
  const y = detrended(b, idx);
  const n = Math.min(x.length, y.length);
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
