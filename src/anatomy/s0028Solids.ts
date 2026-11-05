import { anatomyBundle, S0028_BUNDLE as B } from './anatomyBundle';
import { abdominalAtlas } from './abdominalAtlas';
import { thoracicAtlas } from './thoracicAtlas';
import { HALF } from './halfFloat';
import { sourceDistance, sourceLabel } from './sourceVolume';
import type { S0028WallSample } from './s0028Wall';
import type { Vec3 } from '../core/vec3';

/** O máscara fuente automática; D derivación reproducible; E hipótesis acotada; U desconocido (decisión 321). */
export type S0028Certainty = 'O' | 'D' | 'E' | 'U';
/**
 * Vocabulario cerrado de dueños P3 (el de r1, `s0028-solids.py`, más la banda P2): Gerota, cuadrado lumbar aislado,
 * diafragma posterior, interior renal y compartimentos perirrenal/pararrenal no son dueños; quedan U.
 */
export type S0028OwnerId =
  | 'liver'
  | 'spleen'
  | 'pancreas'
  | 'kidney_right'
  | 'kidney_left'
  | 'gallbladder'
  | 'bladder'
  | 'stomach'
  | 'bowel'
  | 'iliopsoas_left'
  | 'iliopsoas_right'
  | 'autochthon_left'
  | 'autochthon_right'
  | 'bone'
  | 'cartilage'
  | 'kidney_cyst_left'
  | 'lung'
  | 'heart'
  | 'wall'
  | 'compatible_fat';
/** Un dueño geométrico: borde D (SDF lineal de su máscara O, banda P2 o vóxel de grasa) y certeza de su interior. */
export interface S0028Owner {
  readonly id: S0028OwnerId;
  /** Distancia con signo al borde propio (mm, negativa dentro); 0 en la grasa, cuyo borde es el del vóxel. */
  readonly d: number;
  readonly certainty: S0028Certainty;
}
/** Todos los dueños independientes de un punto, antes de cualquier política: ≥ 2 es conflicto y se conservan todos. */
export interface S0028Ownership {
  readonly state: 'known' | 'conflict' | 'U';
  readonly owners: readonly S0028Owner[];
}

// Campo P1, dueño (o dueños por etiqueta nearest 1…n) y certeza del interior. Los vasos fuente son de P5.
const TABLE: ReadonlyArray<readonly [string, S0028OwnerId | readonly S0028OwnerId[], S0028Certainty]> = [
  ['liver', 'liver', 'O'],
  ['spleen', 'spleen', 'O'],
  ['pancreas', 'pancreas', 'O'],
  // Borde D de la máscara; corteza, médula, seno y cápsula no están segmentados: interior U.
  ['kidneyRight', 'kidney_right', 'U'],
  ['kidneyLeft', 'kidney_left', 'U'],
  ['gallbladder', 'gallbladder', 'O'],
  ['bladder', 'bladder', 'O'],
  ['digestiveTract', ['stomach', 'bowel', 'bowel', 'bowel'], 'O'],
  ['posteriorMuscle', ['iliopsoas_left', 'iliopsoas_right', 'autochthon_left', 'autochthon_right'], 'O'],
  ['lumbarSacralBone', 'bone', 'O'],
  ['sacrum', 'bone', 'O'],
  ['thoracicBone', 'bone', 'O'],
  ['cartilage', 'cartilage', 'O'],
  // Contenido líquido de un quiste simple: hipótesis E, rotulada.
  ['renalCysts', 'kidney_cyst_left', 'E'],
  ['lung', 'lung', 'O'],
  // Interiores cardíacos E de P7.
  ['heart', 'heart', 'E'],
];
const FIELDS = TABLE.map(([name]) => B.fields.find((f) => f.name === name)!);
// Vasos fuente (P5): no son dueños P3, pero la grasa compatible D tampoco puede reclamar su interior. Los nodos de grasa
// nunca caen en un campo P1 (rejillas alineadas); la lámina subvóxel de los vasos sí (revisión r2: 9/800.000 muestras).
const VESSELS = ['aorta', 'inferior_vena_cava', 'portal_vein_and_splenic_vein'].map((name) => B.fields.find((f) => f.name === name)!);
const insideVessel = (p: Vec3): boolean =>
  VESSELS.some((f) => sourceDistance(f.asset === 'abdominal' ? abdominalAtlas! : thoracicAtlas!, p, f, B[f.asset].textureDimensions) < 0);

let fat: Uint16Array | undefined;
/**
 * Vista del bloque P3 de la reserva verificada (tras el derivado P2): un byte por half exacto, bits little-endian,
 * cajas xyz con z rápida. Ninguna copia; rechaza bytes no enteros, fuera de 0…255 o relleno no nulo.
 */
export function setS0028Solids(capacity: ArrayBuffer): void {
  const S = B.solids;
  if (capacity.byteLength !== B.capacity.rawBytes) throw new Error('Paquete P3 s0028 incompleto');
  const words = new Uint16Array(capacity, 4096 + S.offsetBytes, S.encodedBytes / 2);
  for (let i = 0; i < words.length; i++) {
    const v = HALF[words[i]];
    if (i < S.byteCount ? !(v >= 0 && v <= 255 && v === Math.floor(v)) : words[i] !== 0) throw new Error('Grasa P3 corrupta');
  }
  fat = words;
}

/** Grasa compatible D del vóxel nearest (HU [−190, −30], ≤30 mm del riñón, sin máscara); null fuera de ambas cajas. */
export function s0028CompatibleFat(p: Vec3): boolean | null {
  if (!fat) throw new Error('Paquete P3 s0028 no cargado');
  let covered = false;
  for (const b of B.solids.boxes) {
    const [nx, ny, nz] = b.dimensions,
      x = (p[0] - b.originMm[0]) / 1.5,
      y = (p[1] - b.originMm[1]) / 1.5,
      z = (p[2] - b.originMm[2]) / 1.5;
    if (!(x >= 0 && y >= 0 && z >= 0 && x <= nx - 1 && y <= ny - 1 && z <= nz - 1)) continue;
    covered = true;
    const bit = (Math.round(x) * ny + Math.round(y)) * nz + Math.round(z);
    if ((HALF[fat[b.byteOffset + (bit >> 3)]] >> (bit & 7)) & 1) return true;
  }
  return covered ? false : null;
}

/**
 * Dueños independientes de un punto MATERIAL s0028: cada campo P1 con SDF lineal < 0 (identidad por etiqueta nearest),
 * la banda P2 conocida (1,5 ≤ profundidad < interfaz) y la grasa compatible D, que por definición sólo existe donde ninguna
 * máscara fuente reclama el punto. El hueso dentro de la pared es contenido del complejo P2, no un choque. Sin precedencia:
 * dos o más dueños son conflicto y se conservan todos.
 */
export function s0028Owners(p: Vec3, q: S0028WallSample | undefined): S0028Ownership {
  if (anatomyBundle.person !== 's0028' || !abdominalAtlas || !thoracicAtlas) throw new Error('Clasificador P3 sin s0028');
  const owners: S0028Owner[] = [];
  for (let i = 0; i < TABLE.length; i++) {
    const f = FIELDS[i],
      data = f.asset === 'abdominal' ? abdominalAtlas : thoracicAtlas,
      dims = B[f.asset].textureDimensions,
      d = sourceDistance(data, p, f, dims);
    if (!(d < 0)) continue;
    const [, id, certainty] = TABLE[i];
    let owner = id as S0028OwnerId;
    if (typeof id !== 'string') {
      const label = sourceLabel(data, p, f, dims) % 128;
      if (!(label >= 1 && label <= id.length)) throw new Error('Etiqueta P3 fuera del contrato: ' + f.name);
      owner = id[label - 1];
    }
    // Vértebras, sacro, caderas y costillas son un mismo material O; el primero conserva su etiqueta P1.
    if (owner !== 'bone' || !owners.some((o) => o.id === 'bone')) owners.push({ id: owner, d, certainty });
  }
  const skeleton = owners.some((o) => o.id === 'bone' || o.id === 'cartilage');
  if (q?.kind === 'known' && q.depthMm >= 1.5 && q.depthMm < q.interfaceMm && !skeleton)
    owners.push({ id: 'wall', d: -Math.min(q.depthMm - 1.5, q.interfaceMm - q.depthMm), certainty: q.depthMm < q.outerMm ? 'D' : 'U' });
  if (!owners.some((o) => o.id !== 'wall') && s0028CompatibleFat(p) && !insideVessel(p))
    owners.push({ id: 'compatible_fat', d: 0, certainty: 'D' });
  return { state: owners.length > 1 ? 'conflict' : owners.length ? 'known' : 'U', owners };
}
