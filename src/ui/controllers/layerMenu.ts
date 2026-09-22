import type { NavigatorLayers } from '../navigator3d';

type LayerKey = keyof NavigatorLayers;

/** Menú de capas del navegador 3D (piel, hueso, órganos, vasos, ventanas). */
export function buildLayerMenu(menu: HTMLElement, toggle: HTMLButtonElement, setLayers: (patch: Partial<NavigatorLayers>) => void): void {
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
    cb.addEventListener('change', () => setLayers({ [key]: cb.checked }));
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
}
