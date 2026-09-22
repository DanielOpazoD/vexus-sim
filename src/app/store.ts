import type { CaseId } from '../cases';
/**
 * Almacén de estado de la aplicación (solo UI): modo de imagen, pestaña de la
 * consola, congelación, docente, navegador. El núcleo de simulación no depende
 * de él; la UI se suscribe y reacciona. Observable tipado sin dependencias.
 */
export type ImagingMode = 'B' | 'color' | 'pw';
export type PanelTab = 'adquirir' | 'imagen' | 'doppler' | 'medir' | 'docente';
export type MeasureTool = 'none' | 'caliper' | 'hepatic' | 'portal' | 'renal';

export interface AppState {
  mode: ImagingMode;
  tab: PanelTab;
  frozen: boolean;
  debug: boolean;
  audio: boolean;
  caseId: CaseId;
  torso: boolean;
  tool: MeasureTool;
}

type Listener = (state: AppState, prev: AppState) => void;

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial: AppState) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState>): void {
    const prev = this.state;
    const next = { ...prev, ...patch };
    let changed = false;
    for (const k of Object.keys(patch) as (keyof AppState)[]) {
      if (prev[k] !== next[k]) changed = true;
    }
    if (!changed) return;
    this.state = next;
    for (const l of this.listeners) l(next, prev);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
