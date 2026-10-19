import type { Page } from '@playwright/test';

interface GpuProgress {
  canvas: string;
  fences: number;
  deletes: number;
  waits: number;
  timeouts: number;
  signaled: number;
  failed: number;
  lastStatus: number | null;
  lastWaitAt: number | null;
  lastFenceAt: number | null;
}
declare global {
  interface Window {
    gpuProgress?: GpuProgress[];
  }
}

/** Observa llamadas reales; no espera, consulta ni añade trabajo a la GPU. */
export async function observeGpuProgress(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window.gpuProgress || typeof WebGL2RenderingContext === 'undefined') return;
    const rows: GpuProgress[] = (window.gpuProgress = []);
    const contexts = new WeakMap<WebGL2RenderingContext, GpuProgress>();
    const state = (gl: WebGL2RenderingContext): GpuProgress => {
      let row = contexts.get(gl);
      if (!row) {
        row = {
          canvas:
            gl.canvas instanceof HTMLCanvasElement ? gl.canvas.id || gl.canvas.parentElement?.id || `canvas-${rows.length}` : 'offscreen',
          fences: 0,
          deletes: 0,
          waits: 0,
          timeouts: 0,
          signaled: 0,
          failed: 0,
          lastStatus: null,
          lastWaitAt: null,
          lastFenceAt: null,
        };
        contexts.set(gl, row);
        rows.push(row);
      }
      return row;
    };
    const prototype = WebGL2RenderingContext.prototype;
    const wait = Reflect.get(prototype, 'clientWaitSync'),
      fence = Reflect.get(prototype, 'fenceSync'),
      remove = Reflect.get(prototype, 'deleteSync');
    prototype.clientWaitSync = function (sync, flags, timeout) {
      const result = wait.call(this, sync, flags, timeout),
        row = state(this);
      row.waits++;
      row.lastStatus = result;
      row.lastWaitAt = performance.now();
      if (result === this.TIMEOUT_EXPIRED) row.timeouts++;
      else if (result === this.WAIT_FAILED) row.failed++;
      else row.signaled++;
      return result;
    };
    prototype.fenceSync = function (condition, flags) {
      const result = fence.call(this, condition, flags);
      if (result) {
        const row = state(this);
        row.fences++;
        row.lastFenceAt = performance.now();
      }
      return result;
    };
    prototype.deleteSync = function (sync) {
      if (sync) state(this).deletes++;
      remove.call(this, sync);
    };
  });
}

export async function gpuDiagnostic(page: Page) {
  return page.evaluate(async () => {
    const test = window.__vexusTest,
      sim = test?.sim();
    return {
      at: performance.now(),
      clock: sim?.physiology.clock.t,
      frames: test?.framesRendered(),
      frozen: sim?.frozen,
      color: sim?.color.enabled,
      pw: sim?.pw.enabled,
      contextLost: sim?.renderer.gl.isContextLost(),
      errors: test?.loggedErrors(),
      gpu: window.gpuProgress,
      locks: navigator.locks ? await navigator.locks.query() : null,
    };
  });
}
