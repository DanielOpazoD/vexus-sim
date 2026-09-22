import { EQUIPMENT_LIMITS, type Simulator } from '../app/simulator';
import type { Store } from '../app/store';

/**
 * Atajos de teclado (misma familia que EchoTwin): 2 / C / P modos, Espacio
 * congela, H oculta el navegador, Esc cancela la herramienta, [ ] profundidad,
 * − + ganancia. Se ignoran cuando el foco está en un control de formulario.
 */
export function bindKeyboardShortcuts(store: Store, getSim: () => Simulator, onEquipmentChanged: () => void): () => void {
  const clamp = (v: number, lim: { min: number; max: number }) => Math.min(lim.max, Math.max(lim.min, v));
  const handler = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const sim = getSim();
    switch (e.key) {
      case '2':
        store.set({ mode: 'B' });
        break;
      case 'c':
      case 'C':
        store.set({ mode: store.get().mode === 'color' ? 'B' : 'color', tab: 'doppler' });
        break;
      case 'p':
      case 'P':
        store.set({ mode: store.get().mode === 'pw' ? 'B' : 'pw', tab: 'doppler' });
        break;
      case ' ':
        store.set({ frozen: !store.get().frozen });
        e.preventDefault();
        break;
      case 'h':
      case 'H':
        store.set({ torso: !store.get().torso });
        break;
      case 'Escape':
        store.set({ tool: 'none' });
        break;
      case '[':
        sim.bmode.depthMm = clamp(sim.bmode.depthMm - 10, EQUIPMENT_LIMITS.depthMm);
        onEquipmentChanged();
        break;
      case ']':
        sim.bmode.depthMm = clamp(sim.bmode.depthMm + 10, EQUIPMENT_LIMITS.depthMm);
        onEquipmentChanged();
        break;
      case '-':
        sim.bmode.gainDb = clamp(sim.bmode.gainDb - 2, EQUIPMENT_LIMITS.gainDb);
        onEquipmentChanged();
        break;
      case '+':
      case '=':
        sim.bmode.gainDb = clamp(sim.bmode.gainDb + 2, EQUIPMENT_LIMITS.gainDb);
        onEquipmentChanged();
        break;
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
