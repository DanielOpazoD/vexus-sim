import { congestionParameters, VENOUS_EXPERIMENT_FIELDS, type VenousExperimentParameters } from '../../app/venousExperiment';
import { button, row } from '../controls';

/** Scenario controls. Unsupported mechanisms stay explicit rather than changing a picture. */
export class VenousExperimentControls {
  readonly element = document.createElement('details');
  readonly status = document.createElement('small');
  readonly #enabled = document.createElement('input');
  readonly #fields = document.createElement('fieldset');
  readonly #progress = document.createElement('input');
  readonly #pathValue = document.createElement('output');
  readonly #inputs = new Map<string, { input: HTMLInputElement; value: HTMLOutputElement }>();
  #parameters = congestionParameters(0);
  #timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly changed: (p: VenousExperimentParameters | null) => void) {
    const summary = document.createElement('summary');
    summary.textContent = 'Laboratorio hemodinámico';
    this.element.className = 'venous-experiment';
    this.element.appendChild(summary);
    const label = document.createElement('label');
    this.#enabled.type = 'checkbox';
    label.append(this.#enabled, ' Explorar estados estables independientes');
    this.element.appendChild(label);
    this.#enabled.addEventListener('change', () => {
      this.#cancel();
      this.#fields.disabled = !this.#enabled.checked;
      this.status.textContent = this.#enabled.checked ? 'Calculando escenario…' : 'Experimento desactivado';
      this.changed(this.#enabled.checked ? { ...this.#parameters } : null);
    });
    const info = document.createElement('p');
    info.textContent =
      'Modelo simplificado: cada ajuste recalcula un estado estable. La transición clínica continua aún no está modelada. El paciente original se conserva. Compliance venosa: solo reservorios esplácnico/periférico, a PAD basal fija; no equivale a venodilatación.';
    this.element.appendChild(info);
    const progression = document.createElement('label');
    progression.textContent = 'Progresión de congestión · ajuste fino';
    this.#progress.type = 'range';
    this.#progress.min = '0';
    this.#progress.max = '1';
    this.#progress.step = '.001';
    this.#progress.value = '0';
    this.#progress.setAttribute('aria-label', 'Progresión de congestión');
    progression.append(this.#progress, this.#pathValue);
    this.#fields.appendChild(progression);
    const presets = row(this.#fields);
    for (const [name, value] of [
      ['Guía 0', 0],
      ['Guía 1', 0.4],
      ['Guía 2', 0.775],
      ['Guía 3', 1],
    ] as const)
      button(presets, name, () => {
        this.#progress.value = String(value);
        this.#setProgress();
        this.#apply();
      });
    this.#progress.addEventListener('input', () => {
      this.#setProgress();
      this.#schedule();
    });
    for (const field of VENOUS_EXPERIMENT_FIELDS) {
      const label = document.createElement('label'),
        input = document.createElement('input'),
        value = document.createElement('output');
      label.textContent = `${field.label} (${field.unit}) `;
      input.type = 'range';
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = 'any';
      input.setAttribute('aria-label', field.label);
      label.append(input, value);
      this.#fields.appendChild(label);
      this.#inputs.set(field.key, { input, value });
      input.addEventListener('input', () => {
        this.#parameters[field.key] = Number(input.value);
        this.#pathValue.value = 'Personalizado';
        value.value = input.value;
        this.#schedule();
      });
    }
    this.element.append(this.#fields, this.status);
    const pending = document.createElement('p');
    pending.textContent =
      'Pendiente de mecanismos propios: taponamiento, distensibilidad sistémica venosa y distensibilidad diastólica del VD.';
    this.element.appendChild(pending);
    this.reset();
  }
  #setProgress(): void {
    this.#parameters = congestionParameters(Number(this.#progress.value));
    this.#pathValue.value = `${(100 * Number(this.#progress.value)).toFixed(1)} %`;
    this.#sync();
  }
  #sync(): void {
    for (const field of VENOUS_EXPERIMENT_FIELDS) {
      const { input, value } = this.#inputs.get(field.key)!;
      input.value = String(this.#parameters[field.key]);
      value.value = this.#parameters[field.key].toFixed(2);
    }
  }
  #cancel(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
  #schedule(): void {
    this.#cancel();
    this.status.textContent = 'Ajuste pendiente…';
    this.#timer = setTimeout(() => this.#apply(), 150);
  }
  #apply(): void {
    this.#cancel();
    if (this.#enabled.checked) {
      this.status.textContent = 'Calculando escenario…';
      this.changed({ ...this.#parameters });
    }
  }
  reset(): void {
    this.#cancel();
    this.#enabled.checked = false;
    this.#fields.disabled = true;
    this.#progress.value = '0';
    this.#pathValue.value = '0 %';
    this.#parameters = congestionParameters(0);
    this.#sync();
    this.status.textContent = 'El grado se calcula a partir de los observables; no se introduce en las ecuaciones.';
  }
}
