import type { ProbePose } from '../probe/probe';
import type { StartPoint } from './startPoints';

/**
 * Animación continua y cancelable de la sonda hacia un punto de partida
 * (decisión 17: «animar, nunca teletransportar»). Cualquier gesto manual la
 * cancela vía `cancel()`; `tick` acerca la pose con una constante de tiempo de
 * ≈ 0,3 s y termina cuando queda a menos de 0,003 rad / 0,5 mm del objetivo.
 */
export class ProbeAnimator {
  private target: { phi: number; z: number; yaw: number; rock: number; tilt: number } | null = null;

  constructor(
    private readonly getPose: () => ProbePose,
    private readonly setPose: (p: ProbePose) => void,
  ) {}

  get active(): boolean {
    return this.target !== null;
  }

  goTo(sp: StartPoint): void {
    this.target = { phi: sp.phi, z: sp.z, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
  }

  cancel(): void {
    this.target = null;
  }

  tick(dt: number): void {
    if (!this.target) return;
    const p = this.getPose();
    const k = Math.min(1, dt * 3.5);
    const next: ProbePose = {
      ...p,
      phi: p.phi + (this.target.phi - p.phi) * k,
      z: p.z + (this.target.z - p.z) * k,
      yaw: p.yaw + (this.target.yaw - p.yaw) * k,
      rock: p.rock + (this.target.rock - p.rock) * k,
      tilt: p.tilt + (this.target.tilt - p.tilt) * k,
      lift: p.lift * (1 - k),
    };
    this.setPose(next);
    const dphi = this.target.phi - next.phi;
    if (Math.abs(dphi) < 0.003 && Math.abs(this.target.z - next.z) < 0.5 && Math.abs(this.target.yaw - next.yaw) < 0.005)
      this.target = null;
  }
}
