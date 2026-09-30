import { caseVignette } from '../../app/blindMode';
import { errorLog } from '../../app/errorLog';
import { toggleMode } from '../../app/equipment';
import { ivcFromCalipers, ivcPixelInterval, ivcTruth, type IvcCollapse } from '../../vexus/ivcCollapse';
import type { MMark } from '../mModeView';
import type { AppState, MeasureTool } from '../../app/store';
import type { QualityIssue } from '../../doppler/measureQuality';
import type { ObservedHepatic, ObservedPortal, ObservedRenal } from '../../doppler/spectralMeasure';
import type * as SpectralMeasurements from '../../doppler/spectralMeasure';
import { classifyModifiedVexus, classifyVexusC, type Territory, type VexusContext, type VexusResult } from '../../vexus/classification';
import { button, note, row } from '../controls';
import type { PanelContext } from './context';
import {
  CONTEXT_FLAGS,
  CONTEXT_LABELS,
  contextResultLines,
  excludedTerritories,
  gradeValueText,
  patternText,
  portalText,
  renalText,
  resultStatusText,
  type ContextFlag,
} from './vexusText';

/**
 * Pestaña Medir: contexto clínico del caso (viñeta y confusores que marca el alumno, decisión 82), protocolo VExUS
 * (calibrador de VCI, VCI en modo M, suprahepática, porta y vena interlobar sobre el espectro adquirido) y resultado.
 * Guarda las mediciones adquiridas; `clearMeasurements` las borra al cambiar de caso para no mezclar pacientes, y el
 * contexto marcado se borra con el caso. Con una medición armada, arriba aparece su tarjeta de captura.
 */
export class MeasureTab {
  #observations: typeof SpectralMeasurements | null = null;
  #observationLoad: Promise<void> | null = null;
  #loadFailed = false;
  #captureCard!: HTMLElement;
  #measureBody!: HTMLElement;
  #resultEl!: HTMLElement;
  /**
   * Resumen del grado para los lectores de pantalla (`aria-live`): cambia al medir o al marcar un confusor. Va en la
   * pestaña pero fuera del cuerpo de la medida: con el calibrador armado ese cuerpo está oculto y un cambio dentro de un
   * subárbol oculto no se anuncia. (Con el calibrador de ⌘/Ctrl desde otra pestaña, la pestaña entera está oculta: se ve
   * el contador de la pestaña.)
   */
  #liveEl!: HTMLElement;
  private lastHepatic: ObservedHepatic | null = null;
  private lastPortal: ObservedPortal | null = null;
  private lastRenal: ObservedRenal | null = null;
  #ivcCaliperMm: number | null = null;
  /** VCI en modo M (decisión 80): los puntos de los calibres y el resultado con la verdad de su ventana. */
  #mPoints: MMark[] = [];
  #ivcM: (IvcCollapse & { truth: IvcCollapse | null; pixels: [number, number] }) | null = null;
  /** Confusores marcados por el alumno (decisión 82): empiezan sin marcar y se borran al cambiar de caso. */
  #context: VexusContext = {};
  /** Caso de la viñeta y del contexto marcado. */
  #caseId = '';
  #vignetteEl!: HTMLElement;

  readonly #ctx: PanelContext;
  readonly #badge: HTMLElement;

  constructor(ctx: PanelContext, host: HTMLElement, badge: HTMLElement) {
    this.#ctx = ctx;
    this.#badge = badge;
    this.#build(host);
  }

  /** Con una medición armada solo se ve su tarjeta de captura; sin ella, el protocolo y el resultado. */
  applyStore(st: AppState): void {
    this.#captureCard.hidden = st.tool === 'none';
    this.#measureBody.hidden = st.tool !== 'none';
    // calibres del modo M a medio poner: se descartan al cancelar la herramienta
    if (st.tool !== 'mmode' && this.#mPoints.length < 4) this.#mPoints = [];
  }

  /**
   * Borra toda medición adquirida (cambio de caso, intervención docente o «Borrar»): nunca se mezclan pacientes ni el
   * antes y el después de una intervención. Devuelve si había alguna.
   */
  clearMeasurements(): boolean {
    const had =
      this.lastHepatic !== null ||
      this.lastPortal !== null ||
      this.lastRenal !== null ||
      this.#ivcCaliperMm !== null ||
      this.#ivcM !== null ||
      this.#mPoints.length > 0;
    this.lastHepatic = null;
    this.lastPortal = null;
    this.lastRenal = null;
    this.#ivcCaliperMm = null;
    this.#ivcM = null;
    this.#mPoints = [];
    this.#ctx.sync();
    this.renderResult();
    return had;
  }

  /**
   * El simulador cambió (caso nuevo o «Reiniciar paciente»): se borran las mediciones; con otro caso, además, el
   * contexto marcado y la viñeta pasan a los suyos. Reiniciar el mismo paciente o intervenir no cambia su historia: lo
   * marcado sigue.
   */
  onSimulatorChanged(): void {
    const id = this.#ctx.sim().patient.id;
    if (id !== this.#caseId) {
      this.#caseId = id;
      this.#context = {};
      this.#vignetteEl.textContent = caseVignette(id);
    }
    this.clearMeasurements(); // sincroniza las casillas y vuelve a pintar el resultado
  }

  setIvcCaliper(mm: number | null): void {
    this.#ivcCaliperMm = mm;
    this.renderResult();
  }

  /** Calibres del modo M a la vista en la franja (los del último resultado o los que se están poniendo). */
  get mMarks(): readonly MMark[] {
    return this.#mPoints;
  }

  /**
   * Un punto sobre la franja M con la herramienta «VCI modo M» (decisión 80). Cada calibre son dos puntos en el
   * mismo instante (una vertical: pared anterior y posterior); un calibre de menos de 1 mm (dos clics en el mismo
   * sitio) se descarta. Con dos calibres se calcula la colapsabilidad y se compara con la verdad del motor en la
   * ventana que muestra la franja.
   */
  addMPoint(p: MMark, window: [number, number]): void {
    if (this.#ctx.store.get().tool !== 'mmode') return;
    const pts = this.#mPoints.length >= 4 ? [] : this.#mPoints;
    const k = pts.length;
    pts.push(k % 2 ? { ...p, t: pts[k - 1].t } : p);
    const d = (i: number) => Math.abs(pts[i + 1].r - pts[i].r);
    if (k % 2 && d(k - 1) < 1) pts.length = k - 1;
    this.#mPoints = pts;
    if (pts.length === 4) {
      const truth = ivcTruth(this.#ctx.sim().physiology.samples, window[0], window[1]);
      const measured = ivcFromCalipers(d(0), d(2));
      this.#ivcM = {
        ...measured,
        truth,
        pixels: ivcPixelInterval(measured.maxMm, measured.minMm, Math.max(...pts.map((p) => p.pixelMm ?? 0))),
      };
      this.#ctx.store.set({ tool: 'none' });
      this.renderResult();
    } else this.#renderCapture();
  }

  #build(p: HTMLElement): void {
    this.#captureCard = document.createElement('div');
    this.#captureCard.className = 'callout';
    p.appendChild(this.#captureCard);
    this.#liveEl = document.createElement('div');
    this.#liveEl.className = 'sr-only';
    this.#liveEl.setAttribute('aria-live', 'polite');
    p.appendChild(this.#liveEl);
    this.#measureBody = document.createElement('div');
    p.appendChild(this.#measureBody);

    this.#buildContext(this.#measureBody);
    const proto = this.#ctx.section(this.#measureBody, 'Protocolo VExUS', {
      info: 'Suprahepática, porta y vena interlobar se miden sobre el espectro PW adquirido (últimos 7 s, ventanas S/D ancladas al ECG); la VCI, con el calibrador sobre la imagen. Pulsa una fila para medirla.',
    });
    // una fila por medición: el botón la arma y la salida muestra el valor
    const protoRow = (label: string, tool: MeasureTool, value: () => string) => {
      const r = document.createElement('div');
      r.className = 'control proto';
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => this.#armTool(tool));
      const v = document.createElement('output');
      r.append(b, v);
      proto.appendChild(r);
      this.#ctx.track({ sync: () => (v.textContent = value()) });
    };
    protoRow('VCI diámetro', 'caliper', () => (this.#ivcCaliperMm !== null ? `${this.#ivcCaliperMm.toFixed(1)} mm` : '—'));
    protoRow('VCI modo M', 'mmode', () => (this.#ivcM ? `${this.#ivcM.ciPct.toFixed(0)} %` : '—'));
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

    const res = this.#ctx.section(this.#measureBody, 'Resultado');
    this.#resultEl = document.createElement('div');
    this.#resultEl.className = 'result';
    res.appendChild(this.#resultEl);
    // el calibrador libre era la misma herramienta que «VCI diámetro»: queda solo borrar
    button(row(res), 'Borrar mediciones', () => {
      this.#ctx.store.set({ tool: 'none' });
      this.clearMeasurements();
    });
    this.renderResult();
  }

  /**
   * «Contexto clínico» (decisión 82): la viñeta del caso, que ve también el alumno, y una casilla por confusor. Lo
   * marcado entra en el grado (`classifyVexusC` con el contexto): un territorio poco fiable cuenta como no evaluado y
   * el resultado dice por qué.
   */
  #buildContext(parent: HTMLElement): void {
    const sec = this.#ctx.section(parent, 'Contexto clínico', {
      info:
        'Lo que sabes del paciente antes de medir. Marca los confusores que tenga: cada uno quita solo el hallazgo que ' +
        'puede falsear, que cuenta como no evaluado (el grado pasa a intervalo): la ERC avanzada o la diálisis un riñón ' +
        'grave, el deportista una porta grave, y la cirrosis la porta siempre y la suprahepática si no está invertida. La ' +
        'FA, la falta de ECG y la ventilación con presión positiva solo avisan; con la presión intraabdominal alta una ' +
        'VCI < 20 mm no cierra el grado en 0. El mVExUS es el grado sin el riñón (Martin 2025).',
    });
    this.#caseId = this.#ctx.sim().patient.id;
    this.#vignetteEl = document.createElement('p');
    this.#vignetteEl.className = 'vignette';
    this.#vignetteEl.textContent = caseVignette(this.#caseId);
    sec.appendChild(this.#vignetteEl);
    const group = document.createElement('fieldset');
    group.className = 'checks';
    const legend = document.createElement('legend');
    legend.textContent = 'Confusores del paciente';
    group.appendChild(legend);
    for (const flag of CONTEXT_FLAGS) {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.addEventListener('change', () => this.#setContextFlag(flag, box.checked));
      label.append(box, document.createTextNode(CONTEXT_LABELS[flag]));
      group.appendChild(label);
      this.#ctx.track({ sync: () => (box.checked = this.#context[flag] === true) });
    }
    sec.appendChild(group);
  }

  #setContextFlag(flag: ContextFlag, on: boolean): void {
    const next = { ...this.#context };
    if (on) next[flag] = true;
    else delete next[flag];
    this.#context = next;
    this.renderResult();
  }

  #armTool(tool: MeasureTool): void {
    if (tool === 'hepatic' || tool === 'portal' || tool === 'renal') {
      this.#loadObservations();
      // abre el PW conservando el color si estaba encendido (tríplex, decisión 66)
      if (!this.#ctx.sim().pw.enabled) this.#ctx.store.set({ mode: toggleMode(this.#ctx.store.get().mode, 'pw') });
      this.#ctx.store.set({ tool });
      this.#renderCapture();
      return;
    }
    if (tool === 'mmode') {
      this.#mPoints = [];
      this.#ctx.store.set({ mode: 'M' });
    }
    this.#ctx.store.set({ tool });
    this.#renderCapture();
  }

  #renderCapture(): void {
    const tool = this.#ctx.store.get().tool;
    this.#captureCard.innerHTML = '';
    if (tool === 'none') return;
    const title = document.createElement('h3');
    title.textContent =
      tool === 'caliper'
        ? 'Calibrador'
        : tool === 'mmode'
          ? 'VCI en modo M'
          : tool === 'hepatic'
            ? 'Medir suprahepática'
            : tool === 'portal'
              ? 'Medir porta'
              : 'Medir vena interlobar';
    this.#captureCard.appendChild(title);
    note(
      this.#captureCard,
      tool === 'caliper'
        ? 'VCI: marca ambas paredes perpendicular al eje. Esc cancela.'
        : tool === 'mmode'
          ? `Espacio congela. VCI M: paredes máx./mín. Calibre ${(this.#mPoints.length >> 1) + 1}/2, punto ${(this.#mPoints.length % 2) + 1}/2.`
          : 'Puerta en el vaso: espera 4 latidos estables y pulsa «Capturar». Se mide el espectro adquirido.',
    );
    const r = row(this.#captureCard);
    if (tool !== 'caliper' && tool !== 'mmode') {
      const b = button(r, '', () => this.capture(tool)).el;
      b.classList.add('primary');
      this.#updateCaptureButton(b);
    }
    button(r, 'Cancelar (Esc)', () => this.#ctx.store.set({ tool: 'none' }));
  }

  #updateCaptureButton(b: HTMLButtonElement): void {
    b.textContent = this.#observations ? 'Capturar' : 'Preparando medición…';
    b.disabled = !this.#observations;
    if (this.#loadFailed)
      note(this.#captureCard, 'No se pudo preparar la medición. Revisa la conexión y recarga.').setAttribute('role', 'alert');
  }

  /** Se prepara al armar PW; la captura sigue siendo síncrona sobre el espectro del clic, sin carrera de paciente/equipo. */
  #loadObservations(): void {
    if (this.#observationLoad) return;
    this.#observationLoad = import('../../doppler/spectralMeasure')
      .then((m) => {
        this.#observations = m;
      })
      .catch((e: unknown) => {
        this.#loadFailed = true;
        errorLog.report('ui', e);
      })
      .finally(() => {
        const tool = this.#ctx.store.get().tool;
        if (tool !== 'hepatic' && tool !== 'portal' && tool !== 'renal') return;
        // Actualizar en sitio: Cancelar puede tener el foco y la herramienta pudo cambiar durante la descarga.
        const b = this.#captureCard.querySelector<HTMLButtonElement>('button.primary');
        if (!b) return;
        this.#updateCaptureButton(b);
      });
  }

  /** Captura la medición armada sobre el espectro adquirido. */
  capture(kind: MeasureTool): void {
    if (!this.#observations) return;
    const { CAPTURE_BEATS, measureObservedHepatic, measureObservedPortal, measureObservedRenal } = this.#observations;
    const sim = this.#ctx.sim();
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
    this.#ctx.store.set({ tool: 'none' });
    this.renderResult();
  }

  renderResult(): void {
    if (!this.#resultEl) return;
    // una captura sin calidad no entra en el grado («no medible» nunca es normal)
    const usable = <T extends { quality: { issue: unknown } }>(m: T | null) => (m && m.quality.issue === null ? m : null);
    const h = usable(this.lastHepatic);
    const p = usable(this.lastPortal);
    const k = usable(this.lastRenal);
    // sin calibrador en la imagen, el diámetro máximo del modo M
    const ivcMax = this.#ivcCaliperMm ?? this.#ivcM?.maxMm ?? null;
    // el contexto marcado entra en el grado: un territorio poco fiable cuenta como no evaluado (decisión 82)
    const veins = {
      ivcMaxDiameterMm: ivcMax,
      hepatic: h ? h.pattern : 'not-assessed',
      portalPulsatilityFraction: p ? p.pulsatilityFraction : null,
    } as const;
    const res: VexusResult = classifyVexusC({ ...veins, renal: k ? k.pattern : 'not-assessed' }, this.#context);
    const modified = classifyModifiedVexus(veins, this.#context);
    const excluded = excludedTerritories(res);
    // una línea por territorio, marcada si el contexto la vuelve poco fiable
    const line = (t: Territory, inner: string) =>
      `<div>${inner}${excluded.has(t) ? ' <span class="small unreliable">· no fiable</span>' : ''}</div>`;
    const rejected = (m: { quality: { issue: QualityIssue | null } } | null, name: string) =>
      m && m.quality.issue ? `${name}: <b>${this.#observations!.qualityText(m.quality.issue)}</b>` : null;
    const n = (h ? 1 : 0) + (p ? 1 : 0) + (k ? 1 : 0) + (this.#ivcCaliperMm !== null ? 1 : 0) + (this.#ivcM ? 1 : 0);
    const mM = this.#ivcM;
    const mm = (v: number) => v.toFixed(1).replace('.', ',');
    // la verdad del motor, como las demás, solo con el modo docente
    const mTruth =
      mM?.truth && this.#ctx.store.get().debug
        ? ` <span class="small">(verdad ${mm(mM.truth.maxMm)}/${mm(mM.truth.minMm)} mm → ${mM.truth.ciPct.toFixed(0)} %)</span>`
        : '';
    this.#badge.textContent = String(n);
    this.#badge.hidden = n === 0;
    const lines = [
      `<div class="grade">VExUS ${gradeValueText(res)} <span class="small">${resultStatusText(res)}</span></div>`,
      `<div>VCI: ${ivcMax !== null ? ivcMax.toFixed(1) + ' mm' : '—'} ${res.ivcDilated === null ? '' : res.ivcDilated ? '<span class="small">(≥ 20 mm: dilatada)</span>' : '<span class="small">(< 20 mm)</span>'}</div>`,
      mM
        ? `<div>VCI modo M: máx ${mm(mM.maxMm)} · mín ${mm(mM.minMm)} mm → colapso <b>${mM.ciPct.toFixed(0)} %</b>${mTruth}<div class="small">Resolución: ${mM.pixels.map(mm).join('–')} %; excluye pared y error físico.</div></div>`
        : '',
      line(
        'hepatic',
        rejected(this.lastHepatic, 'VSH') ??
          (h
            ? `VSH: S ${h.sPeak.toFixed(1)} · D ${h.dPeak.toFixed(1)} · A ${h.aPeak.toFixed(1)} cm/s → <b>${patternText(h.pattern)}</b> <span class="small">(${h.beats} latidos)</span>`
            : 'VSH: —'),
      ),
      line(
        'portal',
        rejected(this.lastPortal, 'Porta') ??
          (p
            ? `Porta: ${p.vMax.toFixed(1)}/${p.vMin.toFixed(1)} cm/s → PF <b>${Number.isFinite(p.pulsatilityFraction) ? p.pulsatilityFraction.toFixed(0) + ' %' : 'n/a'}</b> <span class="small">(${portalText(res.portalClass)}${res.portalNearThreshold ? ', próximo al umbral' : ''})</span>`
            : 'Porta: —'),
      ),
      line(
        'renal',
        rejected(this.lastRenal, 'Renal') ??
          (k
            ? `Renal: S ${k.sPeak.toFixed(1)} · D ${k.dPeak.toFixed(1)} · mín ${k.vMin.toFixed(1)} cm/s → <b>${renalText(k.pattern)}</b> <span class="small">(${k.beats} latidos)</span>`
            : '<span class="small">Renal: no evaluado; el clasificador devuelve el intervalo compatible.</span>'),
      ),
      ...contextResultLines(res, modified),
    ];
    this.#resultEl.innerHTML = lines.join(''); // texto generado por el programa a partir de números
    // el lector de pantalla oye el grado nuevo al medir o al marcar un confusor, no cada repintado
    const summary = `VExUS ${gradeValueText(res)}, ${resultStatusText(res)}`;
    if (this.#liveEl.textContent !== summary) this.#liveEl.textContent = summary;
    this.#ctx.sync();
  }
}
