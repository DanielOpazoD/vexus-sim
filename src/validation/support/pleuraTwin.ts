/**
 * Gemelo en CPU de las pasadas B → C → D → G de la mirada 0 para la pleura parietal y la cortina (decisión 61),
 * sobre una pared plana extruida en elevación: piel 2 mm, grasa 14 mm y músculo 12 mm (el adulto de
 * referencia) paralelos a la tangente de la cara, con las capas de la decisión 62 (Scarpa, fascia profunda, los
 * dos planos intermusculares de la pared lateral, transversalis, grasa preperitoneal y peritoneo, planas y con
 * sus caras; sin la textura de septos y estrías ni la variación de las caras), y debajo la lámina de pulmón de
 * la cortina (a partir del
 * borde, en la dirección lateral de la imagen, que aquí es la craneocaudal: l_z = cos θ, e_z = 0, como la
 * ventana del flanco) o la cápsula y el hígado. Usa las funciones de producción: el moteado anclado de tres
 * planos (`anchoredSliceField`), los grumos y la heterogeneidad (`speckleField.ts`), el eco de las caras
 * (`interfaceEchoField`) y todo el modelo de la pleura (`pleura.ts`: línea pleural y réplicas, serie de la
 * pared, deslizamiento y fracción de aire). La transmisión es la analítica de las capas a la frecuencia B
 * efectiva; bajo la pleura, la del tejido de detrás (lo que la GPU aproxima con ΔL). C, D y la envolvente,
 * como `interfaceTwin.ts`; G, el gris con la compensación nominal del equipo y el hígado puro a 100.
 * Lo usa `pleuraTwin.test.ts` (lento) para las métricas del banco de la decisión 61 antes de la GPU.
 */
import { Interface } from '../../anatomy/interfaces';
import { WALL as WALL_LAYERS, preperitonealMm } from '../../anatomy/organs/wall';
import { TISSUES, Tissue, attenuationDbPerCm } from '../../anatomy/tissues';
import type { Vec3 } from '../../core/vec3';
import { lateralFwhmMm } from '../../ultrasound/beamModel';
import { greyOfLevel, levelOfGrey } from '../../ultrasound/greyMap';
import { interfaceEchoField } from '../../ultrasound/interfaceEcho';
import {
  CURTAIN_MIN_AIR,
  WALL_COPY_FACE_GAIN,
  curtainAirFraction,
  curtainEdgeSigmaMm,
  elevSigmaMm,
  pleuraCoherence,
  pleuraTerms,
  slidingField,
} from '../../ultrasound/pleura';
import { RECEIVER_NOISE } from '../../ultrasound/receiver';
import {
  TISSUE_SALT_STEP,
  anchoredClumpGain,
  anchoredSliceField,
  heterogeneityDb,
  type SpeckleAnchor,
} from '../../ultrasound/speckleField';

export const LINES = 192;
export const HALF = (34 * Math.PI) / 180;
export const RC = 60;
export const FINE = 1024;
const LATTICE = 0.42;
export const FOCUS = 90;
const ELEV_FOCUS = 80;
const F_B = 2.5;
const DR_DB = 70;
const K0 = (2 * Math.PI) / (1540 / 3.5e3);
const Y_LIVER = levelOfGrey(100 / 255);
/** Techo de la compensación nominal + TGC (dB), el del renderizador. */
const TGC_CAP_DB = 50;

/** Pared del adulto de referencia (mm): la pleura está a WALL[2] bajo la cara, en y. */
export const WALL = [2, 16, 28] as const;
const CAPSULE_MM = 0.8;
/**
 * Caras de la pared plana (decisión 62, `organs/wall.ts` sin ondulación, en la pared lateral): profundidad de
 * cada una bajo la cara. La transversalis deja la grasa preperitoneal del hábito encima de la pleura.
 */
const TRANSVERSALIS = WALL[2] - preperitonealMm(WALL[1] - WALL[0]);
const FACES: readonly (readonly [Interface, number])[] = [
  [Interface.SkinFat, WALL[0]],
  [Interface.Scarpa, WALL[0] + WALL_LAYERS.scarpaFraction * (WALL[1] - WALL[0])],
  [Interface.DeepFascia, WALL[1]],
  [Interface.ObliquePlane, WALL[1] + WALL_LAYERS.planeFractions[0] * (TRANSVERSALIS - WALL[1])],
  [Interface.TransversusPlane, TRANSVERSALIS - WALL_LAYERS.planeFractions[1] * (TRANSVERSALIS - WALL[1])],
  [Interface.Transversalis, TRANSVERSALIS],
  [Interface.Peritoneum, WALL[2]],
];

/**
 * Cara de la capa que dibuja la muestra de la pared a la profundidad y y su distancia (`wallFace` de la
 * anatomía: la más cercana de su capa, a igualdad la de fuera); null fuera de la pared.
 */
function flatWallFace(y: number): [Interface, number] | null {
  if (y < 0 || y >= WALL[2]) return null;
  if (y < WALL[0]) return [Interface.SkinFat, WALL[0] - y];
  // las caras que conoce cada capa: grasa, piel/Scarpa/fascia; músculo, fascia/planos/transversalis; grasa
  // preperitoneal, transversalis/peritoneo
  const own = y < WALL[1] ? [0, 1, 2] : y < TRANSVERSALIS ? [2, 3, 4, 5] : [5, 6];
  let best: [Interface, number] = [FACES[own[0]][0], Math.abs(y - FACES[own[0]][1])];
  for (const k of own.slice(1)) {
    const dist = Math.abs(y - FACES[k][1]);
    if (dist < best[1]) best = [FACES[k][0], dist];
  }
  return best;
}

export const thetaOf = (u: number): number => -HALF + (2 * HALF * (u + 0.5)) / LINES;
const linePitch = (r: number): number => (RC + r) * ((2 * HALF) / (LINES - 1));
const latSigmaMm = (r: number): number => lateralFwhmMm(r, FOCUS) / 2.3548;
/** Distancia de la línea θ a la pleura (plano y = 28 mm bajo la cara). */
export const pleuraDepth = (th: number): number => (RC + WALL[2]) / Math.cos(th) - RC;
/** Posición lateral (mm) del cruce de la línea θ con la pleura: la z anatómica de este gemelo. */
export const pleuraLateral = (th: number): number => (RC + pleuraDepth(th)) * Math.sin(th);

export interface PleuraTwinOpts {
  depth?: number;
  seed?: number;
  /** Borde de la cortina en la coordenada lateral de la pleura (mm); −∞: cortina entera, +∞: sin cortina. */
  edgeMm: number;
  /** Descenso del pulmón (mm): mueve el deslizamiento, no la pared. */
  caudalMm?: number;
  /** Semilla del ruido del receptor (cada cuadro, otra). */
  noiseSeed?: number;
  /** Qué partes del pulmón se suman (todas por omisión): para separar su contribución en la neblina. */
  parts?: { pleura?: boolean; series?: boolean; sliding?: boolean; tissue?: boolean };
}

export interface PleuraTwinOut {
  env: Float32Array;
  nv: number;
  dr: number;
  depth: number;
  /** Por línea: distancia a la pleura, fracción de aire e incidencia (rad). */
  D: Float64Array;
  fAir: Float64Array;
}

/** Tejido de la pared plana en la profundidad y (mm bajo la cara). */
function wallTissue(y: number): Tissue {
  if (y < 0) return Tissue.Air;
  if (y < WALL[0]) return Tissue.Skin;
  if (y < WALL[1]) return Tissue.Fat;
  if (y < TRANSVERSALIS) return Tissue.Muscle;
  if (y < WALL[2]) return Tissue.Fat;
  if (y < WALL[2] + CAPSULE_MM) return Tissue.LiverCapsule;
  return Tissue.Liver;
}

/** Transmisión de amplitud ida y vuelta hasta r por la línea θ (sin la cortina: la del tejido de detrás). */
function transmission(th: number, r: number): number {
  const c = Math.cos(th);
  const yOf = (rr: number) => (RC + rr) * c - RC;
  const y = yOf(r);
  // longitudes en cada capa a lo largo de la línea (capas planas: espesor / cosθ)
  const bounds = [0, WALL[0], WALL[1], TRANSVERSALIS, WALL[2], Infinity];
  const tissues = [Tissue.Skin, Tissue.Fat, Tissue.Muscle, Tissue.Fat, Tissue.Liver];
  const y0 = yOf(0);
  let db = 0;
  for (let i = 0; i < tissues.length; i++) {
    const a = Math.max(bounds[i], y0);
    const b = Math.min(bounds[i + 1], y);
    if (b > a) db += 2 * attenuationDbPerCm(tissues[i], F_B) * ((b - a) / c / 10);
  }
  return 10 ** (-db / 20);
}

function rot(seed: number): [Vec3, Vec3, Vec3] {
  const ax = 0.37 + seed * 0.11;
  const ay = 0.61 + seed * 0.07;
  const az = 0.23 + seed * 0.13;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  return [
    [cy * cz, sx * sy * cz + cx * sz, -cx * sy * cz + sx * sz],
    [-cy * sz, -sx * sy * sz + cx * cz, cx * sy * sz + sx * cz],
    [sy, -sx * cy, cx * cy],
  ];
}

/** Generador determinista (mulberry32) para el ruido del receptor. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulatePleura(o: PleuraTwinOpts): PleuraTwinOut {
  const depth = o.depth ?? 180;
  const dr = depth / FINE;
  const seed = o.seed ?? 1;
  const caudal = o.caudalMm ?? 0;
  const [a, b, e] = rot(seed);
  const O: Vec3 = [13.7 * seed + 3.1, -7.3 * seed + 41.9, 5.5 * seed + 17.3];
  const anchor: SpeckleAnchor = { e, p: O, parity: 0 };
  const st = { a: anchor, b: anchor, w: 1 };
  const salt = ((seed * 131) % 1000) / 7;
  const embed = (x: number, y: number): Vec3 => [O[0] + x * a[0] + y * b[0], O[1] + x * a[1] + y * b[1], O[2] + x * a[2] + y * b[2]];
  const noise = rng(o.noiseSeed ?? 7);
  const parts = { pleura: true, series: true, sliding: true, tissue: true, ...o.parts };
  /** Campo de la pasada B de un tejido en (x, y): el plano central o los tres planos de elevación. */
  const fieldAt = (x: number, y: number, r: number, planes: boolean): [number, number] => {
    const t = wallTissue(y);
    const back = TISSUES[t].backscatter;
    if (back <= 0) return [0, 0];
    const se = elevSigmaMm(r, ELEV_FOCUS);
    const m = embed(x, y);
    const s = salt + t * TISSUE_SALT_STEP;
    let g = back;
    if (t === Tissue.Liver || t === Tissue.Muscle) g *= 10 ** (heterogeneityDb(m, salt) / 20);
    const clump = TISSUES[t].speckleClump ?? 0;
    if (clump > 0) g *= anchoredClumpGain(m, se, clump, salt, t * TISSUE_SALT_STEP, st);
    const f0 = anchoredSliceField(m, LATTICE, se, s, anchor);
    if (!planes) return [f0[0] * g, f0[1] * g];
    const f1 = anchoredSliceField([m[0] + e[0] * se, m[1] + e[1] * se, m[2] + e[2] * se], LATTICE, se, s, anchor);
    const f2 = anchoredSliceField([m[0] - e[0] * se, m[1] - e[1] * se, m[2] - e[2] * se], LATTICE, se, s, anchor);
    const l0 = Math.hypot(f0[0], f0[1]);
    const side = 0.5 * l0 + 0.25 * (Math.hypot(f1[0], f1[1]) + Math.hypot(f2[0], f2[1]));
    return l0 > 1e-6 ? [(f0[0] * side * g) / l0, (f0[1] * side * g) / l0] : [0, 0];
  };
  /** Eco de la cápsula (cara de un lado, la cápsula es su dueña) en y. */
  const capsuleEcho = (y: number, cosI: number): number =>
    y >= WALL[2] && y < WALL[2] + CAPSULE_MM ? interfaceEchoField(Interface.LiverCapsule, cosI, 1, (y - WALL[2]) / cosI, K0) : 0;
  /** Eco de la cara de la capa de la pared en y (planas: |∇| = 1, incidencia la de la línea). */
  const wallEcho = (y: number, cosI: number): number => {
    const f = flatWallFace(y);
    return f ? interfaceEchoField(f[0], cosI, 1, f[1] / cosI, K0) : 0;
  };
  const nv = FINE;
  const raw = new Float32Array(nv * LINES * 2);
  const Ds = new Float64Array(LINES);
  const fAirs = new Float64Array(LINES);
  for (let u = 0; u < LINES; u++) {
    const th = thetaOf(u);
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const D = pleuraDepth(th);
    const xP = pleuraLateral(th);
    const sigma = curtainEdgeSigmaMm(elevSigmaMm(D, ELEV_FOCUS) * Math.SQRT1_2, latSigmaMm(D), 0, c);
    const fAir = curtainAirFraction(xP - o.edgeMm, sigma);
    const curtain = fAir >= CURTAIN_MIN_AIR;
    Ds[u] = D;
    fAirs[u] = curtain ? fAir : 0;
    const tD = transmission(th, D);
    const T = (d: number) => transmission(th, Math.min(d, D));
    const pD: Vec3 = [0, 0, xP];
    for (let v = 0; v < nv; v++) {
      const r = (v + 0.5) * dr;
      const x = (RC + r) * sn;
      const y = (RC + r) * c - RC;
      const under = curtain && r > D;
      let re = 0;
      let im = 0;
      const wTissue = under ? 1 - fAir : 1;
      if (wTissue >= CURTAIN_MIN_AIR && (parts.tissue || !under)) {
        const f = fieldAt(x, y, r, true);
        const tr = transmission(th, r);
        re += (f[0] + capsuleEcho(y, c) + wallEcho(y, c)) * tr * wTissue;
        im += f[1] * tr * wTissue;
      }
      if (curtain) {
        let ar = 0;
        let ai = 0;
        for (const term of pleuraTerms(r, D, tD, pleuraCoherence(c, K0), T)) {
          if (term.family === 'pleura') {
            if (parts.pleura) ar += term.gain * interfaceEchoField(Interface.PleuraWall, c, 1, term.depth, K0);
            continue;
          }
          if (!parts.series) continue;
          const d = term.depth;
          const yd = (RC + d) * c - RC;
          const f = fieldAt((RC + d) * sn, yd, d, false);
          // la copia de la pared lleva el eco de cara plana de sus capas (wallFaceEchoFlat de la GPU, degradado
          // en el camino de la reverberación: WALL_COPY_FACE_GAIN)
          ar += (f[0] + WALL_COPY_FACE_GAIN * wallEcho(yd, c)) * term.gain;
          ai += f[1] * term.gain;
        }
        if (under && parts.sliding) {
          const s = slidingField(pD, [0, -1, 0], caudal, r - D, salt);
          ar += s[0] * tD;
          ai += s[1] * tD;
        }
        re += fAir * ar;
        im += fAir * ai;
      }
      // ruido del receptor, nuevo en cada cuadro
      const n1 = Math.max(1e-12, noise());
      const n2 = noise();
      const rad = Math.sqrt(-2 * Math.log(n1)) * RECEIVER_NOISE;
      const i = v * LINES + u;
      raw[i * 2] = re + rad * Math.cos(2 * Math.PI * n2);
      raw[i * 2 + 1] = im + rad * Math.sin(2 * Math.PI * n2);
    }
  }
  // C: axial, energía unidad
  const sAx = Math.max(0.6, 0.26 / dr);
  const RA = Math.min(12, Math.ceil(sAx * 2.5));
  const wA = Array.from({ length: 2 * RA + 1 }, (_, k) => Math.exp(-0.5 * ((k - RA) / sAx) ** 2));
  const nA = Math.hypot(...wA);
  const ax = new Float32Array(raw.length);
  for (let v = 0; v < nv; v++)
    for (let u = 0; u < LINES; u++) {
      let re = 0;
      let im = 0;
      for (let k = -RA; k <= RA; k++) {
        const j = (Math.min(nv - 1, Math.max(0, v + k)) * LINES + u) * 2;
        re += wA[k + RA] * raw[j];
        im += wA[k + RA] * raw[j + 1];
      }
      ax[(v * LINES + u) * 2] = re / nA;
      ax[(v * LINES + u) * 2 + 1] = im / nA;
    }
  // D: lateral por profundidad y envolvente
  const env = new Float32Array(nv * LINES);
  for (let v = 0; v < nv; v++) {
    const r = (v + 0.5) * dr;
    const sT = Math.max(0.35, latSigmaMm(r) / linePitch(r));
    const RL = Math.min(14, Math.ceil(sT * 2.5));
    const wL = Array.from({ length: 2 * RL + 1 }, (_, k) => Math.exp(-0.5 * ((k - RL) / sT) ** 2));
    const nL = Math.hypot(...wL);
    for (let u = 0; u < LINES; u++) {
      let re = 0;
      let im = 0;
      for (let k = -RL; k <= RL; k++) {
        const j = (v * LINES + Math.min(LINES - 1, Math.max(0, u + k))) * 2;
        re += wL[k + RL] * ax[j];
        im += wL[k + RL] * ax[j + 1];
      }
      env[v * LINES + u] = (Math.hypot(re, im) / nL) * 1.1283792;
    }
  }
  return { env, nv, dr, depth, D: Ds, fAir: fAirs };
}

/** Mediana de la envolvente del hígado puro con transmisión 1 (la referencia del gris 100). */
export function liverReference(seed = 1): number {
  const o = simulatePleura({ edgeMm: Infinity, seed });
  const vals: number[] = [];
  for (let v = 0; v < o.nv; v++) {
    const r = (v + 0.5) * o.dr;
    if (r < 60 || r > 120) continue;
    for (let u = 30; u < LINES - 30; u++) vals.push(o.env[v * LINES + u] / transmission(thetaOf(u), r));
  }
  vals.sort((x, y) => x - y);
  return vals[vals.length >> 1];
}

/** Gris mostrado de la envolvente a la profundidad r: compensación nominal (hígado) y el hígado puro a 100. */
export function greyAt(env: number, r: number, liverMed: number): number {
  const comp = Math.min(TGC_CAP_DB, 2 * attenuationDbPerCm(Tissue.Liver, F_B) * (r / 10));
  const y = Y_LIVER + (20 * Math.log10(Math.max(env, 1e-12) / liverMed) + comp) / DR_DB;
  return 255 * greyOfLevel(Math.min(1, Math.max(0, y)));
}

/** Nivel mostrado en dB (sin recortar) de la envolvente, sobre la mediana del hígado puro. */
export function levelDbAt(env: number, r: number, liverMed: number): number {
  const comp = Math.min(TGC_CAP_DB, 2 * attenuationDbPerCm(Tissue.Liver, F_B) * (r / 10));
  return 20 * Math.log10(Math.max(env, 1e-12) / liverMed) + comp;
}

/** Envolvente de la línea u a la profundidad r, interpolada entre muestras. */
export function envAt(o: PleuraTwinOut, u: number, r: number): number {
  const x = r / o.dr - 0.5;
  const i = Math.max(0, Math.min(o.nv - 2, Math.floor(x)));
  const f = Math.min(1, Math.max(0, x - i));
  return o.env[i * LINES + u] * (1 - f) + o.env[(i + 1) * LINES + u] * f;
}

export const median = (a: readonly number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : Number.NaN;
};

/** Anchura (mm) a media altura de la autocorrelación de la envolvente (sin la media), en una lista de tramos. */
export function acfWidthMm(series: readonly (readonly number[])[], stepMm: number, maxLag = 30): number {
  const acc = new Float64Array(maxLag + 1);
  let n = 0;
  for (const s of series) {
    if (s.length < maxLag + 4) continue;
    const m = s.reduce((x, y) => x + y, 0) / s.length;
    const vr = s.reduce((x, y) => x + (y - m) ** 2, 0) / s.length;
    if (!(vr > 0)) continue;
    for (let l = 0; l <= maxLag; l++) {
      let c = 0;
      for (let i = 0; i + l < s.length; i++) c += (s[i] - m) * (s[i + l] - m);
      acc[l] += c / (s.length - l) / vr;
    }
    n++;
  }
  for (let l = 0; l <= maxLag; l++) acc[l] /= n;
  for (let l = 1; l <= maxLag; l++)
    if (acc[l] < 0.5) {
      const f = (acc[l - 1] - 0.5) / (acc[l - 1] - acc[l]);
      return 2 * (l - 1 + f) * stepMm;
    }
  return 2 * maxLag * stepMm;
}

/** Correlación de Pearson. */
export function pearson(a: readonly number[], b: readonly number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < a.length; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}
