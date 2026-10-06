import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { congestionParameters } from '../app/venousExperiment';
import { VenousExperimentControls } from '../ui/panel/venousExperimentControls';
import { fakeDocument, type FakeElement, findAll } from './support/fakeDom';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', fakeDocument());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup() {
  const changed = vi.fn();
  const controls = new VenousExperimentControls(changed);
  const root = controls.element as unknown as FakeElement;
  const field = (label: string) => findAll(root, (e) => e.getAttribute('aria-label') === label)[0];
  const set = (label: string, value: number) => {
    const input = field(label);
    input.value = String(value);
    input.dispatch('input');
  };
  findAll(root, (e) => e.type === 'checkbox')[0].click();
  return { changed, controls, root, field, set };
}
describe('guías de congestión conservan controles independientes', () => {
  it('preserva FC y compliance en cada guía y durante el recorrido fino', () => {
    const s = setup();
    s.set('Frecuencia cardíaca sinusal', 50);
    s.set('Compliance reservorios venosos', 0.5);
    vi.advanceTimersByTime(150);
    for (const [index, fraction] of [0, 0.4, 0.775, 1].entries()) {
      findAll(s.root, (e) => e.tagName === 'BUTTON' && e.textContent === `Guía ${index}`)[0].click();
      expect(s.changed).toHaveBeenLastCalledWith({ ...congestionParameters(fraction), heartRateBpm: 50, venousReservoirCompliance: 0.5 });
    }
    s.set('Progresión de congestión', 0.525);
    vi.advanceTimersByTime(150);
    expect(s.changed).toHaveBeenLastCalledWith({ ...congestionParameters(0.525), heartRateBpm: 50, venousReservoirCompliance: 0.5 });
    expect(s.field('Frecuencia cardíaca sinusal').value).toBe('50');
    expect(s.field('Compliance reservorios venosos').value).toBe('0.5');
  });
  it('el reinicio explícito restaura todo y cancela el ajuste pendiente', () => {
    const s = setup();
    s.set('Frecuencia cardíaca sinusal', 120);
    vi.advanceTimersByTime(150);
    s.set('Compliance reservorios venosos', 2);
    s.changed.mockClear();
    s.controls.reset();
    vi.advanceTimersByTime(500);
    expect(s.changed).not.toHaveBeenCalled();
    expect(s.field('Frecuencia cardíaca sinusal').value).toBe(String(congestionParameters(0).heartRateBpm));
    expect(s.field('Compliance reservorios venosos').value).toBe('1');
  });
});
