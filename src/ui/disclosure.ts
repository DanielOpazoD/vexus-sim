/**
 * Ayudantes de divulgación progresiva sin framework: bloques plegables (secciones de la consola,
 * corte del carril) y ventanas emergentes ligadas a un botón (capas y ayuda del navegador 3D).
 * El estado se anuncia con `aria-expanded` en el botón.
 */

/** El botón pliega o despliega `block` (clase `collapsed`). */
export function bindCollapsible(toggle: HTMLButtonElement, block: HTMLElement, open = true): void {
  const set = (o: boolean): void => {
    block.classList.toggle('collapsed', !o);
    toggle.setAttribute('aria-expanded', String(o));
  };
  set(open);
  toggle.addEventListener('click', () => set(block.classList.contains('collapsed')));
}

/**
 * El botón abre y cierra `pop` (atributo `hidden`); se cierra al pulsar fuera o con Esc. El Esc que la cierra no
 * sigue hasta los atajos de `window` (no cancela una medición armada).
 */
export function bindPopover(toggle: HTMLButtonElement, pop: HTMLElement): void {
  const set = (open: boolean): void => {
    pop.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('on', open);
  };
  if (pop.id) toggle.setAttribute('aria-controls', pop.id);
  set(!pop.hidden);
  toggle.addEventListener('click', () => set(pop.hidden));
  document.addEventListener('pointerdown', (e) => {
    const target = e.target as Node | null;
    if (!pop.hidden && target && !pop.contains(target) && !toggle.contains(target)) set(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || pop.hidden) return;
    set(false);
    e.stopPropagation();
  });
}
