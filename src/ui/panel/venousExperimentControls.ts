import { errorLog, errorMessage } from '../../app/errorLog';
import { decodeVenousParameters, encodeVenousParameters, VENOUS_PARAMETER_FILE_BYTES } from '../../app/venousParameterFile';
import { congestionParameters, VENOUS_EXPERIMENT_FIELDS, type VenousExperimentParameters } from '../../app/venousExperiment';
import { button, controlId, row } from '../controls';

/** Scenario controls. Unsupported mechanisms stay explicit rather than changing a picture. */
export class VenousExperimentControls {
  readonly element = document.createElement('details');
  readonly status = document.createElement('small');
  readonly #enabled = document.createElement('input');
  readonly #file = document.createElement('input');
  readonly #fields = document.createElement('fieldset');
  readonly #progress = document.createElement('input');
  readonly #pathValue = document.createElement('output');
  readonly #inputs = new Map<string, { input: HTMLInputElement; value: HTMLOutputElement }>();
  #parameters = congestionParameters(0);
  #revision = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly changed: (p: VenousExperimentParameters | null) => void) {
    this.status.id = controlId('estado-laboratorio-venoso');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-label', 'Estado del laboratorio venoso');
    const summary = document.createElement('summary');
    summary.textContent = 'Laboratorio hemodinámico';
    this.element.className = 'venous-experiment';
    this.element.appendChild(summary);
    const label = document.createElement('label');
    this.#enabled.type = 'checkbox';
    label.append(this.#enabled, ' Explorar estados estables independientes');
    this.element.appendChild(label);
    this.#enabled.addEventListener('change', () => {
      this.#nextEdit();
      this.#cancel();
      this.#fields.disabled = !this.#enabled.checked;
      this.status.textContent = this.#enabled.checked ? 'Calculando escenario…' : 'Experimento desactivado';
      this.changed(this.#enabled.checked ? { ...this.#parameters } : null);
    });
    const info = document.createElement('p');
    info.textContent =
      'Modelo simplificado: cada ajuste recalcula un estado estable. La transición clínica continua aún no está modelada. El paciente original se conserva. FC: ritmo sinusal del modelo; no simula estimulación ni respuesta autonómica. Compliance venosa: solo reservorios esplácnico/periférico, a PAD basal fija; no equivale a venodilatación. Las guías conservan FC y compliance venosa; no fijan el grado.';
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
        this.#nextEdit();
        this.#parameters[field.key] = Number(input.value);
        this.#pathValue.value = 'Personalizado';
        value.value = input.value;
        this.#schedule();
      });
    }
    this.element.append(this.#fields, this.status);
    const files = row(this.element);
    button(files, 'Guardar parámetros', () => {
      const a = document.createElement('a');
      const url = URL.createObjectURL(new Blob([encodeVenousParameters(this.#parameters)], { type: 'application/json' }));
      a.href = url;
      a.download = 'vexus-parametros-venosos.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const fileLabel = document.createElement('label');
    fileLabel.textContent = 'Importar parámetros ';
    const file = this.#file;
    file.type = 'file';
    file.accept = '.json,application/json';
    file.setAttribute('aria-label', 'Importar parámetros venosos');
    file.setAttribute('aria-describedby', this.status.id);
    fileLabel.appendChild(file);
    files.appendChild(fileLabel);
    file.addEventListener('change', () => {
      const selected = file.files?.[0];
      file.value = '';
      if (selected) void this.#import(selected);
    });
    const fileInfo = document.createElement('small');
    fileInfo.textContent = 'Solo parámetros del modelo; no guarda señales ni garantiza curvas idénticas entre versiones.';
    this.element.appendChild(fileInfo);
    const pending = document.createElement('p');
    pending.textContent =
      'Pendiente de mecanismos propios: taponamiento, distensibilidad sistémica venosa y distensibilidad diastólica del VD.';
    this.element.appendChild(pending);
    this.reset();
  }
  #nextEdit(): number {
    this.#file.removeAttribute('aria-invalid');
    return ++this.#revision;
  }
  #setProgress(): void {
    this.#nextEdit();
    const { heartRateBpm, venousReservoirCompliance } = this.#parameters;
    this.#parameters = { ...congestionParameters(Number(this.#progress.value)), heartRateBpm, venousReservoirCompliance };
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
  async #import(file: File): Promise<void> {
    const revision = this.#nextEdit();
    try {
      if (file.size > VENOUS_PARAMETER_FILE_BYTES) throw new Error('Archivo mayor de 8 KiB');
      const next = decodeVenousParameters(await file.text());
      if (revision !== this.#revision) return;
      this.#parameters = next;
      this.#enabled.checked = true;
      this.#fields.disabled = false;
      this.#progress.value = '0';
      this.#pathValue.value = 'Importado';
      this.#sync();
      this.#apply();
    } catch (error) {
      errorLog.report('ui', error);
      if (revision === this.#revision) {
        this.#file.setAttribute('aria-invalid', 'true');
        this.status.textContent = `No se importó: ${errorMessage(error)}`;
      }
    }
  }
  reset(): void {
    this.#nextEdit();
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
