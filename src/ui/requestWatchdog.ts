/**
 * Vigilante de una petición a un Worker que se comprueba en cada cuadro: la petición caduca cuando lleva `timeoutMs`
 * sin respuesta contando solo el tiempo con el hilo principal en marcha, a lo sumo `maxStepMs` entre dos comprobaciones.
 * Con el reloj de pared, un hilo principal ocupado (un cuadro largo con render por software, una medida que dibuja
 * decenas de cuadros seguidos) daba por caído a un Worker que ya había respondido: su respuesta esperaba en la cola
 * detrás del cuadro, el vigilante lo mataba, informaba de un error falso y el corte se quedaba sin mapa durante el
 * reintento. Un Worker colgado sigue caducando: `timeoutMs / maxStepMs` cuadros sin respuesta.
 */
export class RequestWatchdog {
  private active = false;
  private ageMs = 0;
  private lastMs = 0;

  constructor(
    private readonly timeoutMs: number,
    private readonly maxStepMs = 250,
  ) {}

  /** Empieza a vigilar una petición enviada en `nowMs`. */
  start(nowMs: number): void {
    this.active = true;
    this.ageMs = 0;
    this.lastMs = nowMs;
  }

  /** La petición tuvo respuesta (o se abandonó). */
  stop(): void {
    this.active = false;
  }

  /** En cada cuadro: `true` si la petición vigilada lleva más de `timeoutMs` de hilo principal en marcha sin respuesta. */
  expired(nowMs: number): boolean {
    if (!this.active) return false;
    this.ageMs += Math.min(this.maxStepMs, Math.max(0, nowMs - this.lastMs));
    this.lastMs = nowMs;
    return this.ageMs > this.timeoutMs;
  }
}
