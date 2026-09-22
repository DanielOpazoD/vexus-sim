import type { EquipmentCommand } from '../../app/equipment';
import type { Simulator } from '../../app/simulator';
import type { Store } from '../../app/store';

/**
 * Clic sobre la imagen: calibrador de la VCI (herramienta activa o ⌘/Ctrl), puerta PW o
 * centro de la caja de color. Un arrastre (> 4 px o > 400 ms) no es un clic: mueve la sonda.
 */
export function bindImageClick(opts: {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  getSim: () => Simulator;
  store: Store;
  setIvcCaliper: (mm: number | null) => void;
  dispatch: (cmd: EquipmentCommand) => void;
}): { cancelCaliper: () => void } {
  const { host, canvas, getSim, store, setIvcCaliper, dispatch } = opts;
  let caliperA: { x: number; y: number } | null = null;
  let downAt: { x: number; y: number; t: number } | null = null;
  host.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY, t: performance.now() }));
  host.addEventListener('click', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4 || performance.now() - downAt.t > 400) return;
    const sim = getSim();
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    const px = (e.clientX - rect.left) * dpr;
    const py = (e.clientY - rect.top) * dpr;
    const beam = sim.renderer.pixelToBeam(px, py, sim.transducer, sim.bmode.depthMm);
    if (!beam) return;
    if (store.get().tool === 'caliper' || e.metaKey || e.ctrlKey) {
      if (!caliperA) {
        caliperA = { x: px, y: py };
        setIvcCaliper(null);
      } else {
        setIvcCaliper(Math.hypot(px - caliperA.x, py - caliperA.y) / sim.renderer.display.scale);
        caliperA = null;
        store.set({ tool: 'none' });
      }
      return;
    }
    if (sim.pw.enabled) dispatch({ type: 'placeGate', theta: beam.theta, r: beam.r });
    else if (sim.color.enabled) dispatch({ type: 'centerColorBox', theta: beam.theta, r: beam.r });
  });
  return { cancelCaliper: () => (caliperA = null) };
}
