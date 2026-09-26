import type { EquivalenceReport } from '../app/equivalenceCheck';
import type { Simulator } from '../app/simulator';
import type { AppState, PanelTab, Store } from '../app/store';
import { controlId, type Syncable } from './controls';
import { bindCollapsible } from './disclosure';
import { buildAcquireTab } from './panel/acquireTab';
import { modeHasColor, modeHasPw, type EquipmentCommand } from '../app/equipment';
import type { PanelContext, SectionOptions } from './panel/context';
import { buildDopplerTab, type DopplerPanels } from './panel/dopplerTab';
import { MeasureTab } from './panel/measureTab';
import { TeacherTab } from './panel/teacherTab';

const ICONS: Record<PanelTab, string> = {
  adquirir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3h4v6l3 4v4q-5 3-10 0v-4l3-4Z"/><path d="M12 3v6"/></svg>',
  doppler: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h4l3-7 4 14 3-7h6"/></svg>',
  medir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20 20 4"/><path d="M4 12v8h8"/><path d="M12 4h8v8"/></svg>',
  docente: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v6l4 9H5l4-9Z"/><path d="M8 15h8"/></svg>',
};
const LABELS: Record<PanelTab, string> = { adquirir: 'Adquirir', doppler: 'Doppler', medir: 'Medir', docente: 'Docente' };
const TAB_ORDER: PanelTab[] = ['adquirir', 'doppler', 'medir', 'docente'];

/**
 * Consola derecha por pestañas (guía §16–§17): cada control actúa en su etapa
 * física; la pestaña sigue la intención (activar Color o PW abre Doppler). Esta
 * clase solo compone las pestañas (`./panel/*`) y reparte el estado de UI. Cada
 * pestaña se ordena en secciones plegables: lo básico arriba y abierto, lo avanzado
 * plegado, y las explicaciones largas detrás del ⓘ de la sección.
 */
export class ControlPanel implements PanelContext {
  private syncables: Syncable[] = [];
  private tabs = new Map<PanelTab, HTMLButtonElement>();
  private panels = new Map<PanelTab, HTMLElement>();
  private doppler: DopplerPanels;
  private measure: MeasureTab;
  private teacher: TeacherTab;
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
    bar.setAttribute('aria-label', 'Consola');
    const scroll = document.createElement('div');
    scroll.className = 'console-scroll';
    root.append(bar, scroll);
    for (const id of TAB_ORDER) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab';
      b.id = `tab-${id}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', `tabpanel-${id}`);
      b.innerHTML = `${ICONS[id]}<span>${LABELS[id]}</span>`; // iconos estáticos del programa
      b.addEventListener('click', () => this.store.set({ tab: id }));
      bar.appendChild(b);
      this.tabs.set(id, b);
      const p = document.createElement('div');
      p.className = 'tab-panel';
      p.id = `tabpanel-${id}`;
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('aria-labelledby', b.id);
      p.hidden = true;
      scroll.appendChild(p);
      this.panels.set(id, p);
    }
    const badge = document.createElement('span');
    badge.className = 'tab-badge';
    badge.hidden = true;
    this.tabs.get('medir')!.appendChild(badge);

    buildAcquireTab(this, this.panels.get('adquirir')!);
    this.doppler = buildDopplerTab(this, this.panels.get('doppler')!);
    this.measure = new MeasureTab(this, this.panels.get('medir')!, badge);
    this.teacher = new TeacherTab(this, this.panels.get('docente')!);
    this.applyStore(store.get());
    store.subscribe((st) => this.applyStore(st));
  }

  private applyStore(st: AppState): void {
    for (const [id, b] of this.tabs) {
      b.classList.toggle('active', id === st.tab);
      b.setAttribute('aria-selected', String(id === st.tab));
    }
    for (const [id, p] of this.panels) p.hidden = id !== st.tab;
    this.tabs.get('docente')!.hidden = !st.debug;
    this.doppler.empty.hidden = st.mode !== 'B';
    this.doppler.color.hidden = !modeHasColor(st.mode);
    this.doppler.pw.hidden = !modeHasPw(st.mode);
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

  section(parent: HTMLElement, title: string, opts: SectionOptions = {}): HTMLElement {
    const s = document.createElement('section');
    s.className = 'section';
    const head = document.createElement('div');
    head.className = 'section-head';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'section-toggle';
    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.setAttribute('aria-hidden', 'true');
    const h = document.createElement('h3');
    h.textContent = title;
    toggle.append(chevron, h);
    head.appendChild(toggle);
    if (opts.info) head.append(...infoTip(title, opts.info));
    const body = document.createElement('div');
    body.className = 'section-body';
    s.append(head, body);
    parent.appendChild(s);
    bindCollapsible(toggle, s, !opts.collapsed);
    return body;
  }

  segmented<T extends string>(parent: HTMLElement, options: Array<[T, string]>, get: () => T, set: (v: T) => void): HTMLElement {
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'group');
    const buttons: HTMLButtonElement[] = [];
    for (const [v, label] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => {
        set(v);
        this.sync();
      });
      seg.appendChild(b);
      buttons.push(b);
    }
    parent.appendChild(seg);
    this.track({
      sync: () =>
        buttons.forEach((b, i) => {
          const on = options[i][0] === get();
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', String(on));
        }),
    });
    return seg;
  }
}

/**
 * ⓘ con la explicación larga de una sección: el texto se ve al pasar el ratón o con el foco (teclado) y un
 * clic lo fija hasta perder el foco (pantallas táctiles). Es la descripción accesible del botón
 * (`aria-describedby`); el nombre queda corto, «Ayuda: <sección>».
 */
function infoTip(title: string, text: string): [HTMLButtonElement, HTMLElement] {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.id = controlId(`ayuda-${title}`);
  tip.setAttribute('role', 'tooltip');
  tip.textContent = text;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'info';
  b.textContent = 'i';
  b.setAttribute('aria-label', `Ayuda: ${title}`);
  b.setAttribute('aria-describedby', tip.id);
  b.addEventListener('click', () => b.classList.toggle('show'));
  b.addEventListener('blur', () => b.classList.remove('show'));
  return [b, tip];
}
