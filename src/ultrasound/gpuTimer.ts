/**
 * Tiempo de GPU por pasada con `EXT_disjoint_timer_query_webgl2`, SIN bloquear (invariante 7 de
 * `CLAUDE.md`): cada consulta se lee cuando el driver la da por disponible, unos cuadros después,
 * y alimenta una media exponencial por pasada. Sin la extensión (SwiftShader, algunos Safari) no
 * mide nada y `timings()` devuelve null. Solo una consulta TIME_ELAPSED puede estar abierta a la
 * vez: las pasadas se miden una tras otra, nunca anidadas.
 */
interface TimerQueryExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** Consultas en vuelo como máximo: si el driver no devuelve resultados, se deja de medir. */
const MAX_PENDING = 64;

export class GpuPassTimer<Id extends string> {
  private readonly ext: TimerQueryExt | null;
  private free: WebGLQuery[] = [];
  private pending: Array<{ id: Id; query: WebGLQuery }> = [];
  private active: { id: Id; query: WebGLQuery } | null = null;
  private readonly ema = new Map<Id, number>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    /** Peso del cuadro nuevo en la media exponencial. */
    private readonly alpha = 0.1,
  ) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
  }

  get supported(): boolean {
    return this.ext !== null;
  }

  begin(id: Id): void {
    if (!this.ext || this.active || this.pending.length >= MAX_PENDING) return;
    const query = this.free.pop() ?? this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { id, query };
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Recoge las consultas terminadas (no bloquea); un intervalo «disjoint» se descarta. */
  poll(): void {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = Boolean(gl.getParameter(this.ext.GPU_DISJOINT_EXT));
    while (this.pending.length > 0) {
      const { id, query } = this.pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) {
        const ms = Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6;
        const prev = this.ema.get(id);
        this.ema.set(id, prev === undefined ? ms : prev + this.alpha * (ms - prev));
      }
      this.free.push(query);
    }
  }

  /** Media por pasada en ms (solo las medidas al menos una vez), o null sin la extensión. */
  timings(): Partial<Record<Id, number>> | null {
    if (!this.ext) return null;
    return Object.fromEntries(this.ema) as Partial<Record<Id, number>>;
  }

  dispose(): void {
    if (this.active && this.ext) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    for (const q of [...this.free, ...this.pending.map((p) => p.query), ...(this.active ? [this.active.query] : [])])
      this.gl.deleteQuery(q);
    this.free = [];
    this.pending = [];
    this.active = null;
  }
}

/** Resumen honesto de los tiempos: por pasada solo si el navegador de verdad los separa. */
export interface GpuFrameTimings<Id extends string> {
  /** Tiempo de GPU del cuadro (ms): suma de pasadas, o el del búfer entero si no se separan. */
  frameMs: number;
  /** Por pasada (ms), o null si este navegador no tiene resolución por pasada. */
  perPass: Partial<Record<Id, number>> | null;
}

/**
 * Algunos backends (ANGLE sobre Metal) meten el cuadro entero en un búfer de órdenes y cada
 * consulta devuelve el tiempo de ese búfer: todas las pasadas «cuestan» lo mismo (≈ el cuadro)
 * y su suma no significa nada. Se detecta comparando una pasada pesada con una trivial: con
 * resolución real, la pesada cuesta muchas veces más (`minRatio`).
 */
export function summarizeGpuTimings<Id extends string>(
  t: Partial<Record<Id, number>> | null,
  heavy: Id,
  light: Id,
  minRatio = 3,
): GpuFrameTimings<Id> | null {
  if (!t) return null;
  const h = t[heavy];
  const l = t[light];
  if (h === undefined || l === undefined) return null;
  const values = Object.values(t) as number[];
  if (h > minRatio * l) return { frameMs: values.reduce((a, b) => a + b, 0), perPass: t };
  return { frameMs: Math.max(...values), perPass: null };
}
