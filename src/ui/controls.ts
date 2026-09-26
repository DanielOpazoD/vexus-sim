/** Fábricas de controles DOM mínimas, sin framework. */
export interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  format?: (v: number) => string;
}

export interface Syncable {
  sync(): void;
}

let nextId = 0;
/** Identificador único de control, para asociar `<label for>` y `<output for>`. */
export function controlId(label: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `ctl-${slug}-${++nextId}`;
}

/** Deslizador: rótulo y valor en una fila, la barra debajo a todo el ancho. */
export function slider(parent: HTMLElement, spec: SliderSpec, onChange: () => void): Syncable {
  const row = document.createElement('div');
  row.className = 'control';
  const input = document.createElement('input');
  input.type = 'range';
  input.id = controlId(spec.label);
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  const l = document.createElement('label');
  l.htmlFor = input.id;
  l.textContent = spec.label;
  const out = document.createElement('output');
  out.htmlFor.add(input.id);
  const fmt = spec.format ?? ((v: number) => v.toFixed(0));
  const sync = () => {
    input.value = String(spec.get());
    out.textContent = fmt(spec.get());
  };
  input.addEventListener('input', () => {
    spec.set(Number(input.value));
    out.textContent = fmt(Number(input.value));
    onChange();
  });
  row.append(l, out, input);
  parent.appendChild(row);
  sync();
  return { sync };
}

/** Botón; con `isOn` es un conmutador (clase `on` y `aria-pressed`). */
export function button(
  parent: HTMLElement,
  label: string,
  onClick: () => void,
  isOn?: () => boolean,
): Syncable & { el: HTMLButtonElement } {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  const sync = () => {
    if (isOn) setPressed(b, isOn());
  };
  b.addEventListener('click', () => {
    onClick();
    sync();
  });
  parent.appendChild(b);
  sync();
  return { sync, el: b };
}

/** Estado de un conmutador (clase `on` y `aria-pressed`) sin tocar su rótulo ni su icono. */
export function setPressed(b: HTMLButtonElement, on: boolean): void {
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
}

export function row(parent: HTMLElement): HTMLElement {
  const r = document.createElement('div');
  r.className = 'row';
  parent.appendChild(r);
  return r;
}

/** Línea corta en gris (dato o aclaración); las explicaciones largas van al ⓘ de la sección. */
export function note(parent: HTMLElement, text = ''): HTMLElement {
  const d = document.createElement('div');
  d.className = 'note';
  d.textContent = text;
  parent.appendChild(d);
  return d;
}
