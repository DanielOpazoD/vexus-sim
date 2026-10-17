import type { EquipmentCommand } from '../../app/equipment';
import type { Simulator } from '../../app/simulator';
import type { Store } from '../../app/store';

/**
 * Clic para medir; arrastre primario del ratón para colocar Doppler en vivo (caja y puerta juntas en tríplex).
 * La línea M se arrastra desde su asa. Los otros gestos siguen moviendo la sonda. Congelada, la imagen solo mide.
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
  let drag: { id: number; mode: string } | null = null;
  /** Punto del evento en píxeles del lienzo. */
  const at = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    return { px: (e.clientX - rect.left) * dpr, py: (e.clientY - rect.top) * dpr, dpr };
  };
  /** El evento empezó sobre un control (el deslizador del cine): no es un clic ni un arrastre de la imagen. */
  const onControl = (e: Event) => !!(e.target as Element | null)?.closest('#cine-bar, button, input, select');
  const transducer = () => getSim().renderer.displayedFrame?.anatomy.transducer ?? getSim().transducer;
  /** Ángulo de línea del punto, acotado al sector (la línea M se arrastra también fuera de él). */
  const lineTheta = (px: number, py: number) => {
    const s = getSim();
    const d = s.renderer.display;
    const hs = transducer().halfSector;
    return Math.min(hs, Math.max(-hs, -Math.atan2(px - d.apexX, py - d.apexY)));
  };
  const place = (e: MouseEvent, coupled = false): boolean => {
    const sim = getSim();
    const { px, py } = at(e);
    const tr = transducer();
    const beam = sim.renderer.pixelToBeam(px, py, tr, sim.displayed.bmode.depthMm);
    if (!beam) return false;
    if (!coupled && (store.get().tool === 'caliper' || e.metaKey || e.ctrlKey)) {
      if (!caliperA) {
        caliperA = { x: px, y: py };
        setIvcCaliper(null);
      } else {
        setIvcCaliper(Math.hypot(px - caliperA.x, py - caliperA.y) / sim.renderer.display.scale);
        caliperA = null;
        store.set({ tool: 'none' });
      }
      return true;
    }
    if (sim.frozen) return false;
    if (sim.pw.enabled) dispatch({ type: 'placeGate', theta: beam.theta, r: beam.r, withColorBox: coupled });
    else if (sim.mmode.enabled) dispatch({ type: 'placeMLine', theta: beam.theta });
    else if (sim.color.enabled) dispatch({ type: 'centerColorBox', theta: beam.theta, r: beam.r });
    return true;
  };
  // Capturar antes que ProbeInput: el arrastre del control nunca traslada la sonda.
  host.addEventListener(
    'pointerdown',
    (e) => {
      const s = getSim();
      if (s.frozen || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || onControl(e) || store.get().tool !== 'none') return;
      if (s.mmode.enabled) {
        const { px, py, dpr } = at(e);
        const tr = transducer();
        const a = s.renderer.beamToPixel(s.mmode.theta, 0, tr);
        const b = s.renderer.beamToPixel(s.mmode.theta, s.displayed.bmode.depthMm, tr);
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const L2 = dx ** 2 + dy ** 2 || 1;
        const u = Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / L2));
        if (Math.hypot(px - a.x - u * dx, py - a.y - u * dy) > 10 * dpr) return;
      } else if (e.pointerType !== 'mouse' || !(s.pw.enabled || s.color.enabled) || !place(e, true)) return;
      e.stopPropagation();
      host.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, mode: store.get().mode };
      downAt = null;
    },
    { capture: true },
  );
  host.addEventListener('pointermove', (e) => {
    if (drag?.id !== e.pointerId) return;
    if (getSim().frozen || store.get().tool !== 'none' || store.get().mode !== drag.mode) {
      drag = null;
      return;
    }
    if (drag.mode === 'M') {
      const { px, py } = at(e);
      dispatch({ type: 'placeMLine', theta: lineTheta(px, py) });
    } else place(e, true);
  });
  const endDrag = (e: PointerEvent) => {
    if (drag?.id === e.pointerId) drag = null;
  };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) host.addEventListener(event, endDrag);
  host.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY, t: performance.now() }));
  host.addEventListener('click', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4 || performance.now() - downAt.t > 400 || onControl(e)) return;
    place(e);
  });
  return { cancelCaliper: () => (caliperA = null) };
}
