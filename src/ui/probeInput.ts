import type { ProbePose } from '../probe/probe';

/**
 * Entrada de la sonda (guía §8; base F.5): ratón, trackpad, teclado y táctil
 * producen la misma pose. No hay botones de «vista»: el alumno debe encontrar
 * la ventana desplazando, rotando, basculando e inclinando.
 *
 *  Arrastre izq.        deslizar (φ alrededor del tronco, z craneocaudal)
 *  Arrastre der./⌥      basculación (horizontal) e inclinación (vertical)
 *  Rueda                rotación (yaw); ⇧+rueda: presión/separación
 *  Teclas: A/D W/S deslizar · Q/E rotar · ←/→ bascular · ↑/↓ inclinar · R/F presión
 */
export class ProbeInput {
  private dragging: 'slide' | 'angle' | null = null;
  private lastX = 0;
  private lastY = 0;
  private keys = new Set<string>();
  private touches = new Map<number, { x: number; y: number }>();

  constructor(
    private readonly el: HTMLElement,
    private readonly getPose: () => ProbePose,
    private readonly setPose: (p: ProbePose) => void,
  ) {
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT' || (e.target as HTMLElement | null)?.tagName === 'SELECT') return;
      this.keys.add(e.key.toLowerCase());
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.el.setPointerCapture(e.pointerId);
      return;
    }
    this.dragging = e.button === 2 || e.altKey ? 'angle' : 'slide';
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.el.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      const prev = this.touches.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = this.getPose();
      if (this.touches.size === 1) this.setPose({ ...p, phi: p.phi - dx * 0.004, z: p.z - dy * 0.35 });
      else this.setPose({ ...p, rock: p.rock + dx * 0.004, tilt: p.tilt + dy * 0.004 });
      return;
    }
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    const fine = e.shiftKey ? 0.3 : 1;
    const p = this.getPose();
    if (this.dragging === 'slide') {
      // A la derecha de la pantalla → hacia el marcador (craneal por defecto) no:
      // deslizar en pantalla mueve la sonda sobre la piel en el mismo sentido visual.
      this.setPose({ ...p, phi: p.phi - dx * 0.0035 * fine, z: p.z - dy * 0.3 * fine });
    } else {
      this.setPose({ ...p, rock: p.rock + dx * 0.004 * fine, tilt: p.tilt + dy * 0.004 * fine });
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    this.dragging = null;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.getPose();
    if (e.shiftKey) this.setPose({ ...p, lift: p.lift + e.deltaY * 0.01 });
    else this.setPose({ ...p, yaw: p.yaw + e.deltaY * 0.0015 });
  };

  /** Integra las teclas mantenidas (llamar cada cuadro con dt en segundos). */
  tick(dt: number): void {
    if (this.keys.size === 0) return;
    const p = { ...this.getPose() };
    const fine = this.keys.has('shift') ? 0.3 : 1;
    const slide = 40 * dt * fine; // mm/s
    const rot = 0.9 * dt * fine; // rad/s
    if (this.keys.has('a')) p.phi += slide * 0.008;
    if (this.keys.has('d')) p.phi -= slide * 0.008;
    if (this.keys.has('w')) p.z += slide;
    if (this.keys.has('s')) p.z -= slide;
    if (this.keys.has('q')) p.yaw -= rot;
    if (this.keys.has('e')) p.yaw += rot;
    if (this.keys.has('arrowleft')) p.rock -= rot;
    if (this.keys.has('arrowright')) p.rock += rot;
    if (this.keys.has('arrowup')) p.tilt -= rot;
    if (this.keys.has('arrowdown')) p.tilt += rot;
    if (this.keys.has('r')) p.lift -= slide * 0.25;
    if (this.keys.has('f')) p.lift += slide * 0.25;
    this.setPose(p);
  }
}
