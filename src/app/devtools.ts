import type { EquipmentCommand } from './equipment';
import type { Simulator } from './simulator';
import type { TestHooks } from './testHooks';

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

declare global {
  interface Window {
    __sim?: () => Simulator;
    __views?: () => DevViews;
    __vexusTest?: TestHooks;
  }
}

export function registerDevtools(getSim: () => Simulator, getViews: () => DevViews, dispatch: (cmd: EquipmentCommand) => void): void {
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) {
    // Carga diferida: el código de prueba no entra en el bundle principal
    void import('./testHooks').then((m) => (window.__vexusTest = m.createTestHooks(getSim, dispatch)));
  }
  if (!import.meta.env.DEV) return;
  window.__sim = getSim;
  window.__views = getViews;
}
