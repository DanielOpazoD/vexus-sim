import { equivalenceSweep, type EquivalencePoseReport } from './equivalenceSweep';
import type { EquipmentCommand } from './equipment';
import { bestGateOnVessel } from './gatePlacement';
import type { VesselId } from '../physiology/vessels';
import type { Simulator } from './simulator';

/**
 * Ganchos de depuración en `window`, solo en desarrollo (`import.meta.env.DEV`):
 * `__sim()` devuelve el simulador vivo (cambia al cambiar de caso) y `__views()`
 * las vistas. Son funciones, no objetos, precisamente porque el simulador se
 * reemplaza. Nada del código de la aplicación depende de ellos.
 */
export interface DevViews {
  nav: unknown;
  cutMap: unknown;
  spectrogram: unknown;
}

/** Ganchos de prueba estables (e2e): se exponen en desarrollo o con `?e2e` en la URL. */
export interface TestHooks {
  equivalenceSweep: () => EquivalencePoseReport[];
  /** Avanza la simulación (fisiología + PW) `seconds` sin renderizar: SwiftShader es lento. */
  advance: (seconds: number) => void;
  /** Coloca la puerta PW sobre uno de los vasos con la técnica del operador; false si no lo ve. */
  placeGate: (vessels: VesselId[]) => boolean;
}

declare global {
  interface Window {
    __sim?: () => Simulator;
    __views?: () => DevViews;
    __vexusTest?: TestHooks;
  }
}

export function registerDevtools(getSim: () => Simulator, getViews: () => DevViews, dispatch: (cmd: EquipmentCommand) => void): void {
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) {
    window.__vexusTest = {
      equivalenceSweep: () => equivalenceSweep(getSim()),
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
  if (!import.meta.env.DEV) return;
  window.__sim = getSim;
  window.__views = getViews;
}
