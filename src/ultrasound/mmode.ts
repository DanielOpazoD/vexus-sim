/**
 * Modo M (decisión 80): en cada cuadro la GPU copia la línea M de la envolvente mostrada (con el mapa de grises
 * del modo B) a una columna de una textura en anillo, la franja; para verla, cada píxel de la franja toma la
 * columna que cubre su instante (`MColumnRing.pixelSlots`). Nada vuelve a la CPU.
 */

/** Filas de una columna (de la cara a la profundidad del sector): 0,35 mm a 18 cm. */
export const M_SAMPLES = 512;
/** Columnas del anillo de la franja: 34 s a 60 cuadros por segundo (1 MB en R8). */
export const M_COLUMNS = 2048;
/**
 * Hueco máximo entre dos columnas seguidas (s): el bucle avanza como mucho 0,25 s por cuadro. Un hueco mayor (el reloj
 * avanzado sin dibujar) se queda en negro en vez de rellenarse con la columna siguiente.
 */
export const M_MAX_GAP_S = 0.5;

/** Coordenada u de la línea θ en la textura polar: la misma que usa la conversión de barrido. */
export function mLineU(theta: number, halfSector: number): number {
  return (theta + halfSector) / (2 * halfSector);
}

/**
 * Instantes de las columnas del anillo de la franja M: la columna i (0 = la más vieja) está en la ranura
 * `slot(i)` de la textura y cubre (t de la anterior, t]. Una profundidad o línea distinta, o un reloj que vuelve atrás,
 * empiezan una franja nueva; el mismo instante (reloj quieto) reescribe la última columna. `version` cambia con
 * cada columna para que la vista sepa cuándo volver a dibujar.
 */
export class MColumnRing {
  private readonly times: Float64Array;
  private head = 0;
  count = 0;
  depthMm = 0;
  private theta = 0;
  version = 0;

  constructor(readonly capacity = M_COLUMNS) {
    this.times = new Float64Array(capacity);
  }

  /** Ranura de la columna del instante t. */
  push(t: number, depthMm: number, theta = 0): number {
    const last = this.count ? this.times[this.slot(this.count - 1)] : Number.NaN;
    if (this.count && (depthMm !== this.depthMm || theta !== this.theta || t < last)) this.count = 0;
    this.depthMm = depthMm;
    this.theta = theta;
    this.version++;
    if (t === last && this.count) return this.slot(this.count - 1);
    const slot = this.head;
    this.times[slot] = t;
    this.head = (slot + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    return slot;
  }

  clear(): void {
    this.count = 0;
    this.version++;
  }

  slot(i: number): number {
    return (this.head - this.count + i + this.capacity) % this.capacity;
  }

  time(i: number): number {
    return this.times[this.slot(i)];
  }

  /**
   * Columna de cada píxel de una franja de W píxeles que termina en el instante `tRight` y muestra
   * `secondsVisible` (el eje de `ecgX`): la ranura de la primera columna con t ≥ el instante del centro del píxel,
   * o −1 si no hay (antes de la primera columna, después de la última o en un hueco de más de `M_MAX_GAP_S`).
   */
  pixelSlots(tRight: number, secondsVisible: number, W: number, out = new Float32Array(W)): Float32Array {
    let i = 0;
    const n = this.count;
    for (let x = 0; x < W; x++) {
      const t = tRight - secondsVisible + ((x + 0.5) / W) * secondsVisible;
      while (i < n && this.time(i) < t) i++;
      const ok = i < n && (i > 0 ? this.time(i) - this.time(i - 1) <= M_MAX_GAP_S : this.time(0) === t);
      out[x] = ok ? this.slot(i) : -1;
    }
    return out;
  }
}
