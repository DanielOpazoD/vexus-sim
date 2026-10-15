/** Una adquisición en vuelo por vista: la CPU no acumula cuadros por delante de la GPU. */
export class GpuFramePacer {
  private pending: { gl: WebGL2RenderingContext; sync: WebGLSync } | null = null;
  private waited = false;

  /** Consulta sin espera; un contexto perdido queda a cargo del controlador de recuperación. */
  ready(): boolean {
    if (!this.pending) return true;
    const { gl, sync } = this.pending;
    const lost = gl.isContextLost();
    const status = lost ? gl.WAIT_FAILED : gl.clientWaitSync(sync, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) {
      this.waited = true;
      return false;
    }
    const yieldFrame = this.waited;
    this.waited = false;
    gl.deleteSync(sync);
    this.pending = null;
    if (lost) return true;
    // Si hubo espera, ceder una RAF con la cola vacía permite que otra vista
    // prepare sus recursos antes de volver a ocupar la GPU. Sin demora fija.
    if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return !yieldFrame;
    throw new Error('No se pudo comprobar la finalización del cuadro GPU');
  }

  submit(gl: WebGL2RenderingContext): void {
    if (this.pending) throw new Error('Ya hay un cuadro GPU en vuelo');
    if (gl.isContextLost()) return;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) throw new Error('No se pudo crear la valla del cuadro GPU');
    this.pending = { gl, sync };
    gl.flush();
  }
}
