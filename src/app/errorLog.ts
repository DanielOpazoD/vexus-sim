/**
 * Registro de errores en ejecución (Fase 0): ningún fallo debe ser silencioso.
 * Todo `catch` de la aplicación informa aquí con su origen; los manejadores
 * globales (`error`, `unhandledrejection`) también. La pestaña Docente muestra las
 * últimas entradas y el banner avisa al usuario de los fallos que degradan la
 * experiencia. Mensajes repetidos se agrupan (contador) para no inundar el registro.
 */
export type ErrorSource = 'bucle' | 'corte' | 'audio' | 'caso' | 'gpu' | 'navegador3d' | 'fisiología' | 'global' | 'ui';

export interface ErrorEntry {
  source: ErrorSource;
  message: string;
  /** Instante del primer y del último suceso (ms desde el origen de la página). */
  firstAt: number;
  lastAt: number;
  count: number;
}

type Listener = (e: ErrorEntry) => void;

export class ErrorLog {
  private entries: ErrorEntry[] = [];
  private listeners = new Set<Listener>();

  constructor(
    private readonly capacity = 50,
    private readonly now: () => number = () => performance.now(),
  ) {}

  report(source: ErrorSource, error: unknown): ErrorEntry {
    const message = errorMessage(error);
    const t = this.now();
    const same = this.entries.find((e) => e.source === source && e.message === message);
    let entry: ErrorEntry;
    if (same) {
      same.count++;
      same.lastAt = t;
      entry = same;
    } else {
      entry = { source, message, firstAt: t, lastAt: t, count: 1 };
      this.entries.push(entry);
      if (this.entries.length > this.capacity) this.entries.shift();
    }
    for (const l of this.listeners) {
      try {
        l(entry);
      } catch {
        // un oyente roto no puede silenciar el registro ni a los demás oyentes
      }
    }
    return entry;
  }

  /** Entradas de la más reciente a la más antigua. */
  recent(n = 10): readonly ErrorEntry[] {
    return [...this.entries].sort((a, b) => b.lastAt - a.lastAt).slice(0, n);
  }

  get size(): number {
    return this.entries.length;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Manejadores globales: excepciones no capturadas y promesas rechazadas sin `catch`. */
  installGlobalHandlers(target: Pick<Window, 'addEventListener'>): void {
    target.addEventListener('error', (ev: Event) => this.report('global', (ev as ErrorEvent).error ?? (ev as ErrorEvent).message));
    target.addEventListener('unhandledrejection', (ev: Event) => this.report('global', (ev as PromiseRejectionEvent).reason));
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** Registro único de la aplicación. */
export const errorLog = new ErrorLog();
