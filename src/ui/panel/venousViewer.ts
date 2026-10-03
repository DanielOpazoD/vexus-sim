import { venousComparisonTrace, type VenousComparisonPoint } from '../../physiology/venousComparison';
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
    description.id = controlId('referencia-fisiologica');
    d.setAttribute('aria-describedby', description.id);
    const controls = row(header);
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
    label.appendChild(scale);
    controls.appendChild(label);
    button(controls, 'Cerrar', () => d.close());
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
      const plot = svg('svg', {
        viewBox: '0 0 800 90',
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': `${r.label}, ${r.unit}, mismo eje temporal`,
      });
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
      this.#points = venousComparisonTrace(e.samples.filter((s) => s.t >= e.clock.t - 6)).points;
      this.#cursor.max = String(Math.max(0, this.#points.length - 1));
      this.#cursor.value = this.#cursor.max;
    }
    this.#draw();
  }

  #value(p: VenousComparisonPoint, row: number): number {
    return row < 3 ? p.meanVelocityCmS[row] : row === 3 ? p.ecgMv : p.inspiredFraction;
  }

  #x(t: number): number {
    const end = this.#points.at(-1)?.t ?? 0;
    return ((t - Math.max(0, end - 6)) / Math.min(6, Math.max(end, 0.004))) * 800;
  }

  #draw(): void {
    if (!this.#points.length) {
      this.#status.textContent = 'Acumulando historial…';
      return;
    }
    const a = this.#points[0],
      b = this.#points.at(-1)!;
    let clipped = false;
    for (let i = 0; i < 5; i++) {
      const scale = i < 3 ? this.#scale : i === 3 ? 2 : 1;
      let d = '',
        previous = -Infinity;
      for (const p of this.#points) {
        const value = this.#value(p, i);
        if (i < 3 && Math.abs(value) > scale) clipped = true;
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
    this.#cursor.setAttribute('aria-valuetext', `${p.t.toFixed(3)} segundos`);
    this.#readout.textContent = `t ${p.t.toFixed(3)} s · latido ${p.beatIndex} · PAD instantánea ${p.rightAtrialMmHg.toFixed(1)} mmHg · PIA instantánea ${p.abdominalMmHg.toFixed(1)} mmHg`;
  }
}
