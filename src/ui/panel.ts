import { EQUIPMENT_LIMITS } from '../app/simulator';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import { nyquistVelocityCms, prfFromNyquistCms } from '../core/units';
import type { Simulator } from '../app/simulator';
import type { AppState, MeasureTool, PanelTab, Store } from '../app/store';
import {
  measureObservedHepatic,
  measureObservedPortal,
  measureObservedRenal,
  type ObservedHepatic,
  type ObservedPortal,
  type ObservedRenal,
} from '../doppler/spectralMeasure';
import type { RespiratoryPattern } from '../physiology/patientState';
import { classifyVexusC, type HepaticPattern, type RenalPattern, type VexusResult } from '../vexus/classification';
import { measurePhysiologyTruth } from '../vexus/measurements';
import { button, help, row, slider, type Syncable } from './controls';

/** Puntos de partida sobre la piel (posición y marcador; la vista hay que encontrarla). */

const ICONS: Record<PanelTab, string> = {
  adquirir: '<svg viewBox="0 0 24 24"><path d="M12 3 4 19h16Z"/><path d="M7 13h10"/></svg>',
  imagen: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m4 17 5-5 4 4 3-3 4 4"/></svg>',
  doppler: '<svg viewBox="0 0 24 24"><path d="M2 12h4l3-7 4 14 3-7h6"/></svg>',
  medir: '<svg viewBox="0 0 24 24"><path d="M4 20 20 4"/><path d="M4 12v8h8"/><path d="M12 4h8v8"/></svg>',
  docente: '<svg viewBox="0 0 24 24"><path d="M9 3h6v6l4 9H5l4-9Z"/><path d="M8 15h8"/></svg>',
};
const LABELS: Record<PanelTab, string> = { adquirir: 'Adquirir', imagen: 'Imagen', doppler: 'Doppler', medir: 'Medir', docente: 'Docente' };

/**
 * Consola derecha por pestañas (guía §16–§17): cada control actúa en su etapa
 * física; la pestaña sigue la intención (activar Color o PW abre Doppler).
 */
export class ControlPanel {
  private syncables: Syncable[] = [];
  private tabs = new Map<PanelTab, HTMLButtonElement>();
  private panels = new Map<PanelTab, HTMLElement>();
  private badge!: HTMLElement;
  private resultEl!: HTMLElement;
  private debugEl!: HTMLElement;
  private dopplerEmpty!: HTMLElement;
  private dopplerColor!: HTMLElement;
  private dopplerPw!: HTMLElement;
  private captureCard!: HTMLElement;
  private measureBody!: HTMLElement;
  private lastHepatic: ObservedHepatic | null = null;
  private lastPortal: ObservedPortal | null = null;
  private lastRenal: ObservedRenal | null = null;
  private ivcCaliperMm: number | null = null;
  onStartPoint: (p: StartPoint) => void = () => undefined;

  constructor(
    root: HTMLElement,
    private readonly sim: () => Simulator,
    private readonly store: Store,
  ) {
    root.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'console-tabs';
    bar.setAttribute('role', 'tablist');
    const scroll = document.createElement('div');
    scroll.className = 'console-scroll';
    root.append(bar, scroll);
    for (const id of ['adquirir', 'imagen', 'doppler', 'medir', 'docente'] as PanelTab[]) {
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
    this.badge = document.createElement('span');
    this.badge.className = 'tab-badge';
    this.badge.style.display = 'none';
    this.tabs.get('medir')!.appendChild(this.badge);

    this.buildAcquire(this.panels.get('adquirir')!);
    this.buildImage(this.panels.get('imagen')!);
    this.buildDoppler(this.panels.get('doppler')!);
    this.buildMeasure(this.panels.get('medir')!);
    this.buildTeacher(this.panels.get('docente')!);
    this.applyStore(store.get());
    store.subscribe((st) => this.applyStore(st));
  }

  private applyStore(st: AppState): void {
    for (const [id, b] of this.tabs) b.classList.toggle('active', id === st.tab);
    for (const [id, p] of this.panels) p.style.display = id === st.tab ? '' : 'none';
    this.tabs.get('docente')!.style.display = st.debug ? '' : 'none';
    this.dopplerEmpty.style.display = st.mode === 'B' ? '' : 'none';
    this.dopplerColor.style.display = st.mode === 'color' ? '' : 'none';
    this.dopplerPw.style.display = st.mode === 'pw' ? '' : 'none';
    this.captureCard.style.display = st.tool === 'none' ? 'none' : '';
    this.measureBody.style.display = st.tool === 'none' ? '' : 'none';
    this.sync();
  }

  sync(): void {
    for (const s of this.syncables) s.sync();
  }

  /** Borra toda medición adquirida (cambio de caso o «Borrar»): nunca se mezclan pacientes. */
  clearMeasurements(): void {
    this.lastHepatic = null;
    this.lastPortal = null;
    this.lastRenal = null;
    this.ivcCaliperMm = null;
    this.sync();
    this.renderResult();
  }

  onSimulatorChanged(): void {
    this.clearMeasurements();
  }

  setIvcCaliper(mm: number | null): void {
    this.ivcCaliperMm = mm;
    this.renderResult();
  }

  private track<T extends Syncable>(s: T): T {
    this.syncables.push(s);
    return s;
  }

  private section(parent: HTMLElement, title: string): HTMLElement {
    const s = document.createElement('div');
    s.className = 'section';
    const h = document.createElement('h4');
    h.textContent = title;
    s.appendChild(h);
    parent.appendChild(s);
    return s;
  }

  private segmented<T extends string>(parent: HTMLElement, options: Array<[T, string]>, get: () => T, set: (v: T) => void): void {
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

  // --- Adquirir ---------------------------------------------------------------
  private buildAcquire(p: HTMLElement): void {
    const s = this.sim;
    const start = this.section(p, 'Puntos de partida');
    const grid = document.createElement('div');
    grid.className = 'tool-grid';
    for (const sp of START_POINTS) {
      const b = document.createElement('button');
      b.textContent = sp.label;
      b.title = sp.hint;
      b.addEventListener('click', () => this.onStartPoint(sp));
      grid.appendChild(b);
    }
    start.appendChild(grid);
    help(
      start,
      'La sonda se desliza de forma continua hasta la posición cutánea de partida con ángulos neutros; la ventana diagnóstica hay que afinarla a mano (guía §8).',
    );

    const probe = this.section(p, 'Sonda');
    const deg = (v: number) => `${v.toFixed(0)}°`;
    this.track(
      slider(
        probe,
        {
          label: 'Rotación',
          min: -180,
          max: 180,
          step: 1,
          get: () => (s().pose.yaw * 180) / Math.PI,
          set: (v) => s().setPose({ ...s().pose, yaw: (v * Math.PI) / 180 }),
          format: deg,
        },
        () => undefined,
      ),
    );
    this.track(
      slider(
        probe,
        {
          label: 'Inclinación',
          min: -40,
          max: 40,
          step: 1,
          get: () => (s().pose.tilt * 180) / Math.PI,
          set: (v) => s().setPose({ ...s().pose, tilt: (v * Math.PI) / 180 }),
          format: deg,
        },
        () => undefined,
      ),
    );
    this.track(
      slider(
        probe,
        {
          label: 'Basculación',
          min: -40,
          max: 40,
          step: 1,
          get: () => (s().pose.rock * 180) / Math.PI,
          set: (v) => s().setPose({ ...s().pose, rock: (v * Math.PI) / 180 }),
          format: deg,
        },
        () => undefined,
      ),
    );
    this.track(
      slider(
        probe,
        {
          label: 'Presión',
          min: -6,
          max: 12,
          step: 0.5,
          get: () => -s().pose.lift,
          set: (v) => s().setPose({ ...s().pose, lift: -v }),
          format: (v) => `${v.toFixed(1)} mm`,
        },
        () => undefined,
      ),
    );
    const pos = document.createElement('div');
    pos.className = 'help';
    probe.appendChild(pos);
    this.track({
      sync: () =>
        (pos.textContent = `φ ${((s().pose.phi * 180) / Math.PI).toFixed(0)}° · z ${(s().pose.z / 10).toFixed(1)} cm · acoplamiento ${(s().renderer.meanCoupling() * 100).toFixed(0)} %`),
    });
    const r = row(probe);
    this.track(button(r, 'Reiniciar sonda', () => s().setPose({ ...s().pose, yaw: 0, rock: 0, tilt: 0, lift: 0 })));

    const pat = this.section(p, 'Caso y paciente');
    const info = document.createElement('div');
    info.className = 'help';
    pat.appendChild(info);
    this.track({
      sync: () => (info.textContent = `${s().patient.label} · FC ${s().patient.heartRateBpm} · resp ${s().patient.respiratoryRateMin}/min`),
    });
    const rl = document.createElement('div');
    rl.className = 'help';
    rl.textContent = 'Respiración';
    pat.appendChild(rl);
    this.segmented<RespiratoryPattern>(
      pat,
      [
        ['quiet', 'Tranquila'],
        ['deep', 'Profunda'],
        ['apnea-expiratory', 'Apnea esp'],
        ['apnea-inspiratory', 'Apnea insp'],
      ],
      () => s().patient.respiratoryPattern,
      (v) => (s().patient.respiratoryPattern = v),
    );
    help(
      pat,
      'La maniobra cambia presiones y movimiento; no reinicia el ciclo cardíaco. Teclado: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> deslizar · <kbd>Q</kbd><kbd>E</kbd> rotar · <kbd>←→</kbd> bascular · <kbd>↑↓</kbd> inclinar · <kbd>R</kbd><kbd>F</kbd> presión.',
    );
  }

  // --- Imagen -----------------------------------------------------------------
  private buildImage(p: HTMLElement): void {
    const s = this.sim;
    const sec = this.section(p, 'Imagen 2D');
    const ch = () => undefined;
    this.track(
      slider(
        sec,
        {
          label: 'Profundidad',
          ...EQUIPMENT_LIMITS.depthMm,
          get: () => s().bmode.depthMm,
          set: (v) => (s().bmode.depthMm = v),
          format: (v) => `${(v / 10).toFixed(0)} cm`,
        },
        ch,
      ),
    );
    this.track(
      slider(
        sec,
        {
          label: 'Ganancia',
          ...EQUIPMENT_LIMITS.gainDb,
          get: () => s().bmode.gainDb,
          set: (v) => (s().bmode.gainDb = v),
          format: (v) => `${v} dB`,
        },
        ch,
      ),
    );
    this.track(
      slider(
        sec,
        {
          label: 'Foco',
          min: 20,
          max: 200,
          step: 5,
          get: () => s().bmode.focusMm,
          set: (v) => (s().bmode.focusMm = v),
          format: (v) => `${(v / 10).toFixed(1)} cm`,
        },
        ch,
      ),
    );
    this.track(
      slider(
        sec,
        {
          label: 'Rango dinámico',
          min: 40,
          max: 80,
          step: 2,
          get: () => s().bmode.dynamicRangeDb,
          set: (v) => (s().bmode.dynamicRangeDb = v),
          format: (v) => `${v} dB`,
        },
        ch,
      ),
    );
    this.track(
      slider(
        sec,
        {
          label: 'Persistencia',
          min: 0,
          max: 0.8,
          step: 0.05,
          get: () => s().bmode.persistence,
          set: (v) => (s().bmode.persistence = v),
          format: (v) => v.toFixed(2),
        },
        ch,
      ),
    );
    const tgcSec = this.section(p, 'TGC');
    const bank = document.createElement('div');
    bank.className = 'tgc';
    for (let i = 0; i < 8; i++) {
      const inp = document.createElement('input');
      inp.type = 'range';
      inp.min = '-15';
      inp.max = '15';
      inp.step = '1';
      inp.title = `TGC banda ${i + 1} (${i < 4 ? 'superficial' : 'profunda'})`;
      inp.addEventListener('input', () => (s().bmode.tgcDb[i] = Number(inp.value)));
      bank.appendChild(inp);
      this.track({ sync: () => (inp.value = String(s().bmode.tgcDb[i])) });
    }
    tgcSec.appendChild(bank);
    help(tgcSec, 'Superficial → profundo. Amplifica ecos y ruido por igual; no recupera lo que la atenuación extinguió.');
  }

  // --- Doppler ---------------------------------------------------------------
  private buildDoppler(p: HTMLElement): void {
    const s = this.sim;
    const ch = () => undefined;
    this.dopplerEmpty = document.createElement('div');
    this.dopplerEmpty.className = 'empty';
    this.dopplerEmpty.textContent = 'Activa Color o PW en la barra inferior para ver sus controles.';
    const r0 = row(this.dopplerEmpty);
    button(r0, 'Color', () => this.store.set({ mode: 'color', tab: 'doppler' }));
    button(r0, 'PW', () => this.store.set({ mode: 'pw', tab: 'doppler' }));
    p.appendChild(this.dopplerEmpty);

    this.dopplerColor = document.createElement('div');
    p.appendChild(this.dopplerColor);
    const c = this.section(this.dopplerColor, 'Doppler color');
    this.track(
      slider(
        c,
        {
          label: 'Escala',
          min: 4,
          max: 60,
          step: 1,
          get: () => Math.round(nyquistVelocityCms(s().color.prfHz, s().transducer.f0Doppler)),
          set: (v) => (s().color.prfHz = Math.round(prfFromNyquistCms(v, s().transducer.f0Doppler))),
          format: (v) => `±${v} cm/s`,
        },
        ch,
      ),
    );
    this.track(
      slider(
        c,
        {
          label: 'Filtro pared',
          min: 20,
          max: 400,
          step: 10,
          get: () => s().color.wallFilterHz,
          set: (v) => (s().color.wallFilterHz = v),
          format: (v) => `${v} Hz`,
        },
        ch,
      ),
    );
    this.track(
      slider(
        c,
        {
          label: 'Ganancia',
          min: 0.2,
          max: 4,
          step: 0.1,
          get: () => s().color.gain,
          set: (v) => (s().color.gain = v),
          format: (v) => v.toFixed(1),
        },
        ch,
      ),
    );
    const cr = row(c);
    this.track(
      button(
        cr,
        'Invertir mapa',
        () => (s().color.invert = !s().color.invert),
        () => s().color.invert,
      ),
    );
    this.track(button(cr, 'Caja +', () => sizeBox(s(), 1.15)));
    this.track(button(cr, 'Caja −', () => sizeBox(s(), 1 / 1.15)));
    help(
      c,
      'Clic en la imagen centra la caja. Escala baja → aliasing; filtro alto → desaparece flujo lento; el color depende de la orientación del haz.',
    );

    this.dopplerPw = document.createElement('div');
    p.appendChild(this.dopplerPw);
    const w = this.section(this.dopplerPw, 'Doppler pulsado');
    this.track(
      slider(
        w,
        {
          label: 'Escala',
          min: 5,
          max: 120,
          step: 1,
          get: () => Math.round(nyquistVelocityCms(s().pw.prfHz, s().transducer.f0Doppler)),
          set: (v) => (s().pw.prfHz = Math.round(prfFromNyquistCms(v, s().transducer.f0Doppler))),
          format: (v) => `±${v} cm/s`,
        },
        ch,
      ),
    );
    this.track(
      slider(
        w,
        {
          label: 'Puerta',
          min: 1,
          max: 10,
          step: 0.5,
          get: () => s().pw.gateMm,
          set: (v) => (s().pw.gateMm = v),
          format: (v) => `${v.toFixed(1)} mm`,
        },
        ch,
      ),
    );
    this.track(
      slider(
        w,
        {
          label: 'Filtro pared',
          min: 10,
          max: 300,
          step: 5,
          get: () => s().pw.wallFilterHz,
          set: (v) => (s().pw.wallFilterHz = v),
          format: (v) => `${v} Hz`,
        },
        ch,
      ),
    );
    this.track(
      slider(
        w,
        {
          label: 'Línea base',
          min: -0.45,
          max: 0.45,
          step: 0.05,
          get: () => s().pw.baselineShift,
          set: (v) => (s().pw.baselineShift = v),
          format: (v) => `${(v * 100).toFixed(0)} %`,
        },
        ch,
      ),
    );
    this.track(
      slider(
        w,
        {
          label: 'Ganancia',
          ...EQUIPMENT_LIMITS.gainDb,
          get: () => s().pw.gainDb,
          set: (v) => (s().pw.gainDb = v),
          format: (v) => `${v} dB`,
        },
        ch,
      ),
    );
    this.track(
      slider(
        w,
        {
          label: 'Corr. angular',
          min: -80,
          max: 80,
          step: 1,
          get: () => (s().pw.angleCorrection * 180) / Math.PI,
          set: (v) => (s().pw.angleCorrection = (v * Math.PI) / 180),
          format: (v) => `${v.toFixed(0)}°`,
        },
        ch,
      ),
    );
    const sweepRow = document.createElement('div');
    sweepRow.className = 'control';
    const sl = document.createElement('label');
    sl.textContent = 'Barrido';
    sweepRow.appendChild(sl);
    const segHost = document.createElement('div');
    sweepRow.appendChild(segHost);
    this.segmented<'25' | '50' | '100'>(
      segHost,
      [
        ['25', '25'],
        ['50', '50'],
        ['100', '100'],
      ],
      () => String(s().pw.sweepMmS) as '25' | '50' | '100',
      (v) => (s().pw.sweepMmS = Number(v)),
    );
    const so = document.createElement('output');
    so.textContent = 'mm/s';
    sweepRow.appendChild(so);
    w.appendChild(sweepRow);
    const pr = row(w);
    this.track(
      button(
        pr,
        'Invertir espectro',
        () => (s().pw.invert = !s().pw.invert),
        () => s().pw.invert,
      ),
    );
    this.track(
      slider(
        w,
        {
          label: 'Volumen',
          min: 0,
          max: 1,
          step: 0.05,
          get: () => s().audio.volume,
          set: (v) => s().audio.setVolume(v),
          format: (v) => `${(v * 100).toFixed(0)} %`,
        },
        ch,
      ),
    );
    help(
      w,
      'Clic en la imagen coloca la puerta. La corrección angular solo cambia la velocidad rotulada; la línea de base solo la presentación; el filtro de pared elimina frecuencias bajas de la señal.',
    );
  }

  // --- Medir ------------------------------------------------------------------
  private buildMeasure(p: HTMLElement): void {
    this.captureCard = document.createElement('div');
    this.captureCard.className = 'section';
    p.appendChild(this.captureCard);
    this.measureBody = document.createElement('div');
    this.measureBody.className = 'tab-panel';
    p.appendChild(this.measureBody);

    const proto = this.section(this.measureBody, 'Protocolo VExUS');
    const rowsHost = document.createElement('div');
    proto.appendChild(rowsHost);
    const protoRow = (label: string, tool: MeasureTool, value: () => string) => {
      const r = document.createElement('div');
      r.className = 'control';
      const b = document.createElement('button');
      b.textContent = label;
      b.style.fontSize = '11px';
      b.addEventListener('click', () => this.armTool(tool));
      const v = document.createElement('output');
      v.style.gridColumn = 'span 2';
      r.append(b, v);
      rowsHost.appendChild(r);
      this.track({ sync: () => (v.textContent = value()) });
    };
    protoRow('VCI diámetro', 'caliper', () => (this.ivcCaliperMm !== null ? `${this.ivcCaliperMm.toFixed(1)} mm` : '—'));
    protoRow('Suprahepática', 'hepatic', () => (this.lastHepatic ? `${patternText(this.lastHepatic.pattern)}` : '—'));
    protoRow('Porta PF', 'portal', () =>
      this.lastPortal
        ? Number.isFinite(this.lastPortal.pulsatilityFraction)
          ? `${this.lastPortal.pulsatilityFraction.toFixed(0)} %`
          : 'no aplicable'
        : '—',
    );
    protoRow('Renal', 'renal', () => (this.lastRenal ? renalText(this.lastRenal.pattern) : '—'));
    help(
      proto,
      'Suprahepática, porta y vena interlobar se miden sobre el espectro PW adquirido (últimos 7 s, ventanas S/D ancladas al ECG). La VCI con el calibrador sobre la imagen.',
    );

    const tools = this.section(this.measureBody, 'Herramientas libres');
    const grid = document.createElement('div');
    grid.className = 'tool-grid';
    tools.appendChild(grid);
    const tb = (label: string, tool: MeasureTool): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => this.armTool(tool));
      grid.appendChild(b);
      this.track({ sync: () => b.classList.toggle('on', this.store.get().tool === tool) });
      return b;
    };
    tb('—', 'none');
    tb('Caliper', 'caliper');
    tb('Borrar', 'none').addEventListener('click', () => this.clearMeasurements());

    const res = this.section(this.measureBody, 'Resultado');
    this.resultEl = document.createElement('div');
    this.resultEl.className = 'result';
    res.appendChild(this.resultEl);
    this.renderResult();
  }

  private armTool(tool: MeasureTool): void {
    if (tool === 'hepatic' || tool === 'portal' || tool === 'renal') {
      if (!this.sim().pw.enabled) this.store.set({ mode: 'pw' });
      this.store.set({ tool });
      this.renderCapture();
      return;
    }
    this.store.set({ tool });
    this.renderCapture();
  }

  private renderCapture(): void {
    const tool = this.store.get().tool;
    this.captureCard.innerHTML = '';
    if (tool === 'none') return;
    const title = document.createElement('h4');
    title.textContent =
      tool === 'caliper'
        ? 'Calibrador'
        : tool === 'hepatic'
          ? 'Medir suprahepática'
          : tool === 'portal'
            ? 'Medir porta'
            : 'Medir vena interlobar';
    const text = document.createElement('div');
    text.className = 'help';
    text.textContent =
      tool === 'caliper'
        ? 'Haz clic en dos puntos de la imagen (borde a borde de la VCI, perpendicular al eje). Esc cancela.'
        : 'Coloca la puerta en el vaso, espera 4–5 latidos estables y pulsa «Capturar». Se mide sobre el espectro adquirido.';
    this.captureCard.append(title, text);
    const r = row(this.captureCard);
    if (tool !== 'caliper') button(r, 'Capturar', () => this.capture(tool));
    button(r, 'Cancelar (Esc)', () => this.store.set({ tool: 'none' }));
  }

  /** Captura la medición armada sobre el espectro adquirido. */
  capture(kind: MeasureTool): void {
    const sim = this.sim();
    const tNow = sim.physiology.clock.t;
    const beats = sim.physiology.rhythm.beatsAround(tNow - 3).filter((b) => b.tR > tNow - 7 && b.tR + b.rr < tNow);
    const opts = {
      f0Hz: sim.transducer.f0Doppler,
      angleCorrectionRad: sim.pw.angleCorrection,
      invert: sim.pw.invert,
      fftSize: sim.spectral.fftSize,
    };
    const recent = sim.spectral.columns.filter((c) => c.t > tNow - 7);
    if (kind === 'hepatic') this.lastHepatic = measureObservedHepatic(recent, beats, opts);
    else if (kind === 'portal') this.lastPortal = measureObservedPortal(recent, beats, opts);
    else if (kind === 'renal') this.lastRenal = measureObservedRenal(recent, beats, opts);
    this.store.set({ tool: 'none' });
    this.renderResult();
  }

  renderResult(): void {
    if (!this.resultEl) return;
    const h = this.lastHepatic;
    const p = this.lastPortal;
    const k = this.lastRenal;
    const res: VexusResult = classifyVexusC({
      ivcMaxDiameterMm: this.ivcCaliperMm,
      hepatic: h ? h.pattern : 'not-assessed',
      portalPulsatilityFraction: p ? p.pulsatilityFraction : null,
      renal: k ? k.pattern : 'not-assessed',
    });
    const n = (h ? 1 : 0) + (p ? 1 : 0) + (k ? 1 : 0) + (this.ivcCaliperMm !== null ? 1 : 0);
    this.badge.textContent = String(n);
    this.badge.style.display = n ? '' : 'none';
    const gradeTxt =
      res.grade !== null ? `VExUS ${res.grade}` : res.gradeRange ? `VExUS ${res.gradeRange[0]}–${res.gradeRange[1]}` : 'VExUS —';
    const lines = [
      `<div class="grade">${gradeTxt} <span class="small">${statusText(res.status)}</span></div>`,
      `<div>VCI: ${this.ivcCaliperMm !== null ? this.ivcCaliperMm.toFixed(1) + ' mm' : '—'} ${res.ivcDilated === null ? '' : res.ivcDilated ? '<span class="small">(≥ 20 mm: dilatada)</span>' : '<span class="small">(< 20 mm)</span>'}</div>`,
      h
        ? `<div>VSH: S ${h.sPeak.toFixed(1)} · D ${h.dPeak.toFixed(1)} · A ${h.aPeak.toFixed(1)} cm/s → <b>${patternText(h.pattern)}</b> <span class="small">(${h.beats} latidos)</span></div>`
        : '<div>VSH: —</div>',
      p
        ? `<div>Porta: ${p.vMax.toFixed(1)}/${p.vMin.toFixed(1)} cm/s → PF <b>${Number.isFinite(p.pulsatilityFraction) ? p.pulsatilityFraction.toFixed(0) + ' %' : 'n/a'}</b> <span class="small">(${res.portalClass}${res.portalNearThreshold ? ', próximo al umbral' : ''})</span></div>`
        : '<div>Porta: —</div>',
      k
        ? `<div>Renal: S ${k.sPeak.toFixed(1)} · D ${k.dPeak.toFixed(1)} · mín ${k.vMin.toFixed(1)} cm/s → <b>${renalText(k.pattern)}</b> <span class="small">(${k.beats} latidos)</span></div>`
        : '<div class="small">Renal: no evaluado; el clasificador devuelve el intervalo compatible.</div>',
    ];
    this.resultEl.innerHTML = lines.join(''); // texto generado por el programa a partir de números
    this.sync();
  }

  // --- Docente -----------------------------------------------------------------
  private buildTeacher(p: HTMLElement): void {
    const sec = this.section(p, 'Verdad fisiológica y adquisición');
    help(sec, 'Se oculta al alumno. La verdad del caso y lo adquirido se calculan por separado.');
    this.debugEl = document.createElement('div');
    this.debugEl.className = 'debug';
    sec.appendChild(this.debugEl);
  }

  renderDebug(): void {
    if (!this.store.get().debug || this.store.get().tab !== 'docente') return;
    const sim = this.sim();
    const s = sim.sample;
    const t = sim.physiology.clock.t;
    let truth = 'VERDAD FISIOLÓGICA: acumulando historial…\n';
    if (t > 8) {
      try {
        const m = measurePhysiologyTruth(sim.physiology, { fromT: t - 6, toT: t });
        const g = classifyVexusC({
          ivcMaxDiameterMm: m.ivcMaxMm,
          hepatic: m.hepaticPattern,
          portalPulsatilityFraction: m.portalPF,
          renal: m.renalPattern,
        });
        truth =
          `VERDAD FISIOLÓGICA (últimos 6 s)\n` +
          `  VCI AP máx/mín ${m.ivcMaxMm.toFixed(1)}/${m.ivcMinMm.toFixed(1)} mm\n` +
          `  VSH S/D/A ${m.hvS.toFixed(1)}/${m.hvD.toFixed(1)}/${m.hvA.toFixed(1)} cm/s → ${patternText(m.hepaticPattern)}\n` +
          `  Porta ${m.pvMax.toFixed(1)}/${m.pvMin.toFixed(1)} cm/s → PF ${m.portalPF.toFixed(0)} %\n` +
          `  V. interlobar S/D/mín ${m.rvS.toFixed(1)}/${m.rvD.toFixed(1)}/${m.rvMin.toFixed(1)} cm/s → ${renalText(m.renalPattern)}\n` +
          `  Grado C de referencia: ${g.grade ?? (g.gradeRange ? g.gradeRange.join('–') : '—')}\n`;
      } catch {
        truth = 'VERDAD FISIOLÓGICA: —\n';
      }
    }
    const g = sim.gateInfo;
    const fd = sim.gateExpectedShiftHz();
    const comp = sim.sampleVolume.lastComposition;
    const gateTxt = sim.pw.enabled
      ? `PUERTA PW\n  vaso en el centro: ${g?.vessel ?? 'ninguno'} · ángulo haz–flujo ${g?.beamAngleToFlowDeg?.toFixed(0) ?? '—'}°\n` +
        `  transmisión ${g ? (20 * Math.log10(Math.max(1e-6, g.transmission))).toFixed(0) : '—'} dB · fD física en el centro ${fd !== null ? fd.toFixed(0) + ' Hz' : '—'}\n` +
        `  volumen: sangre ${(comp.bloodFraction * 100).toFixed(0)} % · arterial ${(comp.arterialFraction * 100).toFixed(0)} % · pared ${(comp.wallFraction * 100).toFixed(0)} %\n`
      : '';
    this.debugEl.textContent =
      `t ${t.toFixed(2)} s · latido ${s.beatIndex} · fase ${s.cardiacPhase.toFixed(2)} · resp ${s.resp.volume.toFixed(2)}\n` +
      `P_AD ${s.pRa.toFixed(1)} · P_VCI ${s.pIvc.toFixed(1)} (Ptm ${s.pIvcTransmural.toFixed(1)}) · P_hep ${s.pHepatic.toFixed(1)} · P_abd ${s.pAbd.toFixed(1)} mmHg\n` +
      `Q_hv ${s.qHepaticVein.toFixed(1)} · Q_pv ${s.qPortal.toFixed(1)} · Q_ha ${s.qHepaticArtery.toFixed(1)} mL/s · VCI AP/lat ${s.ivc.dApMm.toFixed(1)}/${s.ivc.dLatMm.toFixed(1)} mm\n` +
      `u VSH dcha ${(s.velocities.hvRight / 10).toFixed(1)} · porta ${(s.velocities.pvTrunk / 10).toFixed(1)} · VCI ${(s.velocities.ivcSupra / 10).toFixed(1)} · v. interlobar ${(s.velocities.interlobarVein2 / 10).toFixed(1)} cm/s\n` +
      gateTxt +
      truth;
  }
}

function statusText(s: VexusResult['status']): string {
  return s === 'complete' ? 'completo' : s === 'incomplete' ? 'incompleto' : 'VCI no medida';
}
function renalText(p: RenalPattern): string {
  return p === 'continuous'
    ? 'continuo'
    : p === 'biphasic'
      ? 'bifásico (S+D)'
      : p === 'monophasic'
        ? 'monofásico (solo D)'
        : p === 'reversal-out-of-scheme'
          ? 'fuera del esquema'
          : 'no evaluado';
}
function patternText(p: HepaticPattern): string {
  return p === 'normal' ? 'normal (S>D)' : p === 'mild' ? 'leve (S<D)' : p === 'severe' ? 'grave (S invertida)' : 'no evaluado';
}
function sizeBox(sim: Simulator, f: number): void {
  const c = sim.color;
  const cm = (c.theta0 + c.theta1) / 2;
  const hw = ((c.theta1 - c.theta0) / 2) * f;
  c.theta0 = cm - hw;
  c.theta1 = cm + hw;
  const rm = (c.r0 + c.r1) / 2;
  const hr = ((c.r1 - c.r0) / 2) * f;
  c.r0 = Math.max(5, rm - hr);
  c.r1 = Math.min(sim.bmode.depthMm, rm + hr);
}
