import { describe, expect, it, vi } from 'vitest';
import { GpuPageTurns } from '../app/gpuPageTurns';

type Entry = {
  mode: LockMode;
  callback: (lock: Lock) => Promise<void> | void;
  resolve: () => void;
  reject: (error: unknown) => void;
};

/** Resource-queue contract only; the browser tests observe actual GPU completion. */
class Locks {
  readonly held: Entry[] = [];
  private queue: Entry[] = [];
  readonly api = {
    request: (_name: string, options: LockOptions, callback: Entry['callback']) =>
      new Promise<void>((resolve, reject) => {
        if (options.signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        const entry = { mode: options.mode ?? 'exclusive', callback, resolve, reject };
        this.queue.push(entry);
        options.signal?.addEventListener('abort', () => {
          if (!this.queue.includes(entry)) return;
          this.queue = this.queue.filter((e) => e !== entry);
          reject(new DOMException('Aborted', 'AbortError'));
          this.pump();
        });
        this.pump();
      }),
  } as unknown as Pick<LockManager, 'request'>;

  private pump(): void {
    while (this.queue.length) {
      const next = this.queue[0];
      if (this.held.some((e) => e.mode === 'exclusive') || (next.mode === 'exclusive' && this.held.length)) return;
      this.queue.shift();
      this.held.push(next);
      void Promise.resolve()
        .then(() => next.callback({ mode: next.mode, name: 'vexus-gpu-preparation' }))
        .then(next.resolve, next.reject)
        .finally(() => {
          this.held.splice(this.held.indexOf(next), 1);
          this.pump();
        });
    }
  }
}

const settle = async () => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
};

async function warm(page: GpuPageTurns) {
  page.submitted();
  page.completed();
  page.submitted();
  await settle();
  page.completed();
  await settle();
}

describe('Preparar otra vista sin competir con sus adquisiciones', () => {
  it('mantiene los dos primeros trabajos exclusivos y deja preparar la siguiente página antes de continuar', async () => {
    const locks = new Locks(),
      report = vi.fn();
    const a = new GpuPageTurns(locks.api, report),
      b = new GpuPageTurns(locks.api, report);
    await a.prepare();
    const preparing = b.prepare();
    await settle();
    expect(a.ready).toBe(true);
    expect(b.ready).toBe(false);
    a.completed(); // No submitted frame: do not give up initialization.
    await settle();
    expect(b.ready).toBe(false);
    a.submitted();
    a.completed();
    await settle();
    expect(a.ready).toBe(true);
    expect(b.ready).toBe(false);
    a.submitted();
    await settle();
    expect(b.ready).toBe(false);
    a.completed();
    await preparing;
    expect(b.ready).toBe(true);
    expect(a.ready).toBe(false);
    await warm(b);
    expect(a.ready).toBe(true);
    expect(b.ready).toBe(true);
    a.dispose();
    b.dispose();
    await settle();
    expect(locks.held).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it('una sola reserva anticipada conserva la cadencia y no adelanta nuevas adquisiciones a otra preparación', async () => {
    const locks = new Locks(),
      report = vi.fn();
    const a = new GpuPageTurns(locks.api, report),
      b = new GpuPageTurns(locks.api, report);
    await a.prepare();
    await warm(a);
    a.submitted();
    await settle();
    expect(locks.held).toHaveLength(2);
    const preparing = b.prepare();
    await settle();
    a.completed();
    expect(a.ready).toBe(true); // The one already granted frame is still available synchronously.
    a.submitted();
    await settle();
    expect(b.ready).toBe(false);
    a.completed();
    await preparing;
    expect(a.ready).toBe(false);
    expect(b.ready).toBe(true);
    a.dispose();
    b.dispose();
    await settle();
    expect(locks.held).toEqual([]);
  });

  it('un arranque fallido o una página cancelada libera reservas y peticiones pendientes', async () => {
    const locks = new Locks(),
      report = vi.fn();
    const a = new GpuPageTurns(locks.api, report),
      b = new GpuPageTurns(locks.api, report);
    await a.prepare();
    const preparing = b.prepare();
    await settle();
    b.dispose();
    await preparing;
    a.dispose();
    a.dispose();
    await settle();
    expect(locks.held).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it.each(['throw', 'reject'])('informa del fallo %s y permite el fallback sin bloquear otras páginas', async (kind) => {
    const error = new Error('Lock manager unavailable'),
      report = vi.fn();
    const api = {
      request: () => {
        if (kind === 'throw') throw error;
        return Promise.reject(error);
      },
    } as unknown as Pick<LockManager, 'request'>;
    const page = new GpuPageTurns(api, report);
    await page.prepare();
    expect(page.ready).toBe(true);
    page.submitted();
    page.completed();
    expect(report).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('un fallo de la reserva siguiente no libera trabajo GPU que todavía no ha completado', async () => {
    const locks = new Locks(),
      report = vi.fn();
    const a = new GpuPageTurns(locks.api, report),
      b = new GpuPageTurns(locks.api, report);
    await a.prepare();
    a.submitted();
    a.completed();
    const error = new Error('Request rejected');
    vi.spyOn(locks.api, 'request').mockRejectedValueOnce(error);
    a.submitted();
    await settle();
    const preparing = b.prepare();
    await settle();
    expect(b.ready).toBe(false);
    expect(report).toHaveBeenCalledExactlyOnceWith(error);
    a.completed();
    await preparing;
    expect(b.ready).toBe(true);
    a.dispose();
    b.dispose();
    await settle();
    expect(locks.held).toEqual([]);
  });

  it('sin Web Locks conserva el limitador GPU local y no inventa una reserva', async () => {
    const report = vi.fn(),
      page = new GpuPageTurns(undefined, report);
    await page.prepare();
    expect(page.ready).toBe(true);
    page.submitted();
    page.completed();
    page.dispose();
    expect(report).not.toHaveBeenCalled();
  });
});
