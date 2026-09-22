import { findCase, type CaseId } from '../cases';
import { C_RECONSTRUCTION_MM_S } from '../core/units';
import { clonePatient } from '../physiology/patientState';
import { EquipmentController } from './equipment';
import { errorLog } from './errorLog';
import { Simulator, defaultEquipment } from './simulator';

/**
 * Sesión de simulación (Fase 1): dueña del `Simulator` vivo y del estado del equipo, que
 * sobrevive a los cambios de caso. El cambio de caso es transaccional: el simulador nuevo
 * se construye antes de tocar nada; si falla, sigue el anterior y se devuelve el error. El
 * renderizador (programas GLSL compilados) pasa al simulador nuevo con su escena.
 */
type Listener = (next: Simulator, prev: Simulator) => void;

export class SimulationSession {
  private current: Simulator;
  readonly equipment: EquipmentController;
  private listeners = new Set<Listener>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    firstCase: CaseId,
  ) {
    this.current = new Simulator(clonePatient(findCase(firstCase)), canvas);
    this.equipment = new EquipmentController(defaultEquipment(), {
      halfSectorRad: this.current.transducer.halfSector,
      cMmS: C_RECONSTRUCTION_MM_S,
    });
    this.current.equipment = this.equipment.state;
    this.equipment.subscribe((next) => {
      this.current.equipment = next;
    });
  }

  get sim(): Simulator {
    return this.current;
  }

  /** Cambia de caso; devuelve el error si no se pudo (el caso anterior sigue activo). */
  loadCase(id: CaseId): unknown {
    const prev = this.current;
    if (prev.patient.id === id) return null;
    let next: Simulator;
    try {
      next = new Simulator(clonePatient(findCase(id)), this.canvas, prev.audio, prev.renderer);
    } catch (e) {
      errorLog.report('caso', e);
      // si llegó a cambiarse la escena del renderizador compartido, vuelve a la del caso anterior
      if (prev.renderer.scene !== prev.scene) {
        try {
          prev.renderer.setScene(prev.scene);
        } catch (e2) {
          errorLog.report('caso', e2);
        }
      }
      return e;
    }
    next.setPose(prev.pose);
    next.equipment = this.equipment.state;
    next.frozen = prev.frozen;
    this.current = next;
    prev.dispose({ keepRenderer: true });
    next.pwChain.reset();
    for (const l of this.listeners) l(next, prev);
    return null;
  }

  onSimulatorChanged(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
