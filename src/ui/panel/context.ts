import type { Simulator } from '../../app/simulator';
import type { Store } from '../../app/store';
import type { Syncable } from '../controls';

/**
 * Lo que cada pestaña de la consola necesita del panel: acceso al simulador y al
 * estado de UI, registro de controles sincronizables y constructores de sección.
 * Las pestañas son funciones/clases independientes (`acquireTab`, `imageTab`, …);
 * `ControlPanel` solo las compone.
 */
export interface PanelContext {
  sim: () => Simulator;
  store: Store;
  /** Registra un control para `sync()` y lo devuelve. */
  track<T extends Syncable>(s: T): T;
  /** Vuelve a leer el estado del simulador en todos los controles. */
  sync(): void;
  /** Sección con título «bisel» dentro de una pestaña. */
  section(parent: HTMLElement, title: string): HTMLElement;
  /** Botonera segmentada (una opción activa). */
  segmented<T extends string>(parent: HTMLElement, options: Array<[T, string]>, get: () => T, set: (v: T) => void): void;
}
