/**
 * Presupuesto de errores del bucle principal: cuenta los fallos en una ventana deslizante
 * (no por racha, así un fallo intermitente en cuadros alternos también cuenta). Por encima
 * del límite el bucle pasa a modo degradado (reintento a 1 Hz y aviso) en vez de detenerse.
 */
export class ErrorBudget {
  private times: number[] = [];

  constructor(
    private readonly windowMs = 2000,
    private readonly maxErrors = 5,
  ) {}

  /** Registra un fallo en `nowMs`; true si se superó el presupuesto (modo degradado). */
  fail(nowMs: number): boolean {
    this.times.push(nowMs);
    this.times = this.times.filter((t) => nowMs - t < this.windowMs);
    return this.times.length > this.maxErrors;
  }

  reset(): void {
    this.times = [];
  }
}
