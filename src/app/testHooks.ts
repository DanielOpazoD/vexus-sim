import type { VesselId } from '../physiology/vessels';
import type { EquipmentCommand } from './equipment';
import { equivalenceSweep, volumeEquivalence, type EquivalencePoseReport, type VolumeEquivalenceReport } from './equivalenceSweep';
import { bestGateOnVessel } from './gatePlacement';
import { acousticWindowWeight, gateTransmission } from './gateTransmission';
import { lineCoupling } from '../probe/probe';
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
      const sp = START_POINTS.find((p) => p.id === opts?.startPoint);
      if (sp) {
        sim.setPose({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 });
        sim.advance(0.05);
      }
      sim.render();
      return speckleStats(sim, sim.renderer.readEnvelope(), opts);
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
    goToStartPoint: (id) => {
      const sim = getSim();
      const sp = START_POINTS.find((p) => p.id === id)!;
      sim.setPose({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 });
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
  };
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
