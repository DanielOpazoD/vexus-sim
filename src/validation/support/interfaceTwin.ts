/**
 * Gemelo en CPU de las pasadas B → C → D → G del modo B para los ecos de interfaz (decisión 57), sobre
 * escenas 2D extruidas en elevación. Lo usa `interfaceTwin.test.ts`; nació en el diseño del PR 5 de la
 * tanda 1.5 (`design-spec/final/lib2.ts`) y aquí usa las funciones de producción:
 *  - B: el medio anclado de tres planos de `speckleField.ts` (`anchoredSliceField`) y el eco de
 *    `interfaceEcho.ts` (`interfaceEchoField`, gemelo exacto de la GLSL, con `curvatureCoherence` en las
 *    caras de tubo); el espejo de A0 en el cruce exacto (`mirrorCrossing`) y la pleura desde él;
 *  - C: gaussiana axial de σ = max(0,6; 0,26/dr) muestras, truncada a ±12 y de energía unidad;
 *  - D: gaussiana lateral de σ = max(0,35; σ_PSF/paso de línea) líneas (`lateralFwhmMm`), ±14, energía
 *    unidad, y envolvente ×2/√π;
 *  - G: gris de `greyMap.ts` con el hígado a 100 y 70 dB de rango.
 * El modelo `today` es la regla de antes (spec·cos⁴ en la muestra con bd < max(cosθ; 0,15)·dr, con el
 * espejo en el centro de la primera celda gruesa de pulmón): la prueba de regresión la usa.
 * La curvatura de cada cara entra con sus κ lateral y elevacional analíticos (la escena los da).
 */
import { INTERFACES, Interface, LAST_TUBE_INTERFACE } from '../../anatomy/interfaces';
import { lateralFwhmMm } from '../../ultrasound/beamModel';
import { greyOfLevel, levelOfGrey } from '../../ultrasound/greyMap';
import { IFACE_K_DB, curvatureCoherence, faceProfile, interfaceEchoField } from '../../ultrasound/interfaceEcho';
import { anchoredSliceField, hash13, type SpeckleAnchor } from '../../ultrasound/speckleField';
import { mirrorCrossing } from '../../ultrasound/transmission';
import type { Vec3 } from '../../core/vec3';

export type V2 = [number, number];

export const LINES = 192;
export const HALF = (34 * Math.PI) / 180;
export const RC = 60;
export const FINE = 1024;
export const COARSE = 160;
const LAT = 0.42;
export const FOCUS = 90;
const EFOCUS = 80;
export const DR_DB = 70;
/** Número de onda (1/mm) a 3,5 MHz, el de `beamModel` (λ = 0,44 mm). */
export const K0 = (2 * Math.PI) / (1540 / 3.5e3);
const Y_LIVER = levelOfGrey(100 / 255);

export const elevSigma = (r: number): number => 1.6 * Math.sqrt(1 + ((r - EFOCUS) / 45) ** 2);
export const thetaOf = (u: number): number => -HALF + (2 * HALF * (u + 0.5)) / LINES;
export const lineDir = (th: number): V2 => [Math.sin(th), Math.cos(th)];
export const posOn = (th: number, r: number): V2 => [(RC + r) * Math.sin(th), (RC + r) * Math.cos(th) - RC];
export const linePitch = (r: number): number => (RC + r) * ((2 * HALF) / (LINES - 1));
export const latSigmaMm = (r: number, focus = FOCUS): number => lateralFwhmMm(r, focus) / 2.3548;

/** Ganancia coherente de la pasada D para un reflector continuo (Σw/√Σw²), como FRAG_LATERAL. */
export function lateralCoherentGain(r: number, focus = FOCUS): number {
  const sT = Math.max(0.35, latSigmaMm(r, focus) / linePitch(r));
  const R = Math.min(14, Math.ceil(sT * 2.5));
  let s1 = 0;
  let s2 = 0;
  for (let k = -R; k <= R; k++) {
    const w = Math.exp(-0.5 * (k / sT) ** 2);
    s1 += w;
    s2 += w * w;
  }
  return s1 / Math.sqrt(s2);
}

/** Clasificación de un punto de la escena 2D. */
export interface Cls {
  back: number;
  /** Heterogeneidad lenta del parénquima (hígado y músculo). */
  het: boolean;
  kind: string;
  n: V2;
  /** Regla de antes: distancia al borde y reflectividad especular del tejido. */
  bd: number;
  specOld: number;
  /** Eco de interfaz: la cara que dibuja la muestra y su distancia a ella, con las curvaturas del haz. */
  face?: Interface;
  ifd?: number;
  kl?: number;
  ke?: number;
}

export interface Scene {
  classify(p: V2): Cls;
}

export interface SimOpts {
  model: 'today' | 'echo';
  kDb?: number;
  depth?: number;
  focus?: number;
  seed?: number;
  r0: number;
  r1: number;
  /** Espejo en el primer pulmón de la línea (la pleura se dibuja desde él en el modelo `echo`). */
  mirror?: boolean;
  speckleGain?: number;
  /** Solo el perfil de la cara con amplitud `beta` (calibración de β). */
  unitS?: { beta: number };
}

export interface SimOut {
  env: Float32Array;
  v0: number;
  nv: number;
  dr: number;
  cls: Cls[];
  reflected: Uint8Array;
}

function rot(ax: number, ay: number, az: number): [Vec3, Vec3, Vec3] {
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  const cz = Math.cos(az);
  const sz = Math.sin(az);
  return [
    [cy * cz, sx * sy * cz + cx * sz, -cx * sy * cz + sx * sz],
    [-cy * sz, -sx * sy * sz + cx * cz, cx * sy * sz + sx * cz],
    [sy, -sx * cy, cx * cy],
  ];
}

/** Eco de interfaz de una muestra del modelo `echo` (0 sin cara o fuera de su alcance). */
function echoAt(c: Cls, cosI: number, r: number, o: SimOpts, focus: number): number {
  if (c.face === undefined || c.ifd === undefined) return 0;
  const delta = c.ifd / Math.max(cosI, 1e-9);
  if (o.unitS) return cosI < 0.05 ? 0 : o.unitS.beta * faceProfile(delta, INTERFACES[c.face].twoSided);
  const curv =
    c.face <= LAST_TUBE_INTERFACE ? curvatureCoherence(latSigmaMm(r, focus), elevSigma(r) / Math.SQRT2, c.kl ?? 0, c.ke ?? 0, K0) : 1;
  return interfaceEchoField(c.face, cosI, curv, delta, K0, o.kDb ?? IFACE_K_DB);
}

export function simulate(scene: Scene, o: SimOpts): SimOut {
  const depth = o.depth ?? 180;
  const focus = o.focus ?? FOCUS;
  const dr = depth / FINE;
  const coarseStep = depth / COARSE;
  const seed = o.seed ?? 1;
  const [a, b, e] = rot(0.37 + seed * 0.11, 0.61 + seed * 0.07, 0.23 + seed * 0.13);
  const O: Vec3 = [13.7 * seed + 3.1, -7.3 * seed + 41.9, 5.5 * seed + 17.3];
  const anchor: SpeckleAnchor = { e, p: O, parity: 0 };
  const salt = ((seed * 131) % 1000) / 7;
  const embed = (p: V2): Vec3 => [O[0] + p[0] * a[0] + p[1] * b[0], O[1] + p[0] * a[1] + p[1] * b[1], O[2] + p[0] * a[2] + p[1] * b[2]];
  const v0 = Math.max(0, Math.floor(o.r0 / dr) - 24);
  const v1 = Math.min(FINE, Math.ceil(o.r1 / dr) + 24);
  const nv = v1 - v0;
  const raw = new Float32Array(nv * LINES * 2);
  const cls: Cls[] = new Array<Cls>(nv * LINES);
  const reflected = new Uint8Array(nv * LINES);
  const sg = o.speckleGain ?? 1;
  const echo = o.model === 'echo';
  for (let u = 0; u < LINES; u++) {
    const th = thetaOf(u);
    const d0 = lineDir(th);
    let mirrorHit = -1;
    let dRefl: V2 = d0;
    if (o.mirror) {
      for (let s = 0; s < COARSE; s++) {
        const r = (s + 0.5) * coarseStep;
        if (scene.classify(posOn(th, r)).kind !== 'lung') continue;
        // hoy, el centro del primer segmento grueso de pulmón; con los ecos, el cruce exacto (A0)
        const isLung = (x: number) => scene.classify(posOn(th, x)).kind === 'lung';
        mirrorHit = echo ? mirrorCrossing(isLung, r, coarseStep) : r;
        let nn = scene.classify(posOn(th, mirrorHit)).n;
        if (nn[0] * d0[0] + nn[1] * d0[1] > 0) nn = [-nn[0], -nn[1]];
        const dd = d0[0] * nn[0] + d0[1] * nn[1];
        dRefl = [d0[0] - 2 * dd * nn[0], d0[1] - 2 * dd * nn[1]];
        break;
      }
    }
    for (let v = v0; v < v1; v++) {
      const r = (v + 0.5) * dr;
      const refl = mirrorHit >= 0 && r > mirrorHit;
      const dir: V2 = refl ? dRefl : d0;
      const p: V2 = refl
        ? [posOn(th, mirrorHit)[0] + dir[0] * (r - mirrorHit), posOn(th, mirrorHit)[1] + dir[1] * (r - mirrorHit)]
        : posOn(th, r);
      const c = scene.classify(p);
      const se = elevSigma(r);
      const m = embed(p);
      let het = 1;
      if (c.het) {
        const q: Vec3 = [Math.floor(m[0] / 6.25) + salt + 11, Math.floor(m[1] / 6.25) + salt + 11, Math.floor(m[2] / 6.25) + salt + 11];
        het = Math.pow(10, ((hash13(q) - 0.5) * 4) / 20);
      }
      const g = c.back * het * sg;
      let re = 0;
      let im = 0;
      if (g > 0) {
        const f0 = anchoredSliceField(m, LAT, se, salt, anchor);
        const f1 = anchoredSliceField([m[0] + e[0] * se, m[1] + e[1] * se, m[2] + e[2] * se], LAT, se, salt, anchor);
        const f2 = anchoredSliceField([m[0] - e[0] * se, m[1] - e[1] * se, m[2] - e[2] * se], LAT, se, salt, anchor);
        const l0 = Math.hypot(f0[0], f0[1]) * g;
        const sideMag = 0.5 * l0 + 0.25 * (Math.hypot(f1[0], f1[1]) + Math.hypot(f2[0], f2[1])) * g;
        re = l0 > 1e-6 ? f0[0] * g * (sideMag / l0) : f0[0] * g;
        im = l0 > 1e-6 ? f0[1] * g * (sideMag / l0) : f0[1] * g;
      }
      const cosI = Math.abs(c.n[0] * dir[0] + c.n[1] * dir[1]);
      if (!echo) {
        const win = Math.max(cosI, 0.15) * dr;
        re += c.specOld * Math.pow(cosI, 4) * (c.bd < win ? 1 : 0) * 0.5;
      } else {
        re += echoAt(c, cosI, r, o, focus);
        // pleura: centrada en el cruce exacto del espejo, con el coseno de la reflexión
        if (mirrorHit >= 0 && !o.unitS) {
          const cm = Math.sqrt(Math.max(0, 0.5 * (1 - (d0[0] * dRefl[0] + d0[1] * dRefl[1]))));
          re += interfaceEchoField(Interface.Pleura, cm, 1, r - mirrorHit, K0, o.kDb ?? IFACE_K_DB);
        }
      }
      const i = (v - v0) * LINES + u;
      raw[i * 2] = re;
      raw[i * 2 + 1] = im;
      cls[i] = c;
      reflected[i] = refl ? 1 : 0;
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
    const r = (v + v0 + 0.5) * dr;
    const sT = Math.max(0.35, latSigmaMm(r, focus) / linePitch(r));
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
  return { env, v0, nv, dr, cls, reflected };
}

export const median = (a: readonly number[]): number => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};
export const mean = (a: readonly number[]): number => a.reduce((s, x) => s + x, 0) / a.length;

/** Envolvente de la línea u a la profundidad r, interpolada entre muestras (NaN fuera). */
export function envAt(o: SimOut, u: number, r: number): number {
  const x = r / o.dr - 0.5 - o.v0;
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= o.nv) return NaN;
  const f = x - i;
  return o.env[i * LINES + u] * (1 - f) + o.env[(i + 1) * LINES + u] * f;
}

/** Gris mostrado con el hígado a 100 (mediana de su envolvente `liverMed`) y 70 dB de rango. */
export const grayOf = (env: number, liverMed: number): number => {
  const y = Math.min(1, Math.max(0, Y_LIVER + (20 * Math.log10(Math.max(env, 1e-9) / liverMed)) / DR_DB));
  return 255 * greyOfLevel(y);
};

/** Hígado puro: mediana, media y RMS de la envolvente y su SNR (retrodispersión 1, sin heterogeneidad). */
export function liverStats(depth = 180, seeds = [1, 2, 3], rc = 80): { median: number; mean: number; rms: number; snr: number } {
  const sc: Scene = { classify: () => ({ back: 1, het: false, kind: 'liver', n: [0, 1], bd: 1e3, specOld: 0.5 }) };
  const envs: number[] = [];
  for (const seed of seeds) {
    const o = simulate(sc, { model: 'echo', r0: rc - 8, r1: rc + 8, seed, depth });
    for (let v = 24; v < o.nv - 24; v++) for (let u = 20; u < LINES - 20; u++) envs.push(o.env[v * LINES + u]);
  }
  const me = mean(envs);
  const sd = Math.sqrt(mean(envs.map((x) => (x - me) ** 2)));
  return { median: median(envs), mean: me, rms: Math.sqrt(mean(envs.map((x) => x * x))), snr: me / sd };
}

/**
 * Cara en arco centrada en el centro de curvatura: incidencia normal exacta en todas las líneas. De dos
 * lados es la luz de una vena; de uno, la cápsula (su perfil entra 2,5σh en el dueño, `rr < R`).
 */
export function arcFace(R: number, twoSided = true): Scene {
  return {
    classify(p) {
      const q: V2 = [p[0], p[1] + RC];
      const l = Math.hypot(q[0], q[1]);
      const rr = l - RC;
      const n: V2 = [q[0] / l, q[1] / l];
      const face = twoSided ? Interface.VeinLumen : Interface.LiverCapsule;
      if (rr < R) return { back: 0, het: false, kind: 'owner', n, bd: R - rr, specOld: 0, face, ifd: R - rr };
      if (twoSided) return { back: 0, het: false, kind: 'other', n, bd: rr - R, specOld: 0, face, ifd: rr - R };
      return { back: 0, het: false, kind: 'other', n, bd: rr - R, specOld: 0 };
    },
  };
}

/** Pico mediano (líneas centrales) del eco de una cara en arco con amplitud `beta`, sin moteado. */
export function arcPeak(depth: number, rFace: number, beta: number, twoSided = true, stepMm = 0.02, every = 1): number {
  const o = simulate(arcFace(rFace, twoSided), { model: 'echo', depth, r0: rFace - 4, r1: rFace + 4, unitS: { beta }, speckleGain: 0 });
  const peaks: number[] = [];
  for (let u = 40; u < LINES - 40; u += every) {
    let pk = 0;
    for (let r = rFace - 2; r <= rFace + 2; r += stepMm) pk = Math.max(pk, envAt(o, u, r) || 0);
    peaks.push(pk);
  }
  return median(peaks);
}

/** β: campo por unidad de S tal que el pico de una cara continua normal a `rFace` = S × RMS del hígado. */
export function calibrateBeta(depth: number, rFace = 80, twoSided = true): { beta: number; peak: number; liverRms: number } {
  const peak = arcPeak(depth, rFace, 1, twoSided);
  const liverRms = liverStats(depth, [1, 2], rFace).rms;
  return { beta: liverRms / peak, peak, liverRms };
}

// ——— Escenas del diseño (s = pendiente rms verdadera, la tabla de `interfaces.ts`) ———

/** Retrodispersión de los tejidos de las escenas (la de TISSUES, redondeada). */
export const BACK = {
  liver: 1.0,
  capsule: 1.3,
  wallThin: 0.7,
  wallPortal: 2.6,
  blood: 0.008,
  muscle: 0.5,
  diaphragm: 1.2,
  perirenal: 1.5,
  renalCapsule: 2.4,
  cortex: 0.72,
};

const liverCls = (n: V2): Cls => ({ back: BACK.liver, het: true, kind: 'liver', n, bd: 1e3, specOld: 0.5 });
const normalOf = (phiDeg: number): V2 => [Math.sin((phiDeg * Math.PI) / 180), Math.cos((phiDeg * Math.PI) / 180)];

/** Pared plana de un vaso longitudinal de radio `a` (su curvatura va por la elevación): hígado | pared t | sangre. */
export function planarWall(D: number, phiDeg: number, t: number, wallBack: number, specOld: number, face: Interface, a: number): Scene {
  const n = normalOf(phiDeg);
  const ke = 1 / a;
  return {
    classify(p) {
      const s = p[0] * n[0] + (p[1] - D) * n[1];
      if (s < 0) return liverCls(n);
      const hitd = t - s;
      if (hitd > 0)
        return { back: wallBack, het: false, kind: 'wall', n, bd: Math.min(hitd, t - hitd), specOld, face, ifd: hitd, kl: 0, ke };
      return { back: BACK.blood, het: false, kind: 'blood', n, bd: -hitd, specOld, face, ifd: -hitd, kl: 0, ke };
    },
  };
}

/** Vaso en corte transversal (círculo de radio `rad` en el plano: curvatura lateral). */
export function circleVessel(c: V2, rad: number, t: number, wallBack: number, specOld: number, face: Interface): Scene {
  const kl = 1 / rad;
  return {
    classify(p) {
      const dx = p[0] - c[0];
      const dy = p[1] - c[1];
      const dist = Math.hypot(dx, dy);
      const n: V2 = [dx / dist, dy / dist];
      const hitd = dist - rad;
      if (hitd >= t) return liverCls(n);
      if (hitd >= 0)
        return { back: wallBack, het: false, kind: 'wall', n, bd: Math.min(hitd, t - hitd), specOld, face, ifd: hitd, kl, ke: 0 };
      return { back: BACK.blood, het: false, kind: 'blood', n, bd: -hitd, specOld, face, ifd: -hitd, kl, ke: 0 };
    },
  };
}

/** Pared abdominal (músculo) | cápsula 0,8 | hígado: la cápsula es la dueña de su cara (un lado). */
export function capsuleScene(D: number, phiDeg: number): Scene {
  const n = normalOf(phiDeg);
  return {
    classify(p) {
      const s = p[0] * n[0] + (p[1] - D) * n[1];
      if (s < 0) return { back: BACK.muscle, het: true, kind: 'muscle', n, bd: -s, specOld: 0.2 };
      if (s < 0.8) return { back: BACK.capsule, het: false, kind: 'capsule', n, bd: s, specOld: 0.5, face: Interface.LiverCapsule, ifd: s };
      return { back: BACK.liver, het: true, kind: 'liver', n, bd: s, specOld: 0.5 };
    },
  };
}

/**
 * Hígado | cápsula 0,8 | diafragma 2,5 | pulmón. La mitad abdominal del diafragma dibuja la cara
 * hepática; la cápsula junto al diafragma no dibuja nada; la pleura sale del espejo.
 */
export function diaphragmScene(D: number, phiDeg: number): Scene {
  const n = normalOf(phiDeg);
  return {
    classify(p) {
      const s = p[0] * n[0] + (p[1] - D) * n[1];
      if (s < -0.8) return { back: BACK.liver, het: true, kind: 'liver', n, bd: -s, specOld: 0.5 };
      if (s < 0) return { back: BACK.capsule, het: false, kind: 'capsule', n, bd: -s, specOld: 0.5 };
      if (s < 2.5) {
        const liverHalf = s < 1.25;
        return {
          back: BACK.diaphragm,
          het: false,
          kind: 'diaphragm',
          n,
          bd: Math.min(s, 2.5 - s),
          specOld: 0.9,
          ...(liverHalf ? { face: Interface.DiaphragmLiver, ifd: s } : {}),
        };
      }
      return { back: 0, het: false, kind: 'lung', n, bd: s - 2.5, specOld: 1.0 };
    },
  };
}

/** Morison: hígado | grasa perirrenal 4 | cápsula renal 0,6 | corteza (riñón de radio 30 mm en elevación). */
export function renalScene(D: number, phiDeg: number): Scene {
  const n = normalOf(phiDeg);
  const ke = 1 / 30;
  return {
    classify(p) {
      const s = p[0] * n[0] + (p[1] - D) * n[1];
      if (s < -4) return { back: BACK.liver, het: true, kind: 'liver', n, bd: 1e3, specOld: 0.5 };
      if (s < 0) {
        const outer = s + 4 < -s;
        return {
          back: BACK.perirenal,
          het: false,
          kind: 'perirenal',
          n,
          bd: Math.min(-s, 4 + s),
          specOld: 0.6,
          face: outer ? Interface.PerirenalFat : Interface.RenalCapsule,
          ifd: outer ? s + 4 : -s,
          kl: 0,
          ke,
        };
      }
      if (s < 0.6)
        return {
          back: BACK.renalCapsule,
          het: false,
          kind: 'renalCapsule',
          n,
          bd: Math.min(s, 0.6 - s),
          specOld: 0.9,
          face: Interface.RenalCapsule,
          ifd: s,
          kl: 0,
          ke,
        };
      return { back: BACK.cortex, het: true, kind: 'cortex', n, bd: s, specOld: 0.45 };
    },
  };
}

// ——— Banco (el de `app/fidelity.ts`, en la escena 2D) ———

/** Una línea que cruza la interfaz: incidencia, cociente de gris y pico de envolvente sobre el hígado. */
export interface BenchLine {
  u: number;
  inc: number;
  ratio: number;
  dDb: number;
  peakEnvDb: number;
  rb: number;
  rLumen: number;
}

export interface BenchOpts {
  target: (c: Cls) => boolean;
  before?: (c: Cls) => boolean;
  between?: (c: Cls) => boolean;
  refBelow?: boolean;
  /** Celdas de 0,5 mm en que se busca el objetivo tras el borde (4 por omisión). */
  maxCells?: number;
}

export function bench(scene: Scene, o: SimOut, liverMed: number, depth: number, opt: BenchOpts): BenchLine[] {
  const out: BenchLine[] = [];
  const G = 0.5;
  const nr = Math.floor(depth / G);
  const maxCells = opt.maxCells ?? 4;
  const before = opt.before ?? ((c: Cls) => c.kind === 'liver');
  const between = opt.between ?? ((c: Cls) => c.kind === 'wall');
  const lv = (g: number) => levelOfGrey(g / 255) * DR_DB;
  for (let u = 8; u < LINES - 8; u++) {
    const th = thetaOf(u);
    const cells: Cls[] = [];
    for (let k = 0; k < nr; k++) cells.push(scene.classify(posOn(th, (k + 0.5) * G)));
    let run = 0;
    for (let k = 0; k < nr - maxCells; k++) {
      if (before(cells[k])) {
        run++;
        continue;
      }
      const rr = run;
      run = 0;
      if (rr < 6) continue;
      let hit = -1;
      for (let j = 0; j < maxCells && hit < 0; j++) if (opt.target(cells[k + j])) hit = j;
      for (let j = 0; j < hit; j++) if (!between(cells[k + j])) hit = -1;
      if (hit < 0) continue;
      const cI = cells[k + hit];
      const d = lineDir(th);
      const inc = (Math.acos(Math.min(1, Math.abs(cI.n[0] * d[0] + cI.n[1] * d[1]))) * 180) / Math.PI;
      const rb = k * G;
      const rLumen = (k + hit) * G;
      if (rb < o.v0 * o.dr + 12 || rb > (o.v0 + o.nv) * o.dr - 12) break;
      let peak = 0;
      let peakEnv = 0;
      for (let r = rb - 1.5; r <= Math.max(rb + 1.0, rLumen + 0.5) + 1e-9; r += 0.05) {
        const e = envAt(o, u, r) || 0;
        peak = Math.max(peak, grayOf(e, liverMed));
        peakEnv = Math.max(peakEnv, e);
      }
      const ref: number[] = [];
      const refEnv: number[] = [];
      const [ra, rz] = opt.refBelow ? [rLumen + 3, rLumen + 10] : [rb - 10, rb - 3];
      for (let r = ra; r <= rz; r += 0.25) {
        const cc = cells[Math.floor(r / G)];
        if (cc && cc.kind === 'liver') {
          const e = envAt(o, u, r);
          ref.push(grayOf(e, liverMed));
          refEnv.push(e);
        }
      }
      if (ref.length < 8) break;
      const med = median(ref);
      out.push({ u, inc, ratio: peak / med, dDb: lv(peak) - lv(med), peakEnvDb: 20 * Math.log10(peakEnv / median(refEnv)), rb, rLumen });
      break; // primera pared de la línea
    }
  }
  return out;
}

export interface BinSummary {
  from: number;
  n: number;
  ratio: number;
  dDb: number;
  gapFrac: number;
  gapRunMm: number;
}

/** Tramos de incidencia 0–20, 20–40 y 40–60°: cociente mediano, huecos (< 6 dB) y hueco más largo. */
export function summarize(lines: readonly BenchLine[]): BinSummary[] {
  return [0, 20, 40].map((b0) => {
    const sel = lines.filter((l) => l.inc >= b0 && l.inc < b0 + 20);
    let best = 0;
    let cur = 0;
    let lastU = -10;
    for (const l of [...sel].sort((a, b) => a.u - b.u)) {
      if (l.dDb < 6) {
        cur = l.u === lastU + 1 ? cur + linePitch(l.rb) : linePitch(l.rb);
        best = Math.max(best, cur);
      } else cur = 0;
      lastU = l.u;
    }
    return {
      from: b0,
      n: sel.length,
      ratio: median(sel.map((l) => l.ratio)),
      dDb: median(sel.map((l) => l.dDb)),
      gapFrac: sel.filter((l) => l.dDb < 6).length / Math.max(1, sel.length),
      gapRunMm: best,
    };
  });
}

/**
 * Rosario: CV del pico de envolvente de cada línea dividido por la mediana de sus vecinas a ±3 líneas
 * (misma pared, mismo tramo); quita la tendencia del lóbulo y de la profundidad.
 */
export function beading(lines: readonly BenchLine[], b0: number, b1: number): number {
  const sel = lines.filter((l) => l.inc >= b0 && l.inc < b1);
  const byU = new Map<number, BenchLine>();
  for (const l of sel) byU.set(l.u, l);
  const ratios: number[] = [];
  for (const l of sel) {
    const nb: number[] = [];
    for (let du = -3; du <= 3; du++) {
      const x = byU.get(l.u + du);
      if (x) nb.push(Math.pow(10, x.peakEnvDb / 20));
    }
    if (nb.length < 5) continue;
    ratios.push(Math.pow(10, l.peakEnvDb / 20) / median(nb));
  }
  const m = mean(ratios);
  return Math.sqrt(mean(ratios.map((x) => (x - m) ** 2))) / m;
}

/**
 * Diafragma con espejo: píxeles del diafragma saturados (≥ 250) y líneas con costura (> 0,3 mm de pulmón
 * en su camino antes o después del espejo).
 */
export function diaphragmExtras(
  sc: Scene,
  o: SimOut,
  liverMed: number,
  r0: number,
  r1: number,
): { sat: number; px: number; seamLines: number; lines: number } {
  let sat = 0;
  let px = 0;
  let seamLines = 0;
  let lines = 0;
  for (let u = 8; u < LINES - 8; u++) {
    let n = 0;
    for (let v = 0; v < o.nv; v++) if (o.cls[v * LINES + u].kind === 'lung') n++;
    lines++;
    if (n * o.dr > 0.3) seamLines++;
    for (let r = r0; r < r1; r += 0.1) {
      if (sc.classify(posOn(thetaOf(u), r)).kind !== 'diaphragm') continue;
      px++;
      if (grayOf(envAt(o, u, r), liverMed) >= 250) sat++;
    }
  }
  return { sat, px, seamLines, lines };
}
