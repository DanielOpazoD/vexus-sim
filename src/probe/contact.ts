import {
  PROBE_COMPRESSION,
  compressionPlateMm,
  nodeInterp,
  nodeSin,
  type CompressionNode,
  type ProbeCompression,
} from '../anatomy/compression';
import { torsoDepth, torsoDepthGradient, type Torso } from '../anatomy/primitives';
import { length, smoothstep, type Vec3 } from '../core/vec3';
import { probeFrame, skinSoftness, type ProbeFrame, type ProbePose, type Transducer } from './probe';

/**
 * Geometría del contacto de un cuadro (decisión 63): cuánto de la cara convexa consigue apoyar el operador sobre
 * la piel y, con ello, la tabla del campo de compresión (`anatomy/compression.ts`) y el acoplamiento de cada
 * línea (acoplamiento = contacto conseguido). Sustituye al hueco ad hoc de `lineCoupling` (un radio de piel fijo
 * de 130 mm con el signo de la curvatura al revés —la piel convexa se aparta de la cara, no la acompaña— y 4 mm
 * de gel).
 *
 * Criterio de contacto, por nodo α_k de la cara (equiespaciados en sen α), con el hueco con signo de la cara a la
 * piel sin deformar por la normal de la piel (d(q)/|∇d|: < 0 la sonda hunde la piel, > 0 aire), el mayor de tres
 * puntos de la huella elevacional (la inclinación fuera del plano levanta un borde):
 *  - flotación: g_ref, el menor hueco de la cara en el plano de imagen. Si es positivo la sonda flota y la
 *    película de gel lo salva hasta `gelMm` (se apaga en `gelRampMm` más);
 *  - capacidad: el hueco relativo al punto más hundido, g_k − g_ref, se cierra hasta
 *    G = capacityMm + capacitySoftMm·blandura + capacityPerPressure·max(0, −g_ref): el tejido blando del
 *    epigastrio cede más que la pared sobre costillas (`skinSoftness`) y apretar ensancha el contacto (en un
 *    contacto de Hertz el hueco que se cierra en el borde crece con la penetración); se apaga en
 *    `capacityRampMm` más.
 * contacto_k = flotación·capacidad. [ESTIMADO: el umbral lo fija que en el abdomen plano un convexo de 60 mm de
 * radio y ±34° apoye entero con la presión normal del examen (su sagita en el borde son 10,3 mm), como en
 * cualquier equipo; ver DECISIONS 63]
 *
 * La tabla del campo, a lo largo de la normal del elemento (la línea θ = α_k): s₀ = contacto·(r_piel − b·gel), el
 * hueco a la piel sin deformar, y el desplazamiento del fondo de la placa s_W = s₀ + contacto·(b − 1)·W con
 * b = (r_W − r_piel)/W, lo que la pared mide a lo largo de la línea sobre su espesor W (así la cara interna de la
 * pared queda a W de la cara), menos la parte del hundimiento que se lleva la pared (`wallIndentationShare`), con el
 * tope `PROBE_COMPRESSION.plateShiftMaxMm`; la tabla guarda (s₀, (s_W − s₀)/W).
 */
export const CONTACT = {
  /** Película de gel (mm) que salva la flotación sin perder el acoplamiento. [ESTIMADO] */
  gelMm: 2,
  /** Se apaga en estos mm más (la sonda levantada 4,5 mm ya no acopla). [ESTIMADO] */
  gelRampMm: 2.5,
  /** Hueco relativo (mm) que la presión normal del examen cierra sobre la pared más rígida. [ESTIMADO] */
  capacityMm: 11.5,
  /** Lo que añade la blandura de la pared (0,15 sobre costillas … 0,65 en el epigastrio). [ESTIMADO] */
  capacitySoftMm: 14,
  /** mm de hueco cerrado por mm de penetración de la sonda (contacto de Hertz, orden 1). [ESTIMADO] */
  capacityPerPressure: 1,
  /** El contacto se apaga en estos mm más allá de la capacidad. [ESTIMADO] */
  capacityRampMm: 4,
  /**
   * Fracción del hundimiento de la piel (s₀ < 0: la sonda aprieta o bascula sobre ella) que se lleva la pared al
   * adelgazar; el resto empuja lo de debajo. La grasa subcutánea (1–4 kPa, de memoria) es más blanda que el hígado
   * (~5 kPa) y el músculo: con la placa rígida el talón de la subxifoidea empujaba el hígado 6 mm. [ESTIMADO 0,3–0,7]
   */
  wallIndentationShare: 0.5,
} as const;

/** La piel se busca hasta este múltiplo de W a lo largo de la línea para medir lo que la pared mide en ella. */
const PLATE_SEARCH_FACTOR = 3;
/** Estiramiento mínimo de la placa (b): la pared puede encoger a lo largo de la línea hasta la mitad, nunca invertirse. */
const MIN_PLATE_STRETCH = 0.5;

/**
 * Desplazamiento con el tope `plateShiftMaxMm` (S) y rodilla suave: x/(1 + (x/S)⁴)^¼ (≈ x hasta ~S/2, → ±S). Lo
 * llevan el fondo de la placa y, al hundir la sonda, la piel: con la sonda muy basculada (0,7 rad) las líneas del
 * talón corren casi paralelas a la piel y su cruce con ella queda a > 100 mm por detrás del elemento; sin tope el
 * material cruzaba el eje de curvatura (se plegaba).
 */
export function plateShift(x: number): number {
  const u = x / PROBE_COMPRESSION.plateShiftMaxMm;
  return x / Math.pow(1 + u * u * u * u, 0.25);
}

/** Hueco con signo (mm) del punto q de la cara a la piel sin deformar, por la normal de la piel. */
function skinGap(q: Vec3, t: Torso): number {
  return torsoDepth(q, t) / Math.max(1e-6, length(torsoDepthGradient(q, t)));
}

/** Primer cruce (mm a lo largo de la línea) del nivel `w` de profundidad radial en [r0, r1], o null. */
function firstCrossing(depthAt: (r: number) => number, w: number, r0: number, r1: number): number | null {
  const step = 1;
  let prev = r0;
  if (depthAt(r0) >= w) return r0;
  for (let r = r0 + step; r <= r1 + 1e-9; r += step) {
    if (depthAt(r) >= w) {
      let lo = prev;
      let hi = r;
      for (let i = 0; i < 24; i++) {
        const mid = 0.5 * (lo + hi);
        if (depthAt(mid) >= w) hi = mid;
        else lo = mid;
      }
      return 0.5 * (lo + hi);
    }
    prev = r;
  }
  return null;
}

/** Resumen del contacto (para la UI, el banco y las pruebas). */
export interface ContactSummary {
  /** Menor hueco de la cara en el plano de imagen (mm): > 0 la sonda flota. */
  gapRefMm: number;
  /** Capacidad G (mm) del cuadro. */
  capacityMm: number;
  /** Película de gel entre la cara y la piel (mm). */
  gelMm: number;
  /** Por nodo: hueco relativo (mm), distancia a la piel a lo largo de la línea (mm), estiramiento b sin contacto. */
  relativeGapMm: number[];
  skinAlongMm: number[];
  stretch: number[];
}

/** Contacto y tabla de compresión de un cuadro, desde la pose y su marco. */
export function probeContact(pose: ProbePose, frame: ProbeFrame, tr: Transducer, t: Torso): ProbeCompression & { summary: ContactSummary } {
  const n = PROBE_COMPRESSION.nodes;
  const half = tr.halfSector;
  const R = tr.curvatureRadius;
  const halfElev = tr.elevationMm / 2;
  const C = frame.curvatureCenter;
  const W = compressionPlateMm(t);
  const gaps: number[] = [];
  const lines: Array<{ rs: number | null; b: number }> = [];
  let gRef = Infinity;
  for (let k = 0; k < n; k++) {
    // nodos equiespaciados en σ = sen α (anatomy/compression.ts)
    const s = nodeSin(k, half);
    const c = Math.sqrt(1 - s * s);
    const dir: Vec3 = [
      frame.axial[0] * c + frame.lateral[0] * s,
      frame.axial[1] * c + frame.lateral[1] * s,
      frame.axial[2] * c + frame.lateral[2] * s,
    ];
    const E: Vec3 = [C[0] + dir[0] * R, C[1] + dir[1] * R, C[2] + dir[2] * R];
    let worst = -Infinity;
    for (const e of [-halfElev, 0, halfElev]) {
      const g = skinGap([E[0] + frame.elevation[0] * e, E[1] + frame.elevation[1] * e, E[2] + frame.elevation[2] * e], t);
      worst = Math.max(worst, g);
      // la flotación y la presión, en el plano de imagen: un borde elevacional hundido no es presión
      if (e === 0) gRef = Math.min(gRef, g);
    }
    gaps.push(worst);
    // la línea del nodo en el tronco rígido: la piel y lo que la pared mide a lo largo de ella (b)
    const depthAt = (r: number): number => -torsoDepth([E[0] + dir[0] * r, E[1] + dir[1] * r, E[2] + dir[2] * r], t);
    const rs = firstCrossing(depthAt, 0, -60, 200);
    const rW = rs === null ? null : firstCrossing(depthAt, W, rs, rs + PLATE_SEARCH_FACTOR * W);
    // una línea que roza la pared y no llega a W: la placa la estira lo que el tope permita
    lines.push({ rs, b: rs === null ? 1 : rW === null ? PLATE_SEARCH_FACTOR : (rW - rs) / W });
  }
  const hover = 1 - smoothstep(CONTACT.gelMm, CONTACT.gelMm + CONTACT.gelRampMm, gRef);
  const G = CONTACT.capacityMm + CONTACT.capacitySoftMm * skinSoftness(pose) + CONTACT.capacityPerPressure * Math.max(0, -gRef);
  const gel = Math.max(0, gRef);
  const relative = gaps.map((g) => g - gRef);
  // Lo más que la piel puede subir a lo largo de una línea: el tope de la placa más lo que la placa puede encoger
  // (b ≥ 0,5). Una línea que lo pide (> 60° de la normal de la piel, con la sonda muy basculada) no llega a apoyar
  // entera: su contacto se reduce hasta ahí. Así s_W ≤ el tope en todo nodo y la caída acaba a W + 62,5 mm.
  const riseMax = PROBE_COMPRESSION.plateShiftMaxMm + (1 - MIN_PLATE_STRETCH) * W;
  const contact = lines.map((l, k) => {
    const c = l.rs === null ? 0 : hover * (1 - smoothstep(G, G + CONTACT.capacityRampMm, relative[k]));
    const along = (l.rs ?? 0) - l.b * gel;
    return c * along > riseMax ? riseMax / along : c;
  });
  const nodes: CompressionNode[] = lines.map((l, k) => {
    // el tope de la piel, solo al hundir (al subir el tejido lo limita el contacto)
    const raw = contact[k] * ((l.rs ?? 0) - l.b * gel);
    const s0 = raw < 0 ? plateShift(raw) : raw;
    // el fondo de la placa: concéntrico con la cara, salvo la parte del hundimiento que se lleva la pared al
    // adelgazar; con el tope y rodilla suave (sin ella el peritoneo pasaba de concéntrico a la cúpula rígida en
    // 2–3° de las líneas oblicuas) y b ≥ 0,5: la placa nunca se invierte
    const sW = s0 + contact[k] * (l.b - 1) * W - CONTACT.wallIndentationShare * Math.min(0, s0);
    const bm1 = Math.max(MIN_PLATE_STRETCH - 1, (plateShift(sW) - s0) / W);
    return [s0, bm1];
  });
  return {
    center: [C[0], C[1], C[2]],
    radiusMm: R,
    axial: frame.axial,
    lateral: frame.lateral,
    halfAngle: half,
    halfElevationMm: halfElev,
    plateMm: W,
    nodes,
    contact,
    summary: {
      gapRefMm: gRef,
      capacityMm: G,
      gelMm: gel,
      relativeGapMm: relative,
      skinAlongMm: lines.map((l) => l.rs ?? NaN),
      stretch: lines.map((l) => l.b),
    },
  };
}

/** Contacto de una pose con su propio marco (pruebas y consultas sin simulador). */
export function contactForPose(pose: ProbePose, tr: Transducer, t: Torso): ProbeCompression {
  return probeContact(pose, probeFrame(pose, t, tr), tr, t);
}

/** Acoplamiento acústico de la línea θ (0–1): el contacto conseguido en su elemento. */
export function contactCoupling(k: ProbeCompression, theta: number): number {
  return nodeInterp(Math.sin(theta), k.halfAngle, k.contact);
}
