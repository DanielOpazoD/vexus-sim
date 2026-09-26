import type { ProbePose } from '../probe/probe';
import type { StartPoint } from './startPoints';

/** Diferencia (rad, −π … π) de `from` a `to` por el arco corto. */
const arc = (to: number, from: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * Animación continua y cancelable de la sonda hacia un punto de partida
 * (decisión 17: «animar, nunca teletransportar»). Cualquier gesto manual la
 * cancela vía `cancel()`; `tick` acerca la pose con una constante de tiempo de
 * ≈ 0,3 s (el giro por el arco corto) y termina, en el punto exacto, cuando toda la pose queda a menos de
 * 0,003 rad / 0,5 mm / 0,005 rad del objetivo: también la basculación, la inclinación y la separación (decisión 83:
 * antes solo miraba φ, z y el giro, y volver a pulsar una tarjeta con la sonda ya en su punto dejaba el abanico).
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
    const t = this.target;
    if (!t) return;
    const p = this.getPose();
    const k = Math.min(1, dt * 3.5);
    const next: ProbePose = {
      ...p,
      phi: p.phi + (t.phi - p.phi) * k,
      z: p.z + (t.z - p.z) * k,
      yaw: p.yaw + arc(t.yaw, p.yaw) * k,
      rock: p.rock + (t.rock - p.rock) * k,
      tilt: p.tilt + (t.tilt - p.tilt) * k,
      lift: p.lift * (1 - k),
    };
    const arrived =
      Math.abs(t.phi - next.phi) < 0.003 &&
      Math.abs(t.z - next.z) < 0.5 &&
      Math.abs(arc(t.yaw, next.yaw)) < 0.005 &&
      Math.abs(t.rock - next.rock) < 0.005 &&
      Math.abs(t.tilt - next.tilt) < 0.005 &&
      Math.abs(next.lift) < 0.5;
    if (!arrived) {
      this.setPose(next);
      return;
    }
    // en el punto exacto: la pose de partida que miden las pruebas (`startPoints.test.ts`)
    this.setPose({ ...next, ...t, lift: 0 });
    this.target = null;
  }
}
