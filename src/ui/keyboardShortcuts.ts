import { toggleM, toggleMode, type EquipmentCommand } from '../app/equipment';
import type { Store } from '../app/store';
import { tabAfterMode } from './panel';

/**
 * Atajos de teclado (misma familia que EchoTwin): 2 / M / C / P modos (C y P alternan su función y
 * conservan la otra: tríplex, decisión 66; M, el modo M, decisión 80), Espacio
 * congela, H oculta el navegador, Esc cancela la herramienta, [ ] profundidad,
 * − + ganancia. Se ignoran cuando el foco está en un control de formulario que escribe texto (un deslizador,
 * como el del cine, no los usa: con él enfocado, Espacio descongela).
 */
export function bindKeyboardShortcuts(store: Store, dispatch: (cmd: EquipmentCommand) => void): () => void {
  const handler = (e: KeyboardEvent): void => {
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    if ((tag === 'INPUT' && (el as HTMLInputElement).type !== 'range') || tag === 'SELECT' || tag === 'TEXTAREA') return;
    switch (e.key) {
      case '2':
        store.set({ mode: 'B', tab: tabAfterMode('B', store.get().tab) });
        break;
      case 'm':
      case 'M': {
        const mode = toggleM(store.get().mode);
        store.set({ mode, tab: tabAfterMode(mode, store.get().tab) });
        break;
      }
      case 'c':
      case 'C':
      case 'p':
      case 'P': {
        const mode = toggleMode(store.get().mode, e.key.toLowerCase() === 'c' ? 'color' : 'pw');
        store.set({ mode, tab: tabAfterMode(mode, store.get().tab) });
        break;
      }
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
        dispatch({ type: 'stepDepth', deltaMm: -10 });
        break;
      case ']':
        dispatch({ type: 'stepDepth', deltaMm: 10 });
        break;
      case '-':
        dispatch({ type: 'stepGain', deltaDb: -2 });
        break;
      case '+':
      case '=':
        dispatch({ type: 'stepGain', deltaDb: 2 });
        break;
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
