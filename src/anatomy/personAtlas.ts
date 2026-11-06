import type { Vec3 } from '../core/vec3';
import { HEPATIC_DOME, REGISTERED_DOME, REGISTERED_DOME_GRADIENT } from './abdominalAtlasData';
import { boneSurfaceFrame } from './boneSurfaceFrame';
import { HALF } from './halfFloat';
import type { PersonAssets } from './personAssets';
import { sourceDistance, sourceLabel } from './sourceVolume';

export function createAbdominalQueries(assets: PersonAssets) {
  // V8 penaliza las lecturas repetidas de arrays congelados (322.3). Sólo se copia
  // el pequeño layout una vez; queda privado y los atlas conservan sus buffers.
  const descriptor = structuredClone(assets.descriptor);
  const abdominalAtlas = assets.buffers.abdominal;
  /** Distancia y rótulo del campo `field` del atlas abdominal en p (lado TS del lector GLSL de este módulo). @twin atlas-abdominal */
  function abdominalAtlasValue(p: Vec3, field: number): { d: number; label: number } {
    const data = abdominalAtlas,
      f = descriptor.fields[field];
    if (!data || !f) return { d: 16, label: 0 };
    const label = sourceLabel(data, p, f, descriptor.abdominal!.textureDimensions);
    return {
      d: sourceDistance(data, p, f, descriptor.abdominal!.textureDimensions),
      label: descriptor.labelModulus ? label % descriptor.labelModulus : label,
    };
  }

  function abdominalAtlasSdf(p: Vec3, field: number): number {
    const f = descriptor.fields[field];
    return abdominalAtlas && f ? sourceDistance(abdominalAtlas, p, f, descriptor.abdominal!.textureDimensions) : 16;
  }

  /** Upper-source roof approximation, including the same hepatic contact. Not crura or hiatal openings. */
  function registeredDomeHeight(x: number, y: number): number | undefined {
    if (!descriptor.dome) return undefined;
    const data = abdominalAtlas,
      f = REGISTERED_DOME,
      qx = (x - f.originMm[0]) / f.pitchMm,
      qy = (y - f.originMm[1]) / f.pitchMm;
    if (!data || qx < 0 || qy < 0 || qx > f.dimensions[0] - 1 || qy > f.dimensions[1] - 1) return undefined;
    const ix = Math.min(f.dimensions[0] - 2, Math.floor(qx)),
      iy = Math.min(f.dimensions[1] - 2, Math.floor(qy)),
      tx = qx - ix,
      ty = qy - iy,
      [w, h] = descriptor.abdominal!.textureDimensions,
      // XY is transposed in the free plane; organ bricks and contact support are unchanged.
      k = 2 * (f.offset[2] * w * h + (f.offset[1] + ix) * w + f.offset[0] + iy),
      a = HALF[data[k]] + ty * (HALF[data[k + 2]] - HALF[data[k]]),
      b = HALF[data[k + 2 * w]] + ty * (HALF[data[k + 2 * w + 2]] - HALF[data[k + 2 * w]]);
    return a + tx * (b - a);
  }

  /** CPU twin of GLSL's height/validity query; scalar callers avoid the result allocation. */
  function registeredDomeValue(x: number, y: number): [number, number] {
    const height = registeredDomeHeight(x, y);
    return height === undefined ? [0, 0] : [height, 1];
  }

  /** Same graph and continuous derived nodal slopes; guide only, not independent anatomy. */
  function registeredDomeSample(x: number, y: number): [number, number, number, number] {
    if (!descriptor.dome) return [0, 0, 0, 0];
    const data = abdominalAtlas,
      f = REGISTERED_DOME,
      qx = (x - f.originMm[0]) / f.pitchMm,
      qy = (y - f.originMm[1]) / f.pitchMm;
    if (!data || qx < 0 || qy < 0 || qx > f.dimensions[0] - 1 || qy > f.dimensions[1] - 1) return [0, 0, 0, 0];
    const ix = Math.min(f.dimensions[0] - 2, Math.floor(qx)),
      iy = Math.min(f.dimensions[1] - 2, Math.floor(qy)),
      tx = qx - ix,
      ty = qy - iy,
      [w, h] = descriptor.abdominal!.textureDimensions,
      k = 2 * (f.offset[2] * w * h + (f.offset[1] + ix) * w + f.offset[0] + iy),
      g = k + 2 * w * h * (REGISTERED_DOME_GRADIENT.offset[2] - f.offset[2]),
      ha = HALF[data[k]] + ty * (HALF[data[k + 2]] - HALF[data[k]]),
      hb = HALF[data[k + 2 * w]] + ty * (HALF[data[k + 2 * w + 2]] - HALF[data[k + 2 * w]]),
      xa = HALF[data[g]] + ty * (HALF[data[g + 2]] - HALF[data[g]]),
      xb = HALF[data[g + 2 * w]] + ty * (HALF[data[g + 2 * w + 2]] - HALF[data[g + 2 * w]]),
      ya = HALF[data[g + 1]] + ty * (HALF[data[g + 3]] - HALF[data[g + 1]]),
      yb = HALF[data[g + 2 * w + 1]] + ty * (HALF[data[g + 2 * w + 3]] - HALF[data[g + 2 * w + 1]]);
    return [ha + tx * (hb - ha), xa + tx * (xb - xa), ya + tx * (yb - ya), 1];
  }

  /** Estimated hepatic contact surface, sampled in material coordinates like the organs. */
  function hepaticDomeValue(x: number, y: number): [number, number] {
    if (!descriptor.dome) return [0, 0];
    const data = abdominalAtlas,
      f = HEPATIC_DOME,
      q = [(x - f.originMm[0]) / f.pitchMm, (y - f.originMm[1]) / f.pitchMm];
    if (!data || q.some((v, i) => v < 0 || v > f.dimensions[i] - 1)) return [0, 0];
    const a = q.map((v, i) => Math.min(f.dimensions[i] - 2, Math.floor(v))),
      t = q.map((v, i) => v - a[i]),
      [w, h] = descriptor.abdominal!.textureDimensions,
      result: [number, number] = [0, 0];
    for (let j = 0; j <= 1; j++)
      for (let i = 0; i <= 1; i++) {
        const k = 2 * (f.offset[2] * w * h + (f.offset[1] + a[1] + j) * w + f.offset[0] + a[0] + i),
          weight = (i ? t[0] : 1 - t[0]) * (j ? t[1] : 1 - t[1]);
        result[0] += HALF[data[k]] * weight;
        result[1] += HALF[data[k + 1]] * weight;
      }
    return result;
  }

  /** The gradient of the SAME interpolated distance. Subvoxel offsets do not add source resolution. */
  function abdominalAtlasGradient(p: Vec3, field: number): Vec3 {
    const h = 0.25;
    return [0, 1, 2].map((i) => {
      const a: Vec3 = [...p],
        b: Vec3 = [...p];
      a[i] += h;
      b[i] -= h;
      return (abdominalAtlasSdf(a, field) - abdominalAtlasSdf(b, field)) / (2 * h);
    }) as Vec3;
  }

  return {
    abdominalAtlasValue,
    abdominalAtlasSdf,
    registeredDomeHeight,
    registeredDomeValue,
    registeredDomeSample,
    hepaticDomeValue,
    abdominalAtlasGradient,
  };
}

export function createThoracicQueries(assets: PersonAssets) {
  const descriptor = structuredClone(assets.descriptor);
  const thoracicAtlas = assets.buffers.thoracic;
  /** Distancia y rótulo del campo óseo torácico en p (lado TS del lector GLSL de este módulo). @twin atlas-toracico */
  function thoracicValue(p: Vec3): { d: number; label: number } {
    if (!thoracicAtlas) return { d: 16, label: 0 };
    return {
      d: sourceDistance(thoracicAtlas, p, descriptor.thoracicField!, descriptor.thoracic!.textureDimensions),
      label: sourceLabel(thoracicAtlas, p, descriptor.thoracicField!, descriptor.thoracic!.textureDimensions),
    };
  }
  const thoracicSdf = (p: Vec3): number =>
    thoracicAtlas ? sourceDistance(thoracicAtlas, p, descriptor.thoracicField!, descriptor.thoracic!.textureDimensions) : 16;
  const thoracicMaterial = (label: number): string | undefined =>
    ['bone', 'cartilage', 'vertebra'][descriptor.thoracicMaterials?.[label] ?? -1];
  function thoracicGradient(p: Vec3): Vec3 {
    return [0, 1, 2].map((i) => {
      const a: Vec3 = [...p],
        b: Vec3 = [...p];
      a[i] += 0.25;
      b[i] -= 0.25;
      return (thoracicSdf(a) - thoracicSdf(b)) / 0.5;
    }) as Vec3;
  }

  const thoracicFrame = (p: Vec3) => boneSurfaceFrame(p, thoracicSdf);
  return { thoracicValue, thoracicSdf, thoracicMaterial, thoracicGradient, thoracicFrame };
}
