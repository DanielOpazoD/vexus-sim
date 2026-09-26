import type { EquipmentCommand } from '../../app/equipment';
import type { Simulator } from '../../app/simulator';
import type { Store } from '../../app/store';
import type { Syncable } from '../controls';

/** Opciones de una sección de la consola. */
export interface SectionOptions {
  /** Plegada al empezar (los mandos avanzados). */
  collapsed?: boolean;
  /** Explicación larga, detrás del ⓘ de la cabecera en vez de un bloque de texto fijo. */
  info?: string;
}

/**
 * Lo que cada pestaña de la consola necesita del panel: acceso al simulador y al
 * estado de UI, registro de controles sincronizables y constructores de sección.
 * Las pestañas son funciones/clases independientes (`acquireTab`, `dopplerTab`, …);
 * `ControlPanel` solo las compone.
 */
export interface PanelContext {
  sim: () => Simulator;
  store: Store;
  /** Único camino para cambiar el equipo: comandos normalizados por `EquipmentController`. */
  dispatch(cmd: EquipmentCommand): void;
  /** Registra un control para `sync()` y lo devuelve. */
  track<T extends Syncable>(s: T): T;
  /** Vuelve a leer el estado del simulador en todos los controles. */
  sync(): void;
  /** Sección plegable con título dentro de una pestaña; devuelve el cuerpo donde van sus controles. */
  section(parent: HTMLElement, title: string, opts?: SectionOptions): HTMLElement;
  /** Botonera segmentada (una opción activa); devuelve su contenedor. */
  segmented<T extends string>(parent: HTMLElement, options: Array<[T, string]>, get: () => T, set: (v: T) => void): HTMLElement;
}
