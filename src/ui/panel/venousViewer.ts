import { VenousSpectralAcquisition, VENOUS_SPECTRAL_SCALES, VENOUS_FORWARD_SIGN } from '../../doppler/venousSpectral';
import type { CaptureMark } from '../../doppler/spectralMeasure';
import { captureProtocolVessel } from '../../doppler/capture';
import type { Beat } from '../../physiology/rhythm';
import type { PhysiologySample } from '../../physiology/engine';
import { drawVenousSpectrum } from '../venousSpectralPlot';
import { VENOUS_COMPARISON_CHANNELS, venousComparisonTrace, type VenousComparisonPoint } from '../../physiology/venousComparison';
import { button, controlId, note, row } from '../controls';
import type { PanelContext } from './context';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag: string, attrs: Record<string, string>) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

/** Vista docente observadora. Pausar esta ventana no pausa ni altera al paciente. */
export class VenousViewer {
  readonly dialog = document.createElement('dialog');
  readonly #ctx: PanelContext;
  readonly #cursor = document.createElement('input');
  readonly #status: HTMLElement;
  readonly #case: HTMLElement;
  readonly #readout: HTMLElement;
  readonly #paths: Element[] = [];
  readonly #markers: Element[] = [];
  readonly #values: HTMLElement[] = [];
  readonly #limits: HTMLElement[] = [];
  readonly #pause: HTMLButtonElement;
  #points: readonly VenousComparisonPoint[] = [];
  #paused = false;
  #scale = 60;
  #spectralMode = true;
  #annotations = false;
  #spectral: VenousSpectralAcquisition | null = null;
  #processedT = -Infinity;
  #rawSamples: readonly PhysiologySample[] = [];
  #beats: Beat[] = [];
  #spectralScales: number[] = [...VENOUS_SPECTRAL_SCALES];
  #canvases: HTMLCanvasElement[] = [];
  #paintKeys = ['', '', ''];
  #baselines = [0, 0, 0];
  #spectralControls: HTMLElement[] = [];
  #plots: Element[] = [];
  #marks: CaptureMark[][] = [[], [], []];
  #marksT = -Infinity;
  #measurementIssues = ['insuficiente', 'insuficiente', 'insuficiente'];
  readonly #description: HTMLElement;

  constructor(ctx: PanelContext, host: HTMLElement) {
    this.#ctx = ctx;
    const d = this.dialog;
    d.className = 'venous-viewer';
    const header = document.createElement('header');
    header.className = 'venous-header';
    d.appendChild(header);
    const heading = document.createElement('h2');
    heading.id = controlId('comparacion-venosa');
    heading.textContent = 'Comparación venosa';
    d.setAttribute('aria-labelledby', heading.id);
    header.appendChild(heading);
    this.#case = note(header);
    this.#case.className = 'venous-case';
    const description = note(
      header,
      'Referencia fisiológica · velocidad media Q/A, no espectro PW adquirido. Simultaneidad virtual docente.',
    );
    this.#description = description;
    description.id = controlId('referencia-fisiologica');
    d.setAttribute('aria-describedby', description.id);
    const controls = row(header);
    const mode = document.createElement('select');
    mode.setAttribute('aria-label', 'Tipo de visualización venosa');
    for (const [value, label] of [
      ['pw', 'Espectro PW'],
      ['reference', 'Referencia Q/A'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      mode.appendChild(option);
    }
    mode.addEventListener('change', () => {
      this.#spectralMode = mode.value === 'pw';
      this.#spectral = null;
      this.#processedT = -Infinity;
      this.#marksT = -Infinity;
      this.#marks = [[], [], []];
      this.update();
    });
    controls.appendChild(mode);
    const annotationLabel = document.createElement('label');
    const annotations = document.createElement('input');
    annotations.type = 'checkbox';
    annotations.addEventListener('change', () => {
      this.#annotations = annotations.checked;
      this.#marksT = -Infinity;
      this.#drawSpectra();
    });
    annotationLabel.append(annotations, ' Marcas A/S/D y máximos/mínimos');
    controls.appendChild(annotationLabel);
    this.#pause = button(controls, 'Pausar vista', () => {
      this.#paused = !this.#paused;
      this.#pause.textContent = this.#paused ? 'Reanudar vista' : 'Pausar vista';
      this.#cursor.disabled = !this.#paused;
      this.update();
    }).el;
    const label = document.createElement('label');
    label.textContent = 'Escala común ';
    const scale = document.createElement('select');
    scale.setAttribute('aria-label', 'Escala común de velocidad');
    for (const n of [20, 60, 120]) {
      const option = document.createElement('option');
      option.value = String(n);
      option.textContent = `±${n} cm/s`;
      scale.appendChild(option);
    }
    scale.value = '60';
    scale.addEventListener('change', () => {
      this.#scale = Number(scale.value);
      this.#draw();
    });
    label.className = 'venous-reference-scale';
    label.appendChild(scale);
    controls.appendChild(label);
    button(controls, 'Cerrar', () => {
      this.clear();
      d.close();
    });
    this.#status = note(header);
    this.#status.className = 'venous-status';
    const trace = venousComparisonTrace([]);
    const rows = [
      ...trace.channels.map((c) => ({ label: c.label, detail: `+ ${c.forward}`, unit: 'cm/s' })),
      { label: 'ECG', detail: 'Reloj cardíaco común', unit: 'mV' },
      { label: 'Respiración', detail: 'Fracción inspirada del modelo', unit: '0–1' },
    ];
    for (const [i, r] of rows.entries()) {
      const figure = document.createElement('figure');
      figure.className = i < 3 ? 'venous-row' : 'venous-row venous-marker-row';
      const caption = document.createElement('figcaption');
      const name = document.createElement('strong');
      name.textContent = r.label;
      const value = document.createElement('span');
      this.#values.push(value);
      caption.append(name, value);
      const detail = document.createElement('small');
      detail.textContent = r.detail;
      detail.className = 'venous-direction';
      const plot = svg('svg', {
        viewBox: '0 0 800 90',
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': `${r.label}, ${r.unit}, mismo eje temporal`,
      });
      this.#plots.push(plot);
      plot.appendChild(svg('path', { d: `M0 ${i === 4 ? 85 : 45}H800 M200 0V90 M400 0V90 M600 0V90`, class: 'venous-grid' }));
      const path = svg('path', { class: 'venous-wave', d: '' });
      const marker = svg('path', { class: 'venous-cursor', d: '' });
      this.#paths.push(path);
      this.#markers.push(marker);
      plot.append(path, marker);
      const limit = document.createElement('small');
      limit.className = 'venous-limits';
      this.#limits.push(limit);
      figure.append(caption, detail, plot, limit);
      if (i < 3) {
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 184;
        canvas.className = 'venous-spectrum';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `${r.label}: espectro Doppler pulsado simulado y reloj ECG compartido`);
        this.#canvases.push(canvas);
        figure.insertBefore(canvas, limit);
        const controls = row(figure);
        const scaleLabel = document.createElement('label');
        scaleLabel.textContent = 'Nyquist ';
        const selector = document.createElement('select');
        selector.setAttribute('aria-label', `Escala PW ${r.label}`);
        for (const n of [10, 20, 30, 40, 50, 60, 80, 120]) {
          const option = document.createElement('option');
          option.value = String(n);
          option.textContent = `±${n} cm/s`;
          selector.appendChild(option);
        }
        selector.value = String(this.#spectralScales[i]);
        selector.addEventListener('change', () => {
          this.#spectralScales[i] = Number(selector.value);
          this.#spectral = null;
          this.#processedT = -Infinity;
          this.#marksT = -Infinity;
          this.update();
        });
        scaleLabel.appendChild(selector);
        controls.appendChild(scaleLabel);
        const baselineLabel = document.createElement('label');
        baselineLabel.textContent = 'Línea de base ';
        const baseline = document.createElement('input');
        baseline.type = 'range';
        baseline.min = '-0.4';
        baseline.max = '0.4';
        baseline.step = '0.05';
        baseline.value = '0';
        baseline.setAttribute('aria-label', `Línea de base ${r.label}`);
        baseline.addEventListener('input', () => {
          this.#baselines[i] = Number(baseline.value);
          this.#drawSpectra();
        });
        baselineLabel.appendChild(baseline);
        controls.appendChild(baselineLabel);
        this.#spectralControls.push(controls);
      }
      d.appendChild(figure);
    }
    const cursorLabel = document.createElement('label');
    cursorLabel.textContent = 'Cursor sincronizado (pausa la vista para explorar)';
    this.#cursor.type = 'range';
    this.#cursor.min = '0';
    this.#cursor.max = '0';
    this.#cursor.step = '1';
    this.#cursor.disabled = true;
    this.#cursor.setAttribute('aria-label', 'Cursor sincronizado');
    this.#cursor.addEventListener('input', () => this.#showCursor());
    cursorLabel.appendChild(this.#cursor);
    d.appendChild(cursorLabel);
    this.#readout = note(d);
    this.#readout.className = 'venous-readout';
    note(
      d,
      'Modelo en desarrollo: taponamiento y compliance diastólica VD aún no implementados. Esta vista no cambia la congelación del paciente.',
    );
    // El modal nativo maneja foco y Escape. Sus teclas no disparan atajos del ecógrafo de fondo.
    d.addEventListener('keydown', (e) => e.stopPropagation());
    d.addEventListener('cancel', () => this.clear());
    d.addEventListener('close', () => this.clear());
    host.appendChild(d);
  }

  open(): void {
    if (!this.#ctx.store.get().debug || this.dialog.open) return;
    this.clear();
    this.dialog.showModal();
    this.dialog.scrollTop = 0;
    this.update();
  }

  clear(): void {
    this.#points = [];
    this.#paintKeys = ['', '', ''];
    this.#rawSamples = [];
    this.#beats = [];
    this.#spectral = null;
    this.#processedT = -Infinity;
    this.#marksT = -Infinity;
    this.#marks = [[], [], []];
    for (const canvas of this.#canvases) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.dataset.columns = '0';
      canvas.dataset.marks = '';
      canvas.dataset.lastTime = '';
    }
    this.#paused = false;
    this.#pause.textContent = 'Pausar vista';
    this.#cursor.disabled = true;
    this.#cursor.max = '0';
    this.#cursor.value = '0';
    for (const p of [...this.#paths, ...this.#markers]) p.setAttribute('d', '');
    for (const el of [...this.#values, ...this.#limits, this.#status, this.#readout, this.#case]) el.textContent = '';
  }

  update(): void {
    if (!this.#ctx.store.get().debug) {
      this.dialog.close();
      this.clear();
      return;
    }
    if (!this.dialog.open) return;
    this.#case.textContent = this.#ctx.sim().patient.label;
    if (!this.#paused) {
      const e = this.#ctx.sim().physiology;
      this.#beats = e.rhythm.beatsBetween(Math.max(0, e.clock.t - 7), e.clock.t);
      this.#rawSamples = e.samples.filter((s) => s.t >= e.clock.t - 6);
      this.#points = venousComparisonTrace(this.#rawSamples).points;
      this.#cursor.max = String(Math.max(0, this.#points.length - 1));
      this.#cursor.value = this.#cursor.max;
    }
    if (this.#spectralMode && this.#rawSamples.length) {
      if (!this.#spectral) {
        const sim = this.#ctx.sim();
        this.#spectral = new VenousSpectralAcquisition(sim.anatomy, this.#rawSamples[0], sim.patient.seed, sim.patient);
        this.#spectral.scales.splice(0, 3, ...this.#spectralScales);
      }
      // Bounded catch-up also works while the patient is frozen; never block on six seconds of IQ at once.
      const next = this.#rawSamples.filter((s) => s.t > this.#processedT).slice(0, 32);
      this.#spectral.push(next, this.#ctx.sim().physiology.clock.dt);
      if (next.length) this.#processedT = next.at(-1)!.t;
    }
    this.#draw();
  }

  #drawSpectra(): void {
    if (!this.#spectralMode || !this.#spectral || !this.#points.length) return;
    const end = this.#points.at(-1)!.t,
      start = Math.max(0, end - 6);
    if (this.#annotations && this.#processedT - this.#marksT >= 0.5) {
      const rhythm = { beatsBetween: (from: number, to: number) => this.#beats.filter((b) => b.tR >= from && b.tR + b.rr <= to) };
      const opts = { f0Hz: this.#spectral.f0Hz, angleCorrectionRad: 0, invert: false, fftSize: 128, wallFilterHz: 15, gainDb: 0 };
      this.#marks = VENOUS_COMPARISON_CHANNELS.map(({ id }, i) => {
        const m = captureProtocolVessel(
          id,
          this.#spectral!.chains[i].spectral.columns,
          rhythm,
          Math.min(end, this.#processedT),
          opts,
          this.#spectral!.gateTracks[i],
        );
        this.#measurementIssues[i] = m ? (m.quality.issue ?? '') : 'insuficiente';
        return m?.quality.issue === null ? m.marks : [];
      });
      this.#marksT = this.#processedT;
    }
    const cursor = this.#points[Number(this.#cursor.value)];
    for (let i = 0; i < 3; i++) {
      const columns = this.#spectral.chains[i].spectral.columns;
      const canvas = this.#canvases[i];
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(canvas.clientWidth || 800));
      const targetW = Math.round(width * ratio),
        targetH = Math.round(184 * ratio);
      if (canvas.width !== targetW) canvas.width = targetW;
      if (canvas.height !== targetH) canvas.height = targetH;
      const paintKey = `${targetW}/${targetH}/${this.#spectralScales[i]}/${this.#baselines[i]}/${end}/${columns.at(-1)?.t}/${this.#marksT}/${this.#annotations}/${this.#paused ? cursor?.t : ''}`;
      if (paintKey !== this.#paintKeys[i])
        drawVenousSpectrum(
          this.#canvases[i],
          columns,
          start,
          end,
          this.#spectralScales[i],
          this.#annotations ? this.#marks[i] : [],
          this.#paused ? (cursor?.t ?? null) : null,
          ratio,
          this.#baselines[i],
        );
      this.#paintKeys[i] = paintKey;
      this.#canvases[i].dataset.baseline = String(this.#baselines[i]);
      this.#canvases[i].dataset.columns = String(columns.length);
      this.#canvases[i].dataset.lastTime = String(columns.at(-1)?.t ?? '');
      this.#canvases[i].dataset.marks = this.#annotations ? this.#marks[i].map((m) => m.label).join(',') : '';
      this.#limits[i].textContent =
        `2,5 MHz · PRF ${columns.at(-1)?.prfHz.toFixed(0) ?? '—'} Hz · filtro 15 Hz · θ ${this.#spectral.gateInfo[i].beamAngleToFlowDeg?.toFixed(0) ?? '—'}° · velocidad axial · ${this.#spectralScales[i]} cm/s Nyquist${this.#annotations && this.#measurementIssues[i] ? ` · Marcas no disponibles: ${this.#measurementIssues[i]}` : ''}`;
      this.#values[i].textContent = 'PW simulado';
    }
  }

  #value(p: VenousComparisonPoint, row: number): number {
    return row < 3 ? p.meanVelocityCmS[row] : row === 3 ? p.ecgMv : p.inspiredFraction;
  }

  #x(t: number): number {
    const end = this.#points.at(-1)?.t ?? 0;
    return ((t - Math.max(0, end - 6)) / Math.min(6, Math.max(end, 0.004))) * 800;
  }

  #draw(): void {
    this.#description.textContent = this.#spectralMode
      ? 'PW simulado · IQ → filtro → espectro. Tres ventanas anatómicas virtuales: haz, puerta y atenuación del ecógrafo. Velocidad axial sin corrección angular. Sin validación clínica.'
      : 'Referencia fisiológica · velocidad media Q/A, no espectro PW adquirido. Simultaneidad virtual docente.';
    (this.dialog.querySelector('.venous-reference-scale') as HTMLElement).hidden = this.#spectralMode;
    this.dialog.classList.toggle('venous-pw-mode', this.#spectralMode);
    for (let i = 0; i < 3; i++) {
      this.#plots[i].setAttribute('style', this.#spectralMode ? 'display:none' : '');
      this.#canvases[i].hidden = !this.#spectralMode;
      this.#spectralControls[i].hidden = !this.#spectralMode;
      const detail = this.dialog.querySelectorAll('.venous-direction')[i];
      detail.textContent = `${this.#spectralMode && VENOUS_FORWARD_SIGN[i] < 0 ? '−' : '+'} ${VENOUS_COMPARISON_CHANNELS[i].forward}${this.#spectralMode ? ' · orientación virtual' : ''}`;
    }
    if (!this.#points.length) {
      this.#status.textContent = 'Acumulando historial…';
      return;
    }
    const a = this.#points[0],
      b = this.#points.at(-1)!;
    let clipped = false;
    for (let i = 0; i < 5; i++) {
      if (i < 3 && this.#spectralMode) continue;
      const scale = i < 3 ? this.#scale : i === 3 ? 2 : 1;
      let d = '',
        previous = -Infinity;
      for (const p of this.#points) {
        const value = this.#value(p, i);
        if (!this.#spectralMode && i < 3 && Math.abs(value) > scale) clipped = true;
        const y = i === 4 ? 85 - value * 80 : 45 - (value / scale) * 40;
        // No conectar huecos de adquisición como si fueran datos continuos.
        d += `${p.t - previous > 0.0081 ? 'M' : 'L'}${this.#x(p.t).toFixed(1)},${y.toFixed(1)}`;
        previous = p.t;
      }
      this.#paths[i].setAttribute('d', d);
      this.#limits[i].textContent =
        i < 3 ? `+${scale} / 0 / −${scale} cm/s` : i === 3 ? '+2 / 0 / −2 mV' : '0 = espiración · 1 = inspiración';
    }
    this.#status.textContent = `${this.#paused ? 'Vista pausada (solo esta ventana)' : this.#ctx.sim().frozen ? 'Paciente congelado' : 'En vivo'} · ${a.t.toFixed(2)}–${b.t.toFixed(2)} s · ${b.respiratoryCycling ? 'Respiración activa' : 'Respiración sin ciclo'}${clipped ? ' · Hay valores fuera de escala: amplía el rango' : ''}`;
    if (this.#spectralMode && b.t - this.#processedT > 0.2) this.#status.textContent += ' · Reconstruyendo señal IQ…';
    this.#showCursor();
  }

  #showCursor(): void {
    const p = this.#points[Number(this.#cursor.value)];
    if (!p) return;
    const x = this.#x(p.t).toFixed(1);
    for (let i = 0; i < 5; i++) {
      this.#markers[i].setAttribute('d', `M${x} 0V90`);
      this.#values[i].textContent = `${this.#value(p, i).toFixed(2)} ${i < 3 ? 'cm/s' : i === 3 ? 'mV' : ''}`;
    }
    this.#drawSpectra();
    this.#cursor.setAttribute('aria-valuetext', `${p.t.toFixed(3)} segundos`);
    this.#readout.textContent = `t ${p.t.toFixed(3)} s · latido ${p.beatIndex} · PAD instantánea ${p.rightAtrialMmHg.toFixed(1)} mmHg · PIA instantánea ${p.abdominalMmHg.toFixed(1)} mmHg`;
  }
}
