import type { EquipmentCommand } from '../../app/equipment';
import type { Simulator } from '../../app/simulator';
import type { Store } from '../../app/store';

/**
 * Clic sobre la imagen: calibrador de la VCI (herramienta activa o ⌘/Ctrl), puerta PW, línea M (decisión 80) o
 * centro de la caja de color. Un arrastre (> 4 px o > 400 ms) no es un clic: mueve la sonda, salvo que empiece
 * sobre la línea M, que entonces se arrastra. Con la imagen congelada el clic solo mide: la puerta, la línea M y la
 * caja se quedan como en la imagen.
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
  let dragLine: number | null = null;
  /** Punto del evento en píxeles del lienzo. */
  const at = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    return { px: (e.clientX - rect.left) * dpr, py: (e.clientY - rect.top) * dpr, dpr };
  };
  /** El evento empezó sobre un control (el deslizador del cine): no es un clic ni un arrastre de la imagen. */
  const onControl = (e: Event) => !!(e.target as Element | null)?.closest('#cine-bar, button, input, select');
  /** Ángulo de línea del punto, acotado al sector (la línea M se arrastra también fuera de él). */
  const lineTheta = (px: number, py: number) => {
    const s = getSim();
    const d = s.renderer.display;
    const hs = s.transducer.halfSector;
    return Math.min(hs, Math.max(-hs, -Math.atan2(px - d.apexX, py - d.apexY)));
  };
  // la línea M se agarra a ≤ 10 px: antes que la sonda (fase de captura) y sin clic al soltarla; no con la imagen
  // congelada, con un modificador (calibrador, basculación) ni sobre los controles (el deslizador del cine)
  host.addEventListener(
    'pointerdown',
    (e) => {
      const s = getSim();
      if (!s.mmode.enabled || s.frozen || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || onControl(e)) return;
      if (store.get().tool !== 'none') return;
      const { px, py, dpr } = at(e);
      const tr = s.transducer;
      const a = s.renderer.beamToPixel(s.mmode.theta, 0, tr);
      const b = s.renderer.beamToPixel(s.mmode.theta, s.displayed.bmode.depthMm, tr);
      const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
      const u = Math.min(1, Math.max(0, ((px - a.x) * (b.x - a.x) + (py - a.y) * (b.y - a.y)) / L2));
      if (Math.hypot(px - a.x - u * (b.x - a.x), py - a.y - u * (b.y - a.y)) > 10 * dpr) return;
      e.stopPropagation();
      host.setPointerCapture(e.pointerId);
      dragLine = e.pointerId;
      downAt = null;
    },
    { capture: true },
  );
  host.addEventListener('pointermove', (e) => {
    if (dragLine !== e.pointerId || getSim().frozen) return;
    const { px, py } = at(e);
    dispatch({ type: 'placeMLine', theta: lineTheta(px, py) });
  });
  const endDrag = (e: PointerEvent) => {
    if (dragLine === e.pointerId) dragLine = null;
  };
  host.addEventListener('pointerup', endDrag);
  host.addEventListener('pointercancel', endDrag);
  host.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY, t: performance.now() }));
  host.addEventListener('click', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4 || performance.now() - downAt.t > 400) return;
    if (onControl(e)) return;
    const sim = getSim();
    const { px, py } = at(e);
    const beam = sim.renderer.pixelToBeam(px, py, sim.transducer, sim.displayed.bmode.depthMm);
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
    if (sim.frozen) return;
    if (sim.pw.enabled) dispatch({ type: 'placeGate', theta: beam.theta, r: beam.r });
    else if (sim.mmode.enabled) dispatch({ type: 'placeMLine', theta: beam.theta });
    else if (sim.color.enabled) dispatch({ type: 'centerColorBox', theta: beam.theta, r: beam.r });
  });
  return { cancelCaliper: () => (caliperA = null) };
}
