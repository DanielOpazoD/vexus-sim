import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Simulator } from '../app/simulator';
import { Store } from '../app/store';
import { NORMAL_ADULT } from '../cases';
import { clonePatient } from '../physiology/patientState';
import { button, row, type Syncable } from '../ui/controls';
import { buildRespirationControls } from '../ui/panel/acquireTab';
import type { PanelContext } from '../ui/panel/context';
import { FakeElement, fakeDocument, findAll } from './support/fakeDom';

beforeEach(() => vi.stubGlobal('document', fakeDocument()));
afterEach(() => vi.unstubAllGlobals());

function mount() {
  const patient = clonePatient(NORMAL_ADULT);
  patient.respiratoryPattern = 'apnea-expiratory';
  const syncables: Syncable[] = [];
  const host = new FakeElement('div');
  const ctx: PanelContext = {
    sim: () => ({ patient }) as Simulator,
    store: new Store({
      mode: 'B',
      tab: 'adquirir',
      frozen: false,
      debug: false,
      audio: false,
      caseId: 'normal-adult',
      torso: true,
      tool: 'none',
    }),
    dispatch: () => undefined,
    track: (control) => {
      syncables.push(control);
      return control;
    },
    sync: () => syncables.forEach((control) => control.sync()),
    section: (parent) => {
      const body = document.createElement('div');
      parent.appendChild(body);
      return body;
    },
    // El contrato del panel: una opción segmentada publica su cambio en el mismo evento.
    segmented: (parent, options, get, set) => {
      const group = row(parent);
      for (const [value, label] of options)
        ctx.track(
          button(
            group,
            label,
            () => {
              set(value);
              ctx.sync();
            },
            () => get() === value,
          ),
        );
      return group;
    },
  };
  buildRespirationControls(ctx, host as unknown as HTMLElement);
  ctx.sync();
  const control = (label: string) => findAll(host, (el) => el.tagName === 'BUTTON' && el.textContent === label)[0];
  return { patient, host, control };
}

describe('respuesta respiratoria del panel sin reloj ni cuadros GPU', () => {
  it('publica etiqueta, aria-pressed, maniobra y nota en ambos sentidos y tras clics repetidos', () => {
    const { patient, host, control } = mount();
    const original = structuredClone(patient);
    const toggle = control('Activar respiración');
    for (let i = 0; i < 3; i++) {
      toggle.click();
      expect(toggle.textContent).toBe('Desactivar respiración');
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      expect(control('Tranquila').getAttribute('aria-pressed')).toBe('true');
      expect(control('Apnea espiratoria').getAttribute('aria-pressed')).toBe('false');
      expect(host.textContent).toContain(`resp ${patient.respiratoryRateMin}/min`);
      expect(patient).toEqual({ ...original, respiratoryPattern: 'quiet' });
      toggle.click();
      expect(toggle.textContent).toBe('Activar respiración');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      expect(control('Tranquila').getAttribute('aria-pressed')).toBe('false');
      expect(control('Apnea espiratoria').getAttribute('aria-pressed')).toBe('true');
      expect(host.textContent).toContain('apagada · fin de espiración');
      expect(patient).toEqual(original);
    }
  });

  it('apagar desde respiración profunda vuelve a fin de espiración; activar desde pausa inspiratoria vuelve a tranquila', () => {
    const { patient, host, control } = mount();
    const original = structuredClone(patient);
    control('Profunda').click();
    control('Desactivar respiración').click();
    expect(patient).toEqual(original);
    expect(control('Activar respiración').getAttribute('aria-pressed')).toBe('false');
    control('Apnea inspiratoria').click();
    expect(host.textContent).toContain('pausa inspiratoria');
    control('Activar respiración').click();
    expect(patient).toEqual({ ...original, respiratoryPattern: 'quiet' });
    expect(control('Desactivar respiración').getAttribute('aria-pressed')).toBe('true');
    expect(control('Tranquila').getAttribute('aria-pressed')).toBe('true');
  });
});
