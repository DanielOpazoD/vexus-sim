import type { Vec3 } from '../core/vec3';
import type { RespiratorySample } from '../physiology/respiratory';
import type { AnatomyScene } from './scene';

/**
 * Deformación respiratoria (guía §15; base B.4): un único campo de
 * desplazamiento material→mundo compartido por órganos, vasos, dispersores y
 * volumen de muestra. No es una traslación rígida de la escena: el peso
 * espacial anula el movimiento en pared, costillas y columna, y lo aplica
 * íntegro a diafragma, hígado, cava y vasos.
 *
 *   p_mundo = m + D(t)·w(m)·dir ;  dir = (0, 0,15, −1) normalizada (caudal, algo anterior)
 *
 * La inversa se aproxima con w evaluado en p (w varía lentamente).
 */
const DIR: Vec3 = normalizeDir([0, 0.15, -1]);

function normalizeDir(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

export class RespiratoryDeformation {
  constructor(private readonly scene: AnatomyScene) {}

  /** Desplazamiento (mm) en un punto material para la muestra respiratoria. */
  displacement(m: Vec3, resp: RespiratorySample): Vec3 {
    const a = resp.diaphragmCaudalMm * this.scene.respiratoryWeight(m);
    return [DIR[0] * a, DIR[1] * a, DIR[2] * a];
  }

  toWorld(m: Vec3, resp: RespiratorySample): Vec3 {
    const d = this.displacement(m, resp);
    return [m[0] + d[0], m[1] + d[1], m[2] + d[2]];
  }

  toMaterial(p: Vec3, resp: RespiratorySample): Vec3 {
    // Dos iteraciones de punto fijo: m = p − d(m)
    let m: Vec3 = p;
    for (let i = 0; i < 2; i++) {
      const d = this.displacement(m, resp);
      m = [p[0] - d[0], p[1] - d[1], p[2] - d[2]];
    }
    return m;
  }

  /** Velocidad del tejido (mm/s) en un punto material. */
  tissueVelocity(m: Vec3, resp: RespiratorySample): Vec3 {
    const a = resp.diaphragmVelocityMmS * this.scene.respiratoryWeight(m);
    return [DIR[0] * a, DIR[1] * a, DIR[2] * a];
  }

  static get direction(): Vec3 {
    return DIR;
  }
}
