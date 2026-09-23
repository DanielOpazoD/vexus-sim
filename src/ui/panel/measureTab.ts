import type { AppState, MeasureTool } from '../../app/store';
import { CAPTURE_BEATS, qualityText, type QualityIssue } from '../../doppler/measureQuality';
import {
  measureObservedHepatic,
  measureObservedPortal,
  measureObservedRenal,
  type ObservedHepatic,
  type ObservedPortal,
  type ObservedRenal,
} from '../../doppler/spectralMeasure';
import { classifyVexusC, type VexusResult } from '../../vexus/classification';
import { button, help, row } from '../controls';
import type { PanelContext } from './context';
import { patternText, renalText, statusText } from './vexusText';

/**
 * Pestaña Medir: protocolo VExUS (calibrador de VCI, suprahepática, porta y vena
 * interlobar sobre el espectro adquirido), herramientas libres y resultado. Guarda
 * las mediciones adquiridas; `clearMeasurements` las borra al cambiar de caso
 * para no mezclar pacientes.
 */
export class MeasureTab {
  private captureCard!: HTMLElement;
  private measureBody!: HTMLElement;
  private resultEl!: HTMLElement;
  private lastHepatic: ObservedHepatic | null = null;
  private lastPortal: ObservedPortal | null = null;
  private lastRenal: ObservedRenal | null = null;
  private ivcCaliperMm: number | null = null;

  constructor(
    private readonly ctx: PanelContext,
    host: HTMLElement,
    private readonly badge: HTMLElement,
  ) {
    this.build(host);
  }

  applyStore(st: AppState): void {
    this.captureCard.style.display = st.tool === 'none' ? 'none' : '';
    this.measureBody.style.display = st.tool === 'none' ? '' : 'none';
  }

  /** Borra toda medición adquirida (cambio de caso o «Borrar»): nunca se mezclan pacientes. */
  clearMeasurements(): void {
    this.lastHepatic = null;
    this.lastPortal = null;
    this.lastRenal = null;
    this.ivcCaliperMm = null;
    this.ctx.sync();
    this.renderResult();
  }

  setIvcCaliper(mm: number | null): void {
    this.ivcCaliperMm = mm;
    this.renderResult();
  }

  private build(p: HTMLElement): void {
    this.captureCard = document.createElement('div');
    this.captureCard.className = 'section';
    p.appendChild(this.captureCard);
    this.measureBody = document.createElement('div');
    this.measureBody.className = 'tab-panel';
    p.appendChild(this.measureBody);

    const proto = this.ctx.section(this.measureBody, 'Protocolo VExUS');
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
      this.ctx.track({ sync: () => (v.textContent = value()) });
    };
    protoRow('VCI diámetro', 'caliper', () => (this.ivcCaliperMm !== null ? `${this.ivcCaliperMm.toFixed(1)} mm` : '—'));
    // una captura rechazada por la calidad no muestra patrón (el de un espectro de ruido es «grave»)
    const NOT_MEASURABLE = 'no medible';
    protoRow('Suprahepática', 'hepatic', () => {
      const h = this.lastHepatic;
      return h ? (h.quality.issue ? NOT_MEASURABLE : patternText(h.pattern)) : '—';
    });
    protoRow('Porta PF', 'portal', () => {
      const p = this.lastPortal;
      if (!p) return '—';
      if (p.quality.issue) return NOT_MEASURABLE;
      return Number.isFinite(p.pulsatilityFraction) ? `${p.pulsatilityFraction.toFixed(0)} %` : 'no aplicable';
    });
    protoRow('Renal', 'renal', () => {
      const k = this.lastRenal;
      return k ? (k.quality.issue ? NOT_MEASURABLE : renalText(k.pattern)) : '—';
    });
    help(
      proto,
      'Suprahepática, porta y vena interlobar se miden sobre el espectro PW adquirido (últimos 7 s, ventanas S/D ancladas al ECG). La VCI con el calibrador sobre la imagen.',
    );

    const tools = this.ctx.section(this.measureBody, 'Herramientas libres');
    const grid = document.createElement('div');
    grid.className = 'tool-grid';
    tools.appendChild(grid);
    const tb = (label: string, tool: MeasureTool): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => this.armTool(tool));
      grid.appendChild(b);
      this.ctx.track({ sync: () => b.classList.toggle('on', this.ctx.store.get().tool === tool) });
      return b;
    };
    tb('—', 'none');
    tb('Caliper', 'caliper');
    tb('Borrar', 'none').addEventListener('click', () => this.clearMeasurements());

    const res = this.ctx.section(this.measureBody, 'Resultado');
    this.resultEl = document.createElement('div');
    this.resultEl.className = 'result';
    res.appendChild(this.resultEl);
    this.renderResult();
  }

  private armTool(tool: MeasureTool): void {
    if (tool === 'hepatic' || tool === 'portal' || tool === 'renal') {
      if (!this.ctx.sim().pw.enabled) this.ctx.store.set({ mode: 'pw' });
      this.ctx.store.set({ tool });
      this.renderCapture();
      return;
    }
    this.ctx.store.set({ tool });
    this.renderCapture();
  }

  private renderCapture(): void {
    const tool = this.ctx.store.get().tool;
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
        : 'Coloca la puerta en el vaso, espera 4 latidos estables y pulsa «Capturar». Se mide sobre el espectro adquirido.';
    this.captureCard.append(title, text);
    const r = row(this.captureCard);
    if (tool !== 'caliper') button(r, 'Capturar', () => this.capture(tool));
    button(r, 'Cancelar (Esc)', () => this.ctx.store.set({ tool: 'none' }));
  }

  /** Captura la medición armada sobre el espectro adquirido. */
  capture(kind: MeasureTool): void {
    const sim = this.ctx.sim();
    const tNow = sim.physiology.clock.t;
    // los últimos latidos completos del espectro guardado (7 s), como captura un equipo
    const beats = sim.physiology.rhythm.beatsBetween(tNow - 7, tNow).slice(-CAPTURE_BEATS);
    const opts = {
      f0Hz: sim.transducer.f0Doppler,
      angleCorrectionRad: sim.pw.angleCorrection,
      invert: sim.pw.invert,
      fftSize: sim.spectral.fftSize,
      wallFilterHz: sim.pw.wallFilterHz,
    };
    const recent = sim.spectral.columns.filter((c) => c.t > tNow - 7);
    if (kind === 'hepatic') this.lastHepatic = measureObservedHepatic(recent, beats, opts);
    else if (kind === 'portal') this.lastPortal = measureObservedPortal(recent, beats, opts);
    else if (kind === 'renal') this.lastRenal = measureObservedRenal(recent, beats, opts);
    this.ctx.store.set({ tool: 'none' });
    this.renderResult();
  }

  renderResult(): void {
    if (!this.resultEl) return;
    // una captura sin calidad no entra en el grado («no medible» nunca es normal)
    const usable = <T extends { quality: { issue: unknown } }>(m: T | null) => (m && m.quality.issue === null ? m : null);
    const h = usable(this.lastHepatic);
    const p = usable(this.lastPortal);
    const k = usable(this.lastRenal);
    const res: VexusResult = classifyVexusC({
      ivcMaxDiameterMm: this.ivcCaliperMm,
      hepatic: h ? h.pattern : 'not-assessed',
      portalPulsatilityFraction: p ? p.pulsatilityFraction : null,
      renal: k ? k.pattern : 'not-assessed',
    });
    const rejected = (m: { quality: { issue: QualityIssue | null } } | null, name: string) =>
      m && m.quality.issue ? `<div>${name}: <b>${qualityText(m.quality.issue)}</b></div>` : null;
    const n = (h ? 1 : 0) + (p ? 1 : 0) + (k ? 1 : 0) + (this.ivcCaliperMm !== null ? 1 : 0);
    this.badge.textContent = String(n);
    this.badge.style.display = n ? '' : 'none';
    const gradeTxt =
      res.grade !== null ? `VExUS ${res.grade}` : res.gradeRange ? `VExUS ${res.gradeRange[0]}–${res.gradeRange[1]}` : 'VExUS —';
    const lines = [
      `<div class="grade">${gradeTxt} <span class="small">${statusText(res.status)}</span></div>`,
      `<div>VCI: ${this.ivcCaliperMm !== null ? this.ivcCaliperMm.toFixed(1) + ' mm' : '—'} ${res.ivcDilated === null ? '' : res.ivcDilated ? '<span class="small">(≥ 20 mm: dilatada)</span>' : '<span class="small">(< 20 mm)</span>'}</div>`,
      rejected(this.lastHepatic, 'VSH') ??
        (h
          ? `<div>VSH: S ${h.sPeak.toFixed(1)} · D ${h.dPeak.toFixed(1)} · A ${h.aPeak.toFixed(1)} cm/s → <b>${patternText(h.pattern)}</b> <span class="small">(${h.beats} latidos)</span></div>`
          : '<div>VSH: —</div>'),
      rejected(this.lastPortal, 'Porta') ??
        (p
          ? `<div>Porta: ${p.vMax.toFixed(1)}/${p.vMin.toFixed(1)} cm/s → PF <b>${Number.isFinite(p.pulsatilityFraction) ? p.pulsatilityFraction.toFixed(0) + ' %' : 'n/a'}</b> <span class="small">(${res.portalClass}${res.portalNearThreshold ? ', próximo al umbral' : ''})</span></div>`
          : '<div>Porta: —</div>'),
      rejected(this.lastRenal, 'Renal') ??
        (k
          ? `<div>Renal: S ${k.sPeak.toFixed(1)} · D ${k.dPeak.toFixed(1)} · mín ${k.vMin.toFixed(1)} cm/s → <b>${renalText(k.pattern)}</b> <span class="small">(${k.beats} latidos)</span></div>`
          : '<div class="small">Renal: no evaluado; el clasificador devuelve el intervalo compatible.</div>'),
    ];
    this.resultEl.innerHTML = lines.join(''); // texto generado por el programa a partir de números
    this.ctx.sync();
  }
}
