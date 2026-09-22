import type { VesselId } from '../physiology/vessels';
import type { EquipmentCommand } from './equipment';
import { equivalenceSweep, volumeEquivalence, type EquivalencePoseReport, type VolumeEquivalenceReport } from './equivalenceSweep';
import { bestGateOnVessel } from './gatePlacement';
import type { Simulator } from './simulator';

/**
 * Ganchos de prueba estables (e2e). Se cargan con `import()` dinámico solo en desarrollo o
 * con `?e2e`: el barrido de equivalencia y la colocación de la puerta no viajan en el bundle
 * que abre el alumno.
 */
export interface TestHooks {
  equivalenceSweep: () => EquivalencePoseReport[];
  /** Equivalencia TS ↔ GLSL en `n` puntos aleatorios de todo el tronco. */
  volumeEquivalence: (n?: number) => VolumeEquivalenceReport;
  /** Avanza la simulación (fisiología + PW) `seconds` sin renderizar: SwiftShader es lento. */
  advance: (seconds: number) => void;
  /** Coloca la puerta PW sobre uno de los vasos con la técnica del operador; false si no lo ve. */
  placeGate: (vessels: VesselId[]) => boolean;
}

export function createTestHooks(getSim: () => Simulator, dispatch: (cmd: EquipmentCommand) => void): TestHooks {
  return {
    equivalenceSweep: () => equivalenceSweep(getSim()),
    volumeEquivalence: (n) => volumeEquivalence(getSim(), n),
    advance: (seconds) => {
      const sim = getSim();
      for (let t = 0; t < seconds; t += 1 / 60) sim.advance(1 / 60);
    },
    placeGate: (vessels) => {
      const sim = getSim();
      const g = bestGateOnVessel(sim.anatomy, sim.frame, sim.transducer, sim.sample, vessels, sim.bmode.depthMm - 5);
      if (!g) return false;
      dispatch({ type: 'placeGate', theta: g.theta, r: g.r });
      return true;
    },
  };
}
