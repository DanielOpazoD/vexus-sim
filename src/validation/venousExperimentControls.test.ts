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
  it('preserva ritmo, FC y compliance en cada guía y durante el recorrido fino', () => {
    const s = setup();
    s.field('Ritmo cardíaco experimental').value = 'atrial-fibrillation';
    s.field('Ritmo cardíaco experimental').dispatch('change');
    s.set('Frecuencia cardíaca nominal', 50);
    s.set('Compliance reservorios venosos', 0.5);
    vi.advanceTimersByTime(150);
    for (const [index, fraction] of [0, 0.4, 0.775, 1].entries()) {
      findAll(s.root, (e) => e.tagName === 'BUTTON' && e.textContent === `Guía ${index}`)[0].click();
      expect(s.changed).toHaveBeenLastCalledWith({
        ...congestionParameters(fraction),
        rhythm: 'atrial-fibrillation',
        heartRateBpm: 50,
        venousReservoirCompliance: 0.5,
      });
    }
    s.set('Progresión de congestión', 0.525);
    vi.advanceTimersByTime(150);
    expect(s.changed).toHaveBeenLastCalledWith({
      ...congestionParameters(0.525),
      rhythm: 'atrial-fibrillation',
      heartRateBpm: 50,
      venousReservoirCompliance: 0.5,
    });
    expect(s.field('Ritmo cardíaco experimental').value).toBe('atrial-fibrillation');
    expect(s.field('Frecuencia cardíaca nominal').value).toBe('50');
    expect(s.field('Compliance reservorios venosos').value).toBe('0.5');
  });
  it('cambiar ritmo aplica los otros ajustes pendientes sin sustituirlos por un caso predefinido', () => {
    const s = setup();
    s.set('PAD basal', 17);
    s.set('Regurgitación tricuspídea (modelo)', 0.1);
    s.field('Ritmo cardíaco experimental').value = 'atrial-fibrillation';
    s.field('Ritmo cardíaco experimental').dispatch('change');
    expect(s.changed).toHaveBeenLastCalledWith({
      ...congestionParameters(0),
      rapMeanMmHg: 17,
      tricuspidRegurgitation: 0.1,
      rhythm: 'atrial-fibrillation',
    });
    const calls = s.changed.mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(s.changed).toHaveBeenCalledTimes(calls);
    s.controls.reset();
    expect(s.field('Ritmo cardíaco experimental').value).toBe('sinus');
  });
  it('el reinicio explícito restaura todo y cancela el ajuste pendiente', () => {
    const s = setup();
    s.set('Frecuencia cardíaca nominal', 120);
    vi.advanceTimersByTime(150);
    s.set('Compliance reservorios venosos', 2);
    s.changed.mockClear();
    s.controls.reset();
    vi.advanceTimersByTime(500);
    expect(s.changed).not.toHaveBeenCalled();
    expect(s.field('Frecuencia cardíaca nominal').value).toBe(String(congestionParameters(0).heartRateBpm));
    expect(s.field('Compliance reservorios venosos').value).toBe('1');
  });
});
