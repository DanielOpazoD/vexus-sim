import { findCase, isCaseId, type CaseId } from '../cases';
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
/** La aplicación arranca en la referencia espiratoria; los casos conservan su patrón original para los bancos. */
function sessionPatient(id: CaseId) {
  const patient = clonePatient(findCase(id));
  patient.respiratoryPattern = 'apnea-expiratory';
  return patient;
}

type Listener = (next: Simulator, prev: Simulator) => void;

export class SimulationSession {
  private current: Simulator;
  readonly equipment: EquipmentController;
  private listeners = new Set<Listener>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    firstCase: CaseId,
  ) {
    this.current = new Simulator(sessionPatient(firstCase), canvas);
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
    if (this.current.patient.id === id) return null;
    return this.rebuild(id);
  }

  /**
   * «Reiniciar paciente» (decisión 79): vuelve a cargar el caso actual desde su definición, sin las intervenciones
   * ni la respiración cambiada (vuelve a la referencia espiratoria); la sonda y el equipo se conservan, como en un cambio de caso.
   */
  reloadCase(): unknown {
    const id = this.current.patient.id;
    return isCaseId(id) ? this.rebuild(id) : new Error(`caso desconocido: ${id}`);
  }

  private rebuild(id: CaseId): unknown {
    const prev = this.current;
    let next: Simulator;
    try {
      next = new Simulator(sessionPatient(id), this.canvas, prev.audio, prev.renderer);
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
