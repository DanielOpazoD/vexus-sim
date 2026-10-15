import { afterEach, expect, it, vi } from 'vitest';
import type { Simulator } from '../app/simulator';
import { Store } from '../app/store';
import { bindCine } from '../ui/controllers/cine';
import { FakeElement } from './support/fakeDom';

afterEach(() => vi.unstubAllGlobals());

function mount() {
  const events = new EventTarget();
  vi.stubGlobal('window', events);
  vi.stubGlobal('document', { activeElement: null });
  const slider = new FakeElement('input'),
    label = new FakeElement('span'),
    bar = new FakeElement('div');
  Reflect.set(bar, 'contains', () => false);
  const host = new EventTarget();
  const frames = [
    { t: 2, geometry: 'anterior' },
    { t: 2.5, geometry: 'lateral' },
    { t: 3, geometry: 'posterior' },
  ];
  const renderer = {
    cineCount: frames.length,
    cineFrame: (i: number) => frames[i],
    cineShownFrame: null as (typeof frames)[number] | null,
    cineSeal: vi.fn(),
    cineExit: vi.fn(),
    showCine: vi.fn((i: number) => {
      renderer.cineShownFrame = frames[i];
    }),
  };
  const store = new Store({
    mode: 'B',
    tab: 'adquirir',
    frozen: false,
    debug: false,
    audio: false,
    caseId: 'normal-adult',
    torso: true,
    tool: 'none',
  });
  const cine = bindCine({
    slider: slider as unknown as HTMLInputElement,
    label: label as unknown as HTMLElement,
    bar: bar as unknown as HTMLElement,
    freezeButton: new FakeElement('button') as unknown as HTMLElement,
    host: host as unknown as HTMLElement,
    getSim: () => ({ renderer }) as unknown as Simulator,
    store,
  });
  store.set({ frozen: true });
  return { cine, slider, label, renderer, store, host, events, frames };
}

it('presents the chosen historical acquisition and its trace cursor in the input event without another GPU loop', () => {
  const { cine, slider, label, renderer, frames } = mount();
  expect(renderer.cineShownFrame).toBe(frames[2]);
  slider.value = '0';
  slider.dispatch('input');
  // No tick/advance/render is called: a busy live frame cannot retain newer geometry.
  expect(renderer.cineShownFrame).toBe(frames[0]);
  expect(cine.cursorT()).toBe(2);
  expect(label.textContent).toBe('−1,00 s');
  expect(slider.getAttribute('aria-valuetext')).toBe('−1,00 s');
});

it('applies wheel and keyboard history selection immediately and ignores history gestures while live', () => {
  const { cine, renderer, host, events, store, frames } = mount();
  const key = (key: string) => {
    const event = new Event('keydown', { cancelable: true });
    Reflect.set(event, 'key', key);
    events.dispatchEvent(event);
  };
  key('Home');
  expect(renderer.cineShownFrame).toBe(frames[0]);
  const wheel = new Event('wheel', { cancelable: true });
  Reflect.set(wheel, 'deltaY', 1);
  host.dispatchEvent(wheel);
  expect(renderer.cineShownFrame).toBe(frames[1]);
  expect(cine.cursorT()).toBe(2.5);
  key('End');
  expect(renderer.cineShownFrame).toBe(frames[2]);
  store.set({ frozen: false });
  const calls = renderer.showCine.mock.calls.length;
  key('Home');
  host.dispatchEvent(wheel);
  expect(renderer.showCine).toHaveBeenCalledTimes(calls);
  expect(cine.cursorT()).toBeNull();
});
