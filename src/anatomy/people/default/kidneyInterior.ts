import type { Vec3 } from '../../../core/vec3';
import {
  ARCUATE,
  ATLAS_DEPTH_BD,
  ATLAS_KIDNEY_W_SCALE,
  ATLAS_RIGHT_ONLY_FINGERS,
  hilumChannelSdf,
  interiorPoint,
  KIDNEY_RADII,
  kidneyLocal,
  kidneyOuterSdf,
  MEDULLA_MIN_DEPTH_MM,
  PYRAMID_BD,
  PYRAMIDS,
  PYRAMIDS_ATLAS,
  RENAL_PELVIS,
  sdRoundCone,
  SINUS_FINGER,
  SINUS_FINGERS,
  SINUS_FINGERS_ATLAS,
  type Kidney,
  type KidneyHit,
} from '../../organs/kidney';
import { sdEllipsoidLocal, smoothMin } from '../../primitives';
/** Analytic renal interior used only by the default classifier. @twin organo-rinon */

/** Distancia con signo al seno (elipsoide + canal del hilio + dedos hacia las papilas), marco local. */
/** @twin organo-rinon */
export function kidneySinusSdf(q: Vec3, k: Kidney): number {
  const qs: Vec3 = [q[0], q[1] - k.sinusOffset, q[2]];
  let d = Math.min(sdEllipsoidLocal(qs, k.sinusRadii), hilumChannelSdf(q, k));
  const t = interiorPoint(q, k);
  const fingers = k.person?.assets.buffers.abdominal ? SINUS_FINGERS_ATLAS : SINUS_FINGERS;
  const count = k.person?.assets.buffers.abdominal && k.w[1] < 0 ? fingers.length - ATLAS_RIGHT_ONLY_FINGERS : fingers.length;
  for (let i = 0; i < count; i++)
    d = smoothMin(d, sdRoundCone(t, fingers[i].a, fingers[i].b, SINUS_FINGER.radiusMm, SINUS_FINGER.radiusMm), SINUS_FINGER.blendMm);
  return d;
}

export function atlasDepthScale(q: Vec3): number {
  const nu = q[0] / (KIDNEY_RADII[0] * KIDNEY_RADII[0]);
  const nv = q[1] / (KIDNEY_RADII[1] * KIDNEY_RADII[1]);
  const nw = q[2] / (KIDNEY_RADII[2] * KIDNEY_RADII[2]);
  const nw2 = (nw * nw) / (nu * nu + nv * nv + nw * nw + 1e-12);
  return Math.sqrt(1 - (1 - ATLAS_KIDNEY_W_SCALE * ATLAS_KIDNEY_W_SCALE) * nw2);
}

/**
 * Regiones del riñón en p. Fuera de él (`dOuter ≥ 0`) no se evalúan el seno ni las pirámides: `dSinus` = +∞. `inner` estima la
 * distancia a la región vecina, el anillo de los arcuatos incluido: las distancias de los conos van por `PYRAMID_BD`. Quien
 * clasifica la multiplica por 0,75, y resta la cápsula (los primeros `RENAL_CAPSULE_MM`).
 */
export function kidneyQuery(p: Vec3, k: Kidney): KidneyHit {
  const q = kidneyLocal(p, k);
  const dOuter = kidneyOuterSdf(q, k);
  // fuera no hay regiones: la grasa perirrenal y su entorno (a < 65 mm del centro) no pagan los dedos del seno
  if (dOuter >= 0) return { dOuter, dSinus: Infinity, region: 'cortex', inner: -dOuter };
  const dSinus = kidneySinusSdf(q, k);
  if (dSinus < 0) {
    // Pelvis: hendidura de orina colapsada en el seno, hacia el hilio. |q/r| es 1/r_mín-lipschitziana: (|q/r| − 1)·r_mín acota
    // la distancia a su superficie, dentro y fuera. `sdEllipsoidLocal` no sirve aquí: en esta lámina declara hasta 5 veces la
    // salida real, y la guarda de la elevación reutilizaba el tejido del centro al otro lado (decisión 305)
    const rp = RENAL_PELVIS.radii;
    const lp = (Math.hypot(q[0] / rp[0], (q[1] - k.sinusOffset - RENAL_PELVIS.offsetV) / rp[1], q[2] / rp[2]) - 1) * rp[2];
    if (lp < 0) return { dOuter, dSinus, region: 'pelvis', inner: Math.min(-lp, -dOuter) };
    return { dOuter, dSinus, region: 'sinus', inner: Math.min(-dSinus, -dOuter, lp) };
  }
  // Pirámides (conos redondeados de la papila a la base, bajo la corteza) y el anillo de los arcuatos en el borde de su base.
  // Con el atlas, la corteza se mide en el riñón ya estirado: `dOuter` es la distancia en el campo sin estirar
  const depth = (k.person?.assets.buffers.abdominal ? -dOuter / atlasDepthScale(q) : -dOuter) - MEDULLA_MIN_DEPTH_MM;
  // `depth` cambia hasta casi el doble de deprisa que la distancia cuando la corrige `atlasDepthScale`: su frontera va a la mitad
  const dd = k.person?.assets.buffers.abdominal ? ATLAS_DEPTH_BD : 1;
  const A = ARCUATE;
  if (depth > -A.halfMm) {
    let dMed = 1e3;
    const t = interiorPoint(q, k);
    for (const pyr of k.person?.assets.buffers.abdominal ? PYRAMIDS_ATLAS : PYRAMIDS)
      dMed = Math.min(dMed, sdRoundCone(t, pyr.apex, pyr.base, pyr.apexR, pyr.baseR));
    const g = PYRAMID_BD;
    if (dMed >= 0) return { dOuter, dSinus, region: 'cortex', inner: Math.min(-dOuter, dSinus, dMed * g) };
    // dentro del cono: el anillo (lejos de la unión menos de halfMm y del borde menos de rimMm), la médula bajo la unión o
    // la corteza sobre el centro de la base; `toRing` acota la distancia al anillo desde fuera de él
    const ringDepth = A.halfMm - Math.abs(depth);
    const ringRim = A.rimMm + dMed;
    if (ringDepth > 0 && ringRim > 0)
      return { dOuter, dSinus, region: 'arcuate', inner: Math.min(ringDepth * dd, ringRim * g, -dMed * g, dSinus) };
    const toRing = Math.max(-ringDepth * dd, -ringRim * g);
    if (depth > 0) return { dOuter, dSinus, region: 'medulla', inner: Math.min(-dMed * g, dSinus, depth * dd, toRing) };
    return { dOuter, dSinus, region: 'cortex', inner: Math.min(-dOuter, dSinus, -depth * dd, toRing) };
  }
  return { dOuter, dSinus, region: 'cortex', inner: Math.min(-dOuter, dSinus, (-depth - A.halfMm) * dd) };
}
