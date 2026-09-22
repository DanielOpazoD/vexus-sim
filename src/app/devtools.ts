import { equivalenceSweep, type EquivalencePoseReport } from './equivalenceSweep';
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
}

declare global {
  interface Window {
    __sim?: () => Simulator;
    __views?: () => DevViews;
    __vexusTest?: TestHooks;
  }
}

export function registerDevtools(getSim: () => Simulator, getViews: () => DevViews): void {
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) {
    window.__vexusTest = { equivalenceSweep: () => equivalenceSweep(getSim()) };
  }
  if (!import.meta.env.DEV) return;
  window.__sim = getSim;
  window.__views = getViews;
}
