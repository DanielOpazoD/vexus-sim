import type { EquivalenceReport } from '../app/equivalenceCheck';
import type { Simulator } from '../app/simulator';
import type { AppState, PanelTab, Store } from '../app/store';
import type { StartPoint } from '../app/startPoints';
import type { Syncable } from './controls';
import { buildAcquireTab } from './panel/acquireTab';
import type { EquipmentCommand } from '../app/equipment';
import type { PanelContext } from './panel/context';
import { buildDopplerTab, type DopplerPanels } from './panel/dopplerTab';
import { buildImageTab } from './panel/imageTab';
import { MeasureTab } from './panel/measureTab';
import { TeacherTab } from './panel/teacherTab';

const ICONS: Record<PanelTab, string> = {
  adquirir: '<svg viewBox="0 0 24 24"><path d="M12 3 4 19h16Z"/><path d="M7 13h10"/></svg>',
  imagen: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m4 17 5-5 4 4 3-3 4 4"/></svg>',
  doppler: '<svg viewBox="0 0 24 24"><path d="M2 12h4l3-7 4 14 3-7h6"/></svg>',
  medir: '<svg viewBox="0 0 24 24"><path d="M4 20 20 4"/><path d="M4 12v8h8"/><path d="M12 4h8v8"/></svg>',
  docente: '<svg viewBox="0 0 24 24"><path d="M9 3h6v6l4 9H5l4-9Z"/><path d="M8 15h8"/></svg>',
};
const LABELS: Record<PanelTab, string> = { adquirir: 'Adquirir', imagen: 'Imagen', doppler: 'Doppler', medir: 'Medir', docente: 'Docente' };
const TAB_ORDER: PanelTab[] = ['adquirir', 'imagen', 'doppler', 'medir', 'docente'];

/**
 * Consola derecha por pestañas (guía §16–§17): cada control actúa en su etapa
 * física; la pestaña sigue la intención (activar Color o PW abre Doppler). Esta
 * clase solo compone las pestañas (`./panel/*`) y reparte el estado de UI.
 */
export class ControlPanel implements PanelContext {
  private syncables: Syncable[] = [];
  private tabs = new Map<PanelTab, HTMLButtonElement>();
  private panels = new Map<PanelTab, HTMLElement>();
  private doppler: DopplerPanels;
  private measure: MeasureTab;
  private teacher: TeacherTab;
  onStartPoint: (p: StartPoint) => void = () => undefined;
  set onExportDiagnostics(f: () => void) {
    this.teacher.onExportDiagnostics = f;
  }

  constructor(
    root: HTMLElement,
    readonly sim: () => Simulator,
    readonly store: Store,
    readonly dispatch: (cmd: EquipmentCommand) => void,
  ) {
    root.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'console-tabs';
    bar.setAttribute('role', 'tablist');
    const scroll = document.createElement('div');
    scroll.className = 'console-scroll';
    root.append(bar, scroll);
    for (const id of TAB_ORDER) {
      const b = document.createElement('button');
      b.className = 'tab';
      b.setAttribute('role', 'tab');
      b.innerHTML = `${ICONS[id]}<span>${LABELS[id]}</span>`; // iconos estáticos del programa
      b.addEventListener('click', () => this.store.set({ tab: id }));
      bar.appendChild(b);
      this.tabs.set(id, b);
      const p = document.createElement('div');
      p.className = 'tab-panel';
      p.style.display = 'none';
      scroll.appendChild(p);
      this.panels.set(id, p);
    }
    const badge = document.createElement('span');
    badge.className = 'tab-badge';
    badge.style.display = 'none';
    this.tabs.get('medir')!.appendChild(badge);

    buildAcquireTab(this, this.panels.get('adquirir')!, (sp) => this.onStartPoint(sp));
    buildImageTab(this, this.panels.get('imagen')!);
    this.doppler = buildDopplerTab(this, this.panels.get('doppler')!);
    this.measure = new MeasureTab(this, this.panels.get('medir')!, badge);
    this.teacher = new TeacherTab(this, this.panels.get('docente')!);
    this.applyStore(store.get());
    store.subscribe((st) => this.applyStore(st));
  }

  private applyStore(st: AppState): void {
    for (const [id, b] of this.tabs) b.classList.toggle('active', id === st.tab);
    for (const [id, p] of this.panels) p.style.display = id === st.tab ? '' : 'none';
    this.tabs.get('docente')!.style.display = st.debug ? '' : 'none';
    this.doppler.empty.style.display = st.mode === 'B' ? '' : 'none';
    this.doppler.color.style.display = st.mode === 'color' ? '' : 'none';
    this.doppler.pw.style.display = st.mode === 'pw' ? '' : 'none';
    this.measure.applyStore(st);
    this.sync();
  }

  sync(): void {
    for (const s of this.syncables) s.sync();
  }

  /** Borra las mediciones adquiridas (cambio de caso): nunca se mezclan pacientes. */
  onSimulatorChanged(): void {
    this.measure.clearMeasurements();
  }

  setIvcCaliper(mm: number | null): void {
    this.measure.setIvcCaliper(mm);
  }

  renderResult(): void {
    this.measure.renderResult();
  }

  renderDebug(): void {
    this.teacher.renderDebug();
  }

  setEquivalence(report: EquivalenceReport | null): void {
    this.teacher.equivalence = report;
  }

  track<T extends Syncable>(s: T): T {
    this.syncables.push(s);
    return s;
  }

  section(parent: HTMLElement, title: string): HTMLElement {
    const s = document.createElement('div');
    s.className = 'section';
    const h = document.createElement('h4');
    h.textContent = title;
    s.appendChild(h);
    parent.appendChild(s);
    return s;
  }

  segmented<T extends string>(parent: HTMLElement, options: Array<[T, string]>, get: () => T, set: (v: T) => void): void {
    const seg = document.createElement('div');
    seg.className = 'seg';
    const buttons: HTMLButtonElement[] = [];
    for (const [v, label] of options) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => {
        set(v);
        this.sync();
      });
      seg.appendChild(b);
      buttons.push(b);
    }
    parent.appendChild(seg);
    this.track({ sync: () => buttons.forEach((b, i) => b.classList.toggle('on', options[i][0] === get())) });
  }
}
