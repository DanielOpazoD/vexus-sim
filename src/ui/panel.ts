import type { EquivalenceReport } from '../app/equivalenceCheck';
import { errorLog, errorMessage } from '../app/errorLog';
import type { Simulator } from '../app/simulator';
import type { AppState, ImagingMode, PanelTab, Store } from '../app/store';
import { controlId, note, type Syncable } from './controls';
import { bindCollapsible } from './disclosure';
import { buildAcquireTab } from './panel/acquireTab';
import { modeHasColor, modeHasPw, type EquipmentCommand } from '../app/equipment';
import type { PanelContext, SectionOptions } from './panel/context';
import { buildDopplerTab, type DopplerPanels } from './panel/dopplerTab';
import { MeasureTab } from './panel/measureTab';
import type { TeacherTab } from './panel/teacherTab';

const ICONS: Record<PanelTab, string> = {
  adquirir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3h4v6l3 4v4q-5 3-10 0v-4l3-4Z"/><path d="M12 3v6"/></svg>',
  doppler: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h4l3-7 4 14 3-7h6"/></svg>',
  medir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20 20 4"/><path d="M4 12v8h8"/><path d="M12 4h8v8"/></svg>',
  docente: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v6l4 9H5l4-9Z"/><path d="M8 15h8"/></svg>',
};
const LABELS: Record<PanelTab, string> = { adquirir: 'Adquirir', doppler: 'Doppler', medir: 'Medir', docente: 'Docente' };
const TAB_ORDER: PanelTab[] = ['adquirir', 'doppler', 'medir', 'docente'];

/**
 * La pestaña sigue la intención del modo (botones y teclado): con Color o PW, «Doppler»; al volver a 2D, de
 * «Doppler» a «Adquirir», donde están los mandos de la imagen; cualquier otra pestaña se queda.
 */
export function tabAfterMode(mode: ImagingMode, tab: PanelTab): PanelTab {
  return mode !== 'B' ? 'doppler' : tab === 'doppler' ? 'adquirir' : tab;
}

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
  /** La pestaña Docente se carga la primera vez que se activa el modo docente (`loadTeacher`): el alumno no la descarga. */
  private teacher: TeacherTab | null = null;
  private teacherLoad: Promise<void> | null = null;
  private exportDiagnostics: (() => void) | null = null;
  private resetPatient: (() => unknown) | null = null;
  private equivalence: EquivalenceReport | null = null;
  set onExportDiagnostics(f: () => void) {
    this.exportDiagnostics = f;
    if (this.teacher) this.teacher.onExportDiagnostics = f;
  }
  set onResetPatient(f: () => unknown) {
    this.resetPatient = f;
    if (this.teacher) this.teacher.onResetPatient = f;
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

    // Esc descarta el ⓘ que se esté viendo (WCAG 1.4.13) y, si había uno, no sigue hasta los atajos
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const shown = [...root.querySelectorAll<HTMLElement>('.info')].filter(
        (i) =>
          !i.classList.contains('dismissed') &&
          (i.classList.contains('show') || i.matches(':hover, :focus-visible') || !!i.nextElementSibling?.matches(':hover')),
      );
      for (const i of shown) {
        i.classList.remove('show');
        i.classList.add('dismissed');
      }
      if (shown.length) e.stopPropagation();
    });

    buildAcquireTab(this, this.panels.get('adquirir')!);
    this.doppler = buildDopplerTab(this, this.panels.get('doppler')!);
    this.measure = new MeasureTab(this, this.panels.get('medir')!, badge);
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
    if (st.debug) void this.loadTeacher();
    this.doppler.empty.hidden = st.mode !== 'B';
    this.doppler.color.hidden = !modeHasColor(st.mode);
    this.doppler.pw.hidden = !modeHasPw(st.mode);
    this.measure.applyStore(st);
    this.sync();
  }

  sync(): void {
    for (const s of this.syncables) s.sync();
  }

  /**
   * Carga la pestaña Docente (verdad fisiológica, intervenciones y diagnóstico) en su propio chunk, una sola vez. Solo
   * se ve en modo docente, así que el alumno no descarga su código. Si la carga falla, lo dice en la pestaña y en el
   * registro de errores.
   */
  private loadTeacher(): Promise<void> {
    this.teacherLoad ??= import('./panel/teacherTab')
      .then(({ TeacherTab }) => {
        const t = new TeacherTab(this, this.panels.get('docente')!);
        // una intervención cambia al paciente: las mediciones de antes no entran en el grado de después
        t.onIntervention = () => this.measure.clearMeasurements();
        if (this.exportDiagnostics) t.onExportDiagnostics = this.exportDiagnostics;
        if (this.resetPatient) t.onResetPatient = this.resetPatient;
        t.equivalence = this.equivalence;
        this.teacher = t;
        this.sync();
      })
      .catch((e: unknown) => {
        errorLog.report('ui', e);
        note(this.panels.get('docente')!, `No se pudo cargar la pestaña Docente: ${errorMessage(e)}`).setAttribute('role', 'alert');
      });
    return this.teacherLoad;
  }

  /** Borra las mediciones adquiridas y el aviso de la última intervención (cambio de caso o reinicio). */
  onSimulatorChanged(): void {
    this.measure.clearMeasurements();
    this.teacher?.onSimulatorChanged();
  }

  setIvcCaliper(mm: number | null): void {
    this.measure.setIvcCaliper(mm);
  }

  renderResult(): void {
    this.measure.renderResult();
  }

  renderDebug(): void {
    this.teacher?.renderDebug();
  }

  setEquivalence(report: EquivalenceReport | null): void {
    this.equivalence = report;
    if (this.teacher) this.teacher.equivalence = report;
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
    // patrón acordeón: el encabezado contiene el botón que pliega (un botón no admite un encabezado dentro)
    const h = document.createElement('h3');
    h.className = 'section-title';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'section-toggle';
    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.setAttribute('aria-hidden', 'true');
    toggle.append(chevron, title);
    h.appendChild(toggle);
    head.appendChild(h);
    if (opts.info) head.append(...infoTip(title, opts.info));
    const body = document.createElement('div');
    body.className = 'section-body';
    body.id = controlId(`seccion-${title}`);
    toggle.setAttribute('aria-controls', body.id);
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
  b.addEventListener('click', () => {
    b.classList.remove('dismissed');
    b.classList.toggle('show');
  });
  b.addEventListener('blur', () => b.classList.remove('show', 'dismissed'));
  b.addEventListener('pointerenter', () => b.classList.remove('dismissed'));
  return [b, tip];
}
