import {
  PROBE_COMPRESSION,
  compressionPlateMm,
  compressionReachMm,
  nodeInterp,
  nodeSin,
  type CompressionNode,
  type ProbeCompression,
} from '../anatomy/compression';
import { torsoDepth, torsoDepthGradient, type Torso } from '../anatomy/primitives';
import { length, smoothstep, type Vec3 } from '../core/vec3';
import { probeFrame, skinSoftness, type ProbeFrame, type ProbePose, type Transducer } from './probe';

/**
 * Contacto de la sonda de un cuadro (decisión 63): cuánto aprieta el operador, el marco efectivo de la sonda (ya
 * hundida), la tabla del campo de compresión (`anatomy/compression.ts`) y el acoplamiento de cada línea
 * (acoplamiento = contacto conseguido). Sustituye al hueco ad hoc de `lineCoupling` (un radio de piel fijo de
 * 130 mm con el signo de la curvatura al revés —la piel convexa se aparta de la cara, no la acompaña— y 4 mm de
 * gel).
 *
 * SOLO EMPUJA. La cara convexa sobre la piel sin deformar la toca en un punto; para que los bordes apoyen, el
 * operador hunde la sonda entera a lo largo de su eje (δ mm: el plano de imagen no cambia) y el tejido se aparta.
 * Por nodo α_k de la cara (equiespaciados en sen α), a lo largo de su línea y en el tronco rígido: r_s, la
 * distancia a la piel (< 0: la cara la hunde), y r_W, la distancia a la cara interna de la pared (profundidad W).
 *  - Un elemento apoya con la pared paralela a la cara si r_W ≤ D* = W + `wallTolMm`: empujando la piel hasta la
 *    cara, la cara interna de la pared queda a D* (o, si la pared mide menos de D* a lo largo de la línea, a lo que
 *    mide: la pared se traslada entera) y nada se estira. Si r_W > D* la pared bajo ese elemento se dobla alejándose
 *    de la cara (el empuje no alcanza: la línea es oblicua a la pared) y la línea no acopla. Los bordes
 *    elevacionales de la huella, además, a ≤ `gelMm` de la piel (la inclinación fuera del plano levanta uno).
 *  - δ: el menor que consigue lo anterior en todos los nodos, con el tope de la presión del examen: la cara no se
 *    hunde en la piel rígida más de P = `pressMm` + `pressSoftMm`·blandura. Lo que no apoya con ese tope queda sin
 *    acoplar. Lo que el usuario apriete (lift < 0) se suma a δ, a lo largo del eje. Al levantar la sonda (lift > 0)
 *    el operador deja de apretar en `releaseMm`.
 *  - Acoplamiento por nodo = (1 − smoothstep(gel, gel + rampa, hueco)) · (1 − smoothstep(D*, D* + rampa, r_W −
 *    max(0, r_s))), el segundo factor erosionado un nodo y el producto filtrado [1 2 1]/4, interpolado entre nodos
 *    (3 líneas por nodo): la transición ocupa unas 12 líneas y ninguna línea acoplada ve la pared doblada.
 * [ESTIMADO: la presión. En el abdomen plano un convexo de 60 mm de radio y ±34° necesita hundirse su sagita en el
 * borde (10,3 mm) para apoyar entero, y algo más para que la pared oblicua de los bordes quede paralela; ver
 * DECISIONS 63]
 *
 * Consecuencia aceptada: al apretar, todo el campo cercano se acerca a la sonda (lo profundo aparece δ mm menos
 * profundo en la imagen: el marco efectivo es el hundido), como en un examen real.
 */
export const CONTACT = {
  /** Película de gel (mm) que salva un hueco sin perder el acoplamiento. [ESTIMADO] */
  gelMm: 2,
  /** Se apaga en estos mm más (un elemento a 4,5 mm de la piel ya no acopla). [ESTIMADO] */
  gelRampMm: 2.5,
  /** Tolerancia de la cara interna de la pared bajo las líneas acopladas (mm): D* = W + tolerancia. [ESTIMADO] */
  wallTolMm: 1,
  /** El acoplamiento se apaga en estos mm de pared doblada más allá de D*. [ESTIMADO] */
  wallRampMm: 1.5,
  /** Hundimiento máximo de la cara en la piel rígida (mm) con la presión del examen, sobre la pared más rígida. [ESTIMADO] */
  pressMm: 13,
  /** Lo que añade la blandura de la pared (0,15 sobre costillas … 0,65 en el epigastrio). [ESTIMADO] */
  pressSoftMm: 20,
  /** Al levantar la sonda (lift > 0) el operador deja de apretar en estos mm. [ESTIMADO] */
  releaseMm: 3,
} as const;

/** La cara interna de la pared se busca hasta este múltiplo de W a lo largo de la línea. */
const WALL_SEARCH_FACTOR = 3;
/** Con la pared doblada (r_W > D*) el empuje se apaga dentro de la pared, a lo sumo a D* + esto (acota el alcance). */
const WALL_FADE_MAX_MM = 20;
/** Iteraciones de la búsqueda de δ (falsa posición de Illinois). */
const PRESS_ITERATIONS = 8;

/** Hueco con signo (mm) del punto q a la piel sin deformar, por la normal de la piel (< 0: dentro). */
function skinGap(q: Vec3, t: Torso): number {
  return torsoDepth(q, t) / Math.max(1e-6, length(torsoDepthGradient(q, t)));
}

/** Primer cruce (mm a lo largo de la línea) del nivel `w` de profundidad radial en [r0, r1], o null. */
export function firstCrossing(depthAt: (r: number) => number, w: number, r0: number, r1: number): number | null {
  const step = 2;
  let prev = r0;
  if (depthAt(r0) >= w) return r0;
  // Visit the supplied endpoint even when the final bracket is shorter than
  // step. Omitting it can report no wall despite depthAt(r1) already being inside.
  while (prev < r1) {
    const r = Math.min(prev + step, r1);
    if (depthAt(r) >= w) {
      let lo = prev;
      let hi = r;
      for (let i = 0; i < 18; i++) {
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

/**
 * Primer punto de la línea E + dir·r (r ∈ [r0, r1]) dentro de la piel: la elipse del tronco (ρ = 1, donde
 * `torsoDepth` = 0), analítica. null si la línea no entra.
 */
function skinEntry(E: Vec3, dir: Vec3, t: Torso, r0: number, r1: number): number | null {
  if (t.profile) {
    const depth = (r: number) => torsoDepth([E[0] + dir[0] * r, E[1] + dir[1] * r, E[2] + dir[2] * r], t);
    if (depth(r0) <= 0) return r0;
    let lo = r0;
    for (let r = r0 + 1; lo < r1; r += 1) {
      const hi0 = Math.min(r, r1);
      if (depth(hi0) <= 0) {
        let hi = hi0;
        for (let j = 0; j < 20; j++) {
          const mid = (lo + hi) / 2;
          if (depth(mid) <= 0) hi = mid;
          else lo = mid;
        }
        return (lo + hi) / 2;
      }
      lo = hi0;
    }
    return null;
  }

  E = [E[0], E[1] - (t.y0 ?? 0), E[2]];
  const ia = 1 / (t.a * t.a);
  const ib = 1 / (t.b * t.b);
  const A = dir[0] * dir[0] * ia + dir[1] * dir[1] * ib;
  const B = 2 * (E[0] * dir[0] * ia + E[1] * dir[1] * ib);
  const C = E[0] * E[0] * ia + E[1] * E[1] * ib - 1;
  if (A < 1e-12) return C <= 0 ? r0 : null;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const q = Math.sqrt(disc);
  const enter = (-B - q) / (2 * A);
  const exit = (-B + q) / (2 * A);
  if (exit < r0 || enter > r1) return null;
  return Math.max(enter, r0);
}

/** La geometría de un nodo en el tronco rígido, a lo largo de su línea desde el elemento. */
interface NodeGeometry {
  /** Distancia a la piel (mm; < 0 la cara la hunde); null si la línea no la cruza. */
  rs: number | null;
  /** Distancia a la cara interna de la pared (mm); la de búsqueda si no llega. */
  rW: number;
  /** Mayor hueco de los bordes elevacionales de la huella a la piel (mm, por la normal de la piel). */
  gapElevation: number;
}

interface FaceGeometry {
  nodes: NodeGeometry[];
  /** Hundimiento de la cara en la piel rígida (mm): el mayor −hueco de los elementos. */
  penetration: number;
}

function measureFace(frame: ProbeFrame, tr: Transducer, t: Torso, W: number): FaceGeometry {
  const n = PROBE_COMPRESSION.nodes;
  const R = tr.curvatureRadius;
  const halfElev = tr.elevationMm / 2;
  const C = frame.curvatureCenter;
  const el = frame.elevation;
  const nodes: NodeGeometry[] = [];
  let penetration = -Infinity;
  for (let k = 0; k < n; k++) {
    // nodos equiespaciados en σ = sen α (anatomy/compression.ts)
    const s = nodeSin(k, tr.halfSector);
    const c = Math.sqrt(1 - s * s);
    const dir: Vec3 = [
      frame.axial[0] * c + frame.lateral[0] * s,
      frame.axial[1] * c + frame.lateral[1] * s,
      frame.axial[2] * c + frame.lateral[2] * s,
    ];
    const E: Vec3 = [C[0] + dir[0] * R, C[1] + dir[1] * R, C[2] + dir[2] * R];
    const gapE = Math.max(
      skinGap([E[0] + el[0] * halfElev, E[1] + el[1] * halfElev, E[2] + el[2] * halfElev], t),
      skinGap([E[0] - el[0] * halfElev, E[1] - el[1] * halfElev, E[2] - el[2] * halfElev], t),
    );
    penetration = Math.max(penetration, -skinGap(E, t));
    const depthAt = (r: number): number => -torsoDepth([E[0] + dir[0] * r, E[1] + dir[1] * r, E[2] + dir[2] * r], t);
    const rs = skinEntry(E, dir, t, -60, 200);
    // a lo largo de la línea la pared mide al menos ~W: la búsqueda de su cara interna empieza cerca
    const near = rs === null ? 0 : rs + 0.9 * W;
    const rW =
      rs === null
        ? null
        : depthAt(near) >= W
          ? firstCrossing(depthAt, W, rs, near)
          : firstCrossing(depthAt, W, near, rs + WALL_SEARCH_FACTOR * W);
    nodes.push({ rs, rW: rs === null ? Infinity : (rW ?? rs + WALL_SEARCH_FACTOR * W), gapElevation: gapE });
  }
  return { nodes, penetration };
}

/** Lo que le falta al nodo para apoyar con la pared paralela (mm; ≤ 0: apoya). */
function nodeShortfall(g: NodeGeometry, wallTarget: number): number {
  if (g.rs === null) return Infinity;
  return Math.max(g.rW - wallTarget, g.gapElevation - CONTACT.gelMm);
}

/** Resumen del contacto (para la UI, el banco y las pruebas). */
export interface ContactSummary {
  /** Indentación efectiva (mm, a lo largo del eje de la sonda) que el operador añade a la pose. */
  indentMm: number;
  /** La que haría falta para que apoye toda la cara (mm; Infinity si ninguna basta). */
  neededMm: number;
  /** Tope del hundimiento de la cara en la piel rígida (mm), con lo que apriete el usuario. */
  capacityMm: number;
  /** Hundimiento de la cara en la piel rígida con el marco efectivo (mm). */
  penetrationMm: number;
  /** D*: profundidad (mm) de la cara interna de la pared bajo las líneas que apoyan. */
  wallTargetMm: number;
  /** Por nodo, en el marco efectivo: distancia a la piel y a la cara interna de la pared a lo largo de la línea (mm). */
  skinAlongMm: number[];
  wallAlongMm: number[];
}

/** El contacto de un cuadro: la tabla del campo, el marco efectivo de la sonda (hundida) y el resumen. */
export interface ProbeContact extends ProbeCompression {
  frame: ProbeFrame;
  summary: ContactSummary;
}

/** Contacto, marco efectivo y tabla de compresión de un cuadro, desde la pose. */
export function probeContact(pose: ProbePose, tr: Transducer, t: Torso): ProbeContact {
  const W = compressionPlateMm(t);
  const target = W + CONTACT.wallTolMm;
  // la sonda se hunde a lo largo de su eje (el operador empuja el mango): el plano de imagen no cambia, solo su
  // origen baja por la línea central. Lo que el usuario aprieta (lift < 0) se suma a lo largo del mismo eje (por
  // la normal de la piel, con la sonda inclinada, alejaba la cara y deslizaba el plano fuera de sí mismo)
  const press = Math.max(0, -pose.lift);
  const rigidFrame = probeFrame({ ...pose, lift: Math.max(0, pose.lift) }, t, tr);
  const frameAt = (indent: number): ProbeFrame => {
    const a = rigidFrame.axial;
    const move = (p: Vec3): Vec3 => [p[0] + a[0] * indent, p[1] + a[1] * indent, p[2] + a[2] * indent];
    return { ...rigidFrame, face: move(rigidFrame.face), curvatureCenter: move(rigidFrame.curvatureCenter) };
  };
  const shortfall = (g: FaceGeometry): number => Math.max(...g.nodes.map((n) => nodeShortfall(n, target)));
  // δ: el menor que hace apoyar toda la cara, con el tope de la presión
  const rigid = measureFace(frameAt(0), tr, t, W);
  const capacity = CONTACT.pressMm + CONTACT.pressSoftMm * skinSoftness(pose);
  const maxIndent = Math.max(0, capacity - Math.max(0, rigid.penetration));
  let q0 = shortfall(rigid);
  let indent = 0;
  let needed = 0;
  if (q0 > 0) {
    let hi = maxIndent;
    let q1 = hi > 0 ? shortfall(measureFace(frameAt(hi), tr, t, W)) : q0;
    if (q1 > 0 || !Number.isFinite(q0)) {
      indent = hi;
      needed = q1 > 0 ? Infinity : hi;
    } else {
      // falsa posición (Illinois) en [lo, hi] con q(lo) > 0 ≥ q(hi); se queda con el extremo que apoya
      let lo = 0;
      let side = 0;
      for (let i = 0; i < PRESS_ITERATIONS && hi - lo > 0.05; i++) {
        const x = Math.min(hi - 0.01, Math.max(lo + 0.01, (lo * q1 - hi * q0) / (q1 - q0)));
        const qx = shortfall(measureFace(frameAt(x), tr, t, W));
        if (qx > 0) {
          lo = x;
          q0 = qx;
          if (side === -1) q1 /= 2;
          side = -1;
        } else {
          hi = x;
          q1 = qx;
          if (side === 1) q0 /= 2;
          side = 1;
        }
      }
      indent = hi;
      needed = hi;
    }
  }
  // al levantar la sonda el operador deja de apretar; lo que apriete el usuario, encima
  indent = indent * (1 - smoothstep(0, CONTACT.releaseMm, pose.lift)) + press;
  const frame = frameAt(indent);
  const face = measureFace(frame, tr, t, W);
  const nodes: CompressionNode[] = [];
  const hover: number[] = [];
  const parallel: number[] = [];
  for (const g of face.nodes) {
    if (g.rs === null) {
      nodes.push([0, 0, target]);
      hover.push(0);
      parallel.push(0);
      continue;
    }
    // la piel hundida llega a la cara; la cara interna de la pared a D* (o a lo que la pared mida a lo largo de la
    // línea: se traslada entera) si el empuje alcanza; si no, el empuje se apaga dentro de la pared
    const s0 = Math.min(0, g.rs);
    const T = g.rW - g.rs;
    const D = Math.min(Math.max(g.rW, Math.min(target, T)), target + WALL_FADE_MAX_MM);
    nodes.push([s0, Math.min(0, g.rW - D), D]);
    hover.push(1 - smoothstep(CONTACT.gelMm, CONTACT.gelMm + CONTACT.gelRampMm, Math.max(g.rs, g.gapElevation)));
    // la pared, respecto de la piel (un hueco de gel la baja entera, sin doblarla)
    parallel.push(1 - smoothstep(target, target + CONTACT.wallRampMm, g.rW - Math.max(0, g.rs)));
  }
  // La pared paralela, erosionada un nodo: entre un nodo que apoya y otro cuya pared se dobla, la tabla interpolada
  // ya dobla la pared (la cara interna sube 10 mm en 1°); esas líneas no acoplan. Después, un filtro [1 2 1]/4: la
  // transición ocupa ~4 nodos (12 líneas) y lo que se extiende más allá de la erosión queda ≤ 1/8
  const n = parallel.length;
  const at = (v: number[], k: number): number => v[Math.min(n - 1, Math.max(0, k))];
  const eroded = hover.map((h, k) => h * Math.min(at(parallel, k - 1), parallel[k], at(parallel, k + 1)));
  const contact = eroded.map((c, k) => 0.25 * at(eroded, k - 1) + 0.5 * c + 0.25 * at(eroded, k + 1));
  return {
    center: [frame.curvatureCenter[0], frame.curvatureCenter[1], frame.curvatureCenter[2]],
    radiusMm: tr.curvatureRadius,
    axial: frame.axial,
    lateral: frame.lateral,
    halfAngle: tr.halfSector,
    halfElevationMm: tr.elevationMm / 2,
    plateMm: W,
    nodes,
    reachMm: compressionReachMm(nodes),
    contact,
    frame,
    summary: {
      indentMm: indent,
      neededMm: needed,
      capacityMm: capacity + press,
      penetrationMm: face.penetration,
      wallTargetMm: target,
      skinAlongMm: face.nodes.map((g) => g.rs ?? NaN),
      wallAlongMm: face.nodes.map((g) => g.rW),
    },
  };
}

/** Acoplamiento acústico de la línea θ (0–1): el contacto conseguido en su elemento. */
export function contactCoupling(k: ProbeCompression, theta: number): number {
  return nodeInterp(Math.sin(theta), k.halfAngle, k.contact);
}
