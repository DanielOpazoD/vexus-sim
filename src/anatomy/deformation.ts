import type { Vec3 } from '../core/vec3';
import type { RespiratorySample } from '../physiology/respiratory';
import { compressionElevation, compressionSample, uncompress, type ProbeCompression } from './compression';
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
 *
 * Encima, la compresión de la sonda (decisión 63, `compression.ts`): la sonda aprieta el tejido que la
 * respiración ha llevado bajo ella, así que mundo → material deshace primero la compresión y después la
 * respiración (el mismo orden que `toMaterial` en la GLSL). `compression` es el estado del contacto del cuadro
 * (null: sin sonda, el tronco rígido); lo pone el simulador con cada pose.
 */
const DIR: Vec3 = normalizeDir([0, 0.15, -1]);

function normalizeDir(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

export class RespiratoryDeformation {
  /** Contacto de la sonda del cuadro (decisión 63); null sin compresión. */
  compression: ProbeCompression | null = null;

  constructor(private readonly scene: AnatomyScene) {}

  /** Desplazamiento (mm) en un punto material para la muestra respiratoria. */
  displacement(m: Vec3, resp: RespiratorySample): Vec3 {
    const a = resp.diaphragmCaudalMm * this.scene.respiratoryWeight(m);
    return [DIR[0] * a, DIR[1] * a, DIR[2] * a];
  }

  toWorld(m: Vec3, resp: RespiratorySample): Vec3 {
    const d = this.displacement(m, resp);
    return recompress([m[0] + d[0], m[1] + d[1], m[2] + d[2]], this.compression);
  }

  toMaterial(p: Vec3, resp: RespiratorySample): Vec3 {
    // la compresión de la sonda y después dos iteraciones de punto fijo de la respiración: m = q − d(m)
    const q = uncompress(p, this.compression);
    let m: Vec3 = q;
    for (let i = 0; i < 2; i++) {
      const d = this.displacement(m, resp);
      m = [q[0] - d[0], q[1] - d[1], q[2] - d[2]];
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

/**
 * Inversa de `uncompress` (solo TS: `toWorld`): el punto del mundo p con p + s(p)·r̂ = q. El mapa es radial en el
 * plano de la cara y monótono a lo largo de cada línea (ρ + s crece con ρ), así que basta una bisección en ρ.
 */
function recompress(q: Vec3, k: ProbeCompression | null): Vec3 {
  if (!k) return q;
  const el = compressionElevation(k);
  const e = (q[0] - k.center[0]) * el[0] + (q[1] - k.center[1]) * el[1] + (q[2] - k.center[2]) * el[2];
  const P: Vec3 = [q[0] - k.center[0] - e * el[0], q[1] - k.center[1] - e * el[1], q[2] - k.center[2] - e * el[2]];
  const rhoQ = Math.hypot(P[0], P[1], P[2]);
  if (rhoQ < 1e-6) return q;
  const at = (rho: number): Vec3 => {
    const f = rho / rhoQ;
    return [k.center[0] + P[0] * f + e * el[0], k.center[1] + P[1] * f + e * el[1], k.center[2] + P[2] * f + e * el[2]];
  };
  const mapped = (rho: number): number => rho + compressionSample(at(rho), k).shift;
  let lo = Math.max(1e-3, rhoQ - 200);
  let hi = rhoQ + 200;
  if (mapped(lo) > rhoQ || mapped(hi) < rhoQ) return q;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (mapped(mid) < rhoQ) lo = mid;
    else hi = mid;
  }
  return at(0.5 * (lo + hi));
}
