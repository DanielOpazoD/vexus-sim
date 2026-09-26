import type { Simulator } from '../../app/simulator';
import type { Store } from '../../app/store';

/**
 * Cine (decisión 80): con la imagen congelada, el deslizador bajo la imagen, ← → (Inicio y Fin) y la rueda sobre
 * la imagen recorren los cuadros guardados (el final, el cuadro congelado). `tick` dibuja el cuadro elegido una
 * vez (o de nuevo si cambia el lienzo); `cursorT` es su instante, para el cursor de las franjas.
 */
export function bindCine(opts: {
  bar: HTMLElement;
  slider: HTMLInputElement;
  label: HTMLElement;
  /** Recibe el foco si se descongela con el deslizador enfocado (el deslizador se oculta). */
  freezeButton: HTMLElement;
  host: HTMLElement;
  getSim: () => Simulator;
  store: Store;
}): { tick(): void; cursorT(): number | null; sync(): void } {
  const { bar, slider, label, freezeButton, host, getSim, store } = opts;
  let pos = 0;
  const count = () => getSim().renderer.cineCount;
  const go = (i: number) => {
    pos = Math.min(count() - 1, Math.max(0, i));
    slider.value = String(pos);
  };
  /**
   * Al congelar o descongelar (y con otro simulador o renderizador): el cine entero, en su último cuadro. Al
   * descongelar vuelve a la pantalla el cuadro congelado, sin esperar al primero en vivo.
   */
  const sync = () => {
    const frozen = store.get().frozen;
    const r = getSim().renderer;
    if (frozen) r.cineSeal();
    else {
      r.cineExit();
      if (bar.contains(document.activeElement)) freezeButton.focus();
    }
    const n = count();
    bar.hidden = !frozen || n === 0;
    slider.max = String(Math.max(0, n - 1));
    go(n - 1);
  };
  store.subscribe((st, prev) => {
    if (st.frozen !== prev.frozen) sync();
  });
  slider.addEventListener('input', () => go(Number(slider.value)));
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (!store.get().frozen || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const n = count();
    const next = e.key === 'ArrowLeft' ? pos - 1 : e.key === 'ArrowRight' ? pos + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    go(next);
  });
  host.addEventListener(
    'wheel',
    (e) => {
      if (!store.get().frozen) return;
      e.preventDefault();
      if (e.deltaY) go(pos + Math.sign(e.deltaY));
    },
    { passive: false },
  );
  return {
    sync,
    tick: () => {
      const r = getSim().renderer;
      const n = count();
      if (!store.get().frozen || !n) return;
      r.showCine(pos);
      // instante respecto al cuadro congelado, con coma decimal y signo menos tipográfico
      const text = `${(r.cineFrame(pos).t - r.cineFrame(n - 1).t).toFixed(2).replace('-', '−').replace('.', ',')} s`;
      if (label.textContent !== text) {
        label.textContent = text;
        slider.setAttribute('aria-valuetext', text);
      }
    },
    cursorT: () => (store.get().frozen ? (getSim().renderer.cineShownFrame?.t ?? null) : null),
  };
}
