import type { StartupStage } from './startupTrace';

/** Una valla diagnóstica tras el primer render. Las vueltas JS no prueban que la GPU acabó. */
export class FirstGpuFrame {
  private started = false;
  private pending: { gl: WebGL2RenderingContext; sync: WebGLSync } | null = null;

  constructor(
    private readonly enabled: boolean,
    private readonly mark: (stage: StartupStage) => void,
  ) {}

  submit(gl: WebGL2RenderingContext): void {
    if (!this.enabled || this.started) return;
    this.started = true;
    this.mark('ultrasound:gpu-submitted');
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) {
      this.mark('ultrasound:gpu-failed');
      return;
    }
    this.pending = { gl, sync };
    gl.flush();
  }

  /** Una consulta sin espera por vuelta; nunca readPixels/finish ni bucle de espera. */
  poll(): void {
    if (!this.pending) return;
    const { gl, sync } = this.pending;
    const status = gl.isContextLost() ? gl.WAIT_FAILED : gl.clientWaitSync(sync, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) return;
    gl.deleteSync(sync);
    this.pending = null;
    this.mark(status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED ? 'ultrasound:gpu-ready' : 'ultrasound:gpu-failed');
  }
}
