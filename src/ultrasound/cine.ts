/**
 * Cine (decisión 80): los últimos ~6 s de cuadros adquiridos se guardan en la GPU ANTES de la conversión de
 * barrido (la envolvente polar tras la composición y el campo de color) y se vuelven a mostrar con la misma
 * pasada de pantalla. Este módulo es la parte pura: qué cuadro se guarda, en qué ranura del anillo y cuántos
 * cuadros anteriores repite la persistencia al mostrar uno.
 */

/** Cuadros del anillo: 120 × (192 × 1024 R16F + 96 × 160 RG16F) = 54,6 MB de GPU. */
export const CINE_FRAMES = 120;
/** Cadencia máxima de guardado (Hz del reloj de la simulación): el anillo cubre 6 s. */
export const CINE_RATE_HZ = 20;

/** Anillo de cuadros del cine: el índice 0 es el más viejo y `count − 1` el último guardado. */
export class CineRing<T> {
  private readonly items: T[] = [];
  private head = 0;
  private n = 0;
  private nextDue = -Infinity;

  constructor(
    readonly capacity = CINE_FRAMES,
    private readonly rateHz = CINE_RATE_HZ,
  ) {}

  get count(): number {
    return this.n;
  }

  /**
   * ¿Se guarda el cuadro del instante t? Como mucho `rateHz` de media: el siguiente vence 1/rateHz después del
   * anterior, pero nunca antes de medio periodo tras el último guardado (sin ráfagas tras una pausa). Varios
   * cuadros en el mismo instante (el reloj quieto) cuentan como uno.
   */
  due(t: number): boolean {
    return t >= this.nextDue;
  }

  /** Guarda el cuadro y devuelve su ranura: con el anillo lleno, la del más viejo. */
  push(t: number, item: T): number {
    const slot = this.head;
    this.items[slot] = item;
    this.head = (slot + 1) % this.capacity;
    this.n = Math.min(this.n + 1, this.capacity);
    this.nextDue = Math.max(this.nextDue + 1 / this.rateHz, t + 0.5 / this.rateHz);
    return slot;
  }

  /** Ranura (capa de la textura) del cuadro i (0 = el más viejo). */
  slot(i: number): number {
    if (!Number.isInteger(i) || i < 0 || i >= this.n) throw new RangeError(`cine: cuadro ${i} de ${this.n}`);
    return (this.head - this.n + i + this.capacity) % this.capacity;
  }

  at(i: number): T {
    return this.items[this.slot(i)];
  }

  clear(): void {
    this.n = 0;
    this.head = 0;
    this.nextDue = -Infinity;
  }
}

/**
 * Cuadros anteriores que repite la persistencia al mostrar uno del cine: los que aún pesan medio nivel de gris
 * (p^k · 255 ≥ ½). Con la persistencia por omisión (0,35), 6; con la máxima (0,8), 28.
 */
export function persistenceReplay(p: number): number {
  if (!(p > 0)) return 0;
  return Math.min(CINE_FRAMES - 1, Math.ceil(Math.log(0.5 / 255) / Math.log(Math.min(p, 0.99))));
}
