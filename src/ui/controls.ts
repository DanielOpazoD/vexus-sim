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

export function slider(parent: HTMLElement, spec: SliderSpec, onChange: () => void): Syncable {
  const row = document.createElement('div');
  row.className = 'control';
  const l = document.createElement('label');
  l.textContent = spec.label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  const out = document.createElement('output');
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
  row.append(l, input, out);
  parent.appendChild(row);
  sync();
  return { sync };
}

export function button(
  parent: HTMLElement,
  label: string,
  onClick: () => void,
  isOn?: () => boolean,
): Syncable & { el: HTMLButtonElement } {
  const b = document.createElement('button');
  b.textContent = label;
  const sync = () => {
    if (isOn) b.classList.toggle('on', isOn());
  };
  b.addEventListener('click', () => {
    onClick();
    sync();
  });
  parent.appendChild(b);
  sync();
  return { sync, el: b };
}

export function row(parent: HTMLElement): HTMLElement {
  const r = document.createElement('div');
  r.className = 'row';
  parent.appendChild(r);
  return r;
}

export function help(parent: HTMLElement, html: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'help';
  d.innerHTML = html; // contenido estático del programa, no entrada del usuario
  parent.appendChild(d);
  return d;
}
