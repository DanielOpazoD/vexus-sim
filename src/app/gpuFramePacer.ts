type PendingGpuContext = { gl: WebGL2RenderingContext; sync: WebGLSync | null };

/** Una adquisición en vuelo por vista: la CPU no acumula cuadros por delante de la GPU. */
export class GpuFramePacer {
  #pending: PendingGpuContext[] = [];
  #waited = false;

  get inFlight(): boolean {
    return this.#pending.length > 0;
  }

  /** Consulta sin espera; un contexto perdido queda a cargo del controlador de recuperación. */
  ready(): boolean {
    let completed = false;
    let error = '';
    for (let i = this.#pending.length - 1; i >= 0; i--) {
      const pending = this.#pending[i];
      const { gl } = pending;
      if (gl.isContextLost()) {
        if (pending.sync) gl.deleteSync(pending.sync);
        this.#pending.splice(i, 1);
        continue;
      }
      // También se repara con la imagen congelada, sin necesitar otro submit.
      if (!pending.sync) this.#fence(pending);
      const { sync } = pending;
      if (!sync) {
        this.#waited = true;
        error = 'No se pudo crear la valla del cuadro GPU';
        continue;
      }
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) {
        this.#waited = true;
        continue;
      }
      pending.sync = null;
      gl.deleteSync(sync);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
        this.#pending.splice(i, 1);
        completed = true;
      } else {
        this.#waited = true;
        error = 'No se pudo comprobar la finalización del cuadro GPU';
      }
    }
    const yieldFrame = this.#waited && completed;
    if (!this.inFlight) this.#waited = false;
    if (error) throw new Error(error);
    // Si hubo espera, ceder una RAF con la cola vacía permite que otra vista
    // prepare sus recursos antes de volver a ocupar la GPU. Sin demora fija.
    return !this.inFlight && !yieldFrame;
  }

  submit(...contexts: WebGL2RenderingContext[]): void {
    if (this.inFlight) throw new Error('Ya hay un cuadro GPU en vuelo');
    let failed = false;
    for (const gl of new Set(contexts)) {
      if (gl.isContextLost()) continue;
      const pending: PendingGpuContext = { gl, sync: null };
      this.#pending.push(pending);
      this.#fence(pending);
      failed ||= !pending.sync;
    }
    if (failed) throw new Error('No se pudo crear la valla del cuadro GPU');
  }

  #fence(pending: PendingGpuContext): void {
    const { gl } = pending;
    pending.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (pending.sync) gl.flush();
  }
}
