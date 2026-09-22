import type { NavigatorLayers } from '../navigator3d';

type LayerKey = keyof NavigatorLayers;

/** Bloquea o desbloquea una capa del menú (el modo alumno bloquea los vasos). */
export interface LayerMenu {
  setLocked(key: LayerKey, locked: boolean, reason: string): void;
}

/** Menú de capas del navegador 3D (piel, hueso, órganos, vasos, ventanas). */
export function buildLayerMenu(
  menu: HTMLElement,
  toggle: HTMLButtonElement,
  setLayers: (patch: Partial<NavigatorLayers>) => void,
): LayerMenu {
  const boxes = new Map<LayerKey, HTMLInputElement>();
  const cap = (t: string) => {
    const d = document.createElement('div');
    d.className = 'menu-cap';
    d.textContent = t;
    menu.appendChild(d);
  };
  const item = (label: string, key: LayerKey) => {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.id = `layer-${key}`;
    cb.addEventListener('change', () => setLayers({ [key]: cb.checked }));
    boxes.set(key, cb);
    l.append(cb, document.createTextNode(label));
    menu.appendChild(l);
  };
  cap('Cuerpo');
  item('Piel', 'skin');
  item('Hueso', 'skeleton');
  cap('Abdomen');
  item('Órganos', 'organs');
  item('Vasos', 'vessels');
  cap('Examen');
  item('Ventanas', 'windows');
  toggle.addEventListener('click', () => (menu.hidden = !menu.hidden));
  return {
    setLocked(key, locked, reason) {
      const cb = boxes.get(key);
      if (!cb) return;
      cb.disabled = locked;
      cb.parentElement!.title = locked ? reason : '';
    },
  };
}
