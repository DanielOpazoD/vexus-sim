import { clamp, dot, length, smoothstep, type Vec3 } from '../core/vec3';
import type { Torso } from './primitives';

/**
 * La sonda comprime el tejido (decisión 63). El tronco es rígido y la cara convexa de la sonda (radio 60 mm)
 * apoyada en una piel convexa solo la toca en un punto: sin deformación, bajo la huella las capas de la pared
 * (piel, septos, fascias, peritoneo, pleura) se dibujaban como una cúpula (∩) y los elementos de los bordes
 * quedaban en el aire. En un examen el operador aprieta y el tejido blando se amolda a la cara.
 *
 * Campo de desplazamiento a lo largo de la dirección de compresión de cada elemento (la normal de la cara: la
 * línea radial desde el eje de curvatura). Se define por su inversa, mundo → material, que es lo que necesitan
 * la GPU y el gemelo: el punto p a profundidad d bajo la cara (d = ρ − R, ρ la distancia al eje en el plano
 * de la cara) en el ángulo α y la elevación e viene del punto rígido de la misma línea a distancia d + s:
 *
 *   m' = p + s·r̂,   s = W_e(e)·(s₀(α) + (b(α) − 1)·min(d, W))·(1 − smoothstep(W, W + S, d)),
 *
 * con W el espesor de la pared y, por nodo de la cara (`probe/contact.ts`; la tabla viaja en la textura de escena,
 * `uSceneTex` desde `COMPRESSION_BASE`, sin ranuras de uniforms ni indexado dinámico):
 *  - s₀: el hueco a la piel sin deformar a lo largo de la normal del elemento (> 0 aire, < 0 la sonda hunde la
 *    piel), por el contacto conseguido y menos la película de gel: la piel llega a la cara;
 *  - b: el estiramiento de la placa. La pared entera (0 ≤ d ≤ W) se lleva como una placa: la capa a
 *    profundidad W queda a W de la cara en toda la huella. Con incidencia oblicua la pared mide W·b a lo largo
 *    de la línea, y b la devuelve a W: las capas quedan paralelas a la cara (exacto en la piel y en la cara
 *    interna de la pared, peritoneo y pleura; entre ellas, lineal a lo largo de la línea). El fondo de la placa
 *    se desplaza a lo sumo `plateShiftMaxMm` (s_W = s₀ + (b − 1)·W): en las líneas muy oblicuas la placa no
 *    llega a ser concéntrica; al hundir la piel la pared se lleva la mitad adelgazando (`probe/contact.ts`);
 *  - bajo la placa el desplazamiento se apaga en S = max(2L, 2,5·s_W): cero exacto a W + S (60 mm en el centro
 *    del adulto de referencia, ≤ W + 62,5 en todo caso) y dr/dd ≥ 1 − 1,5/2,5 = 0,4: nunca se pliega.
 *
 * El mapa es radial en coordenadas polares de la cara (α y e no cambian): es invertible si r + s crece con d, y
 * crece: b > 0 en la placa y 1 + s_W·f′ ≥ 0,4 debajo. Los nodos son equiespaciados en σ = sen α (σ = (P·lateral)/ρ:
 * sin atan, que en SwiftShader encarecía la compilación de cada `toMaterial`). W_e, la ventana elevacional (la
 * huella mide 13 mm), y más allá del borde de la cara los nodos del borde se apagan en `lateralTaperSin` (en σ).
 * Después, la respiración (`deformation.ts`).
 *
 * Todo lo que pasa por `toMaterial` ve el mismo tejido deformado: clasificación, moteado anclado, transmisión,
 * ecos de interfaz, pleura y cortina, velocidades Doppler y los gemelos TS. Las direcciones (la incidencia de un
 * eco, la de una lámina de la textura) se llevan al mundo con la jacobiana de la inversa (`warpAt`,
 * `warpNormal`): ∇_mundo = J^T·∇_material, J = I + r̂⊗∇s + (s/ρ)·(I − r̂r̂ − êê). Gemelo GLSL con los mismos
 * nombres: `COMPRESSION_GLSL`.
 */
export const PROBE_COMPRESSION = {
  /** Nodos de la tabla a lo largo de la cara, de −halfAngle a +halfAngle (dos por vec4: 8 ranuras). */
  nodes: 32,
  /**
   * L (mm): bajo la pared el desplazamiento se apaga en al menos 2·L con un smoothstep (cero exacto a
   * W + 2L = 60 mm en el adulto de referencia). [ESTIMADO 12–25 mm; ver DECISIONS 63: carga en franja de
   * Boussinesq/Flamant sobre la huella de 13 × 62 mm, de memoria]
   */
  decayMm: 16,
  /** La caída bajo la placa mide al menos este múltiplo del desplazamiento de la placa: dr/dd ≥ 1 − 1,5/2,5. */
  decaySpanPerShift: 2.5,
  /**
   * Tope (mm) del desplazamiento del fondo de la placa a lo largo de la línea, s_W = s₀ + (b − 1)·W: con él la
   * caída bajo la placa acaba a W + max(2L, 2,5·s_W) ≤ W + 62,5 mm. Sin tope, en los bordes de la intercostal la
   * placa concéntrica subía el peritoneo 40–60 mm a lo largo de la línea (la pared, oblicua, medía allí 2–3 W)
   * y el hígado de debajo se movía decenas de mm a 60–100 mm de la sonda. [ESTIMADO]
   */
  plateShiftMaxMm: 25,
  /** Más allá del borde de la cara la tabla se apaga en este intervalo de σ = sen α (~6° y ~6 mm de arco). [ESTIMADO] */
  lateralTaperSin: 0.09,
  /** Más allá de la media huella elevacional se apaga en estos mm. [ESTIMADO] */
  elevationTaperMm: 10,
} as const;

/** Un nodo de la cara: (s₀ mm, b − 1). */
export type CompressionNode = readonly [number, number];

/**
 * Estado del contacto de un cuadro (lo calcula `probe/contact.ts` desde la pose): la geometría de la cara y la
 * tabla por nodo. Datos planos: la anatomía no conoce la sonda.
 */
export interface ProbeCompression {
  /** Centro de curvatura de la cara (mm, mundo). */
  center: Vec3;
  /** Radio de curvatura de la cara (mm). */
  radiusMm: number;
  /** Ejes del marco de la sonda: axial (hacia el paciente) y lateral (hacia el marcador); la elevación es
   * axial × lateral (`compressionElevation`). */
  axial: Vec3;
  lateral: Vec3;
  /** Semiángulo de la cara (rad): los nodos van de σ = −sen(halfAngle) a +sen(halfAngle), equiespaciados en σ. */
  halfAngle: number;
  /** Media huella elevacional (mm). */
  halfElevationMm: number;
  /** Espesor de la pared (mm): la placa. */
  plateMm: number;
  /** Tabla por nodo: (s₀ mm, b − 1); `PROBE_COMPRESSION.nodes` nodos. La que sube a la GPU (`uCompNodes`). */
  nodes: readonly CompressionNode[];
  /** Contacto conseguido por nodo (0–1): el acoplamiento de las líneas (`probe/contact.ts`). Solo CPU. */
  contact: readonly number[];
}

/** Espesor total de la pared (mm): la placa que se lleva entera (piel, grasa y músculo con la preperitoneal). */
export function compressionPlateMm(t: Torso): number {
  return t.skinMm + t.fatMm + t.muscleMm;
}

/** Profundidad bajo la cara (mm) a partir de la cual no hay desplazamiento: W + max(2L, 2,5·tope). */
export function compressionReachMm(plateMm: number): number {
  const c = PROBE_COMPRESSION;
  return plateMm + Math.max(2 * c.decayMm, c.decaySpanPerShift * c.plateShiftMaxMm);
}

/** σ = sen α del nodo k (equiespaciados en σ entre ±sen(halfAngle)). */
export function nodeSin(k: number, halfAngle: number): number {
  const h = Math.sin(halfAngle);
  return -h + (2 * h * k) / (PROBE_COMPRESSION.nodes - 1);
}

/** Interpolación lineal de una tabla por nodo en σ = sen α (el valor del borde fuera de la cara). */
export function nodeInterp(sigma: number, halfAngle: number, table: readonly number[]): number {
  const n = PROBE_COMPRESSION.nodes;
  const h = Math.sin(halfAngle);
  const x = clamp(((sigma + h) / (2 * h)) * (n - 1), 0, n - 1);
  const i = Math.min(Math.floor(x), n - 2);
  return table[i] + (table[i + 1] - table[i]) * (x - i);
}

/**
 * (s₀, b − 1) en σ = sen α: la tabla con interpolación lineal y, más allá del borde, el nodo del borde
 * apagándose en `lateralTaperSin`.
 */
export function compressionNode(sigma: number, k: ProbeCompression): [number, number] {
  const h = Math.sin(k.halfAngle);
  const n = PROBE_COMPRESSION.nodes;
  const x = clamp(((sigma + h) / (2 * h)) * (n - 1), 0, n - 1);
  const i = Math.min(Math.floor(x), n - 2);
  const t = x - i;
  const a = k.nodes[i];
  const b = k.nodes[i + 1];
  const tl = 1 - smoothstep(h, h + PROBE_COMPRESSION.lateralTaperSin, Math.abs(sigma));
  return [(a[0] + (b[0] - a[0]) * t) * tl, (a[1] + (b[1] - a[1]) * t) * tl];
}

/** Desplazamiento s (mm, a lo largo de r̂) en p y la geometría polar que lo lleva. */
export interface CompressionSample {
  shift: number;
  /** r̂: dirección radial en el plano de la cara (la dirección de compresión del elemento de p). */
  rhat: Vec3;
  /** ρ: distancia de p al eje de curvatura en el plano de la cara (mm). */
  rho: number;
}

const ZERO: Vec3 = [0, 0, 0];

/** Eje de elevación de la cara: axial × lateral (el marco de la sonda es ortonormal y dextrógiro). */
export function compressionElevation(k: ProbeCompression): Vec3 {
  const a = k.axial;
  const l = k.lateral;
  return [a[1] * l[2] - a[2] * l[1], a[2] * l[0] - a[0] * l[2], a[0] * l[1] - a[1] * l[0]];
}

/** s(p), r̂ y ρ (ver la cabecera). s = 0 sin compresión y lejos de la sonda. */
export function compressionSample(p: Vec3, k: ProbeCompression | null): CompressionSample {
  if (!k) return { shift: 0, rhat: ZERO, rho: 0 };
  const el = compressionElevation(k);
  const d: Vec3 = [p[0] - k.center[0], p[1] - k.center[1], p[2] - k.center[2]];
  const e = dot(d, el);
  const P: Vec3 = [d[0] - e * el[0], d[1] - e * el[1], d[2] - e * el[2]];
  const rho = length(P);
  if (rho < 1e-6) return { shift: 0, rhat: ZERO, rho };
  const rhat: Vec3 = [P[0] / rho, P[1] / rho, P[2] / rho];
  const depth = rho - k.radiusMm;
  const W = k.plateMm;
  if (depth >= compressionReachMm(W) || Math.abs(e) >= k.halfElevationMm + PROBE_COMPRESSION.elevationTaperMm || dot(P, k.axial) <= 0)
    return { shift: 0, rhat, rho };
  const [s0, bm1] = compressionNode(dot(P, k.lateral) / rho, k);
  const sW = s0 + bm1 * W;
  const span = Math.max(2 * PROBE_COMPRESSION.decayMm, PROBE_COMPRESSION.decaySpanPerShift * Math.max(sW, 0));
  const we = 1 - smoothstep(k.halfElevationMm, k.halfElevationMm + PROBE_COMPRESSION.elevationTaperMm, Math.abs(e));
  const f = 1 - smoothstep(W, W + span, depth);
  return { shift: we * f * (s0 + bm1 * Math.min(depth, W)), rhat, rho };
}

/** Punto «sin comprimir» (el del tronco rígido, antes de deshacer la respiración): m' = p + s·r̂. */
export function uncompress(p: Vec3, k: ProbeCompression | null): Vec3 {
  if (!k) return p;
  const c = compressionSample(p, k);
  return [p[0] + c.shift * c.rhat[0], p[1] + c.shift * c.rhat[1], p[2] + c.shift * c.rhat[2]];
}

/**
 * Lo que necesita la jacobiana de la inversa en p para llevar direcciones al mundo: s, r̂, ρ, ê y ∇s. ∇s es
 * analítico (una evaluación del campo, no siete: el arranque con SwiftShader lo nota) y la prueba lo compara con
 * diferencias centrales. Sin compresión, la identidad.
 */
export interface Warp {
  shift: number;
  rhat: Vec3;
  rho: number;
  elevation: Vec3;
  grad: Vec3;
}

/** La identidad (sin compresión): J = I. */
export const IDENTITY_WARP: Readonly<Warp> = Object.freeze({ shift: 0, rhat: ZERO, rho: 1, elevation: ZERO, grad: ZERO });

export function warpAt(p: Vec3, k: ProbeCompression | null): Warp {
  if (!k) return IDENTITY_WARP;
  const C = PROBE_COMPRESSION;
  const el = compressionElevation(k);
  const d: Vec3 = [p[0] - k.center[0], p[1] - k.center[1], p[2] - k.center[2]];
  const e = dot(d, el);
  const P: Vec3 = [d[0] - e * el[0], d[1] - e * el[1], d[2] - e * el[2]];
  const rho = length(P);
  if (rho < 1e-6) return { ...IDENTITY_WARP, elevation: el };
  const rhat: Vec3 = [P[0] / rho, P[1] / rho, P[2] / rho];
  const depth = rho - k.radiusMm;
  const W = k.plateMm;
  const E0 = k.halfElevationMm;
  if (depth >= compressionReachMm(W) || Math.abs(e) >= E0 + C.elevationTaperMm) return { shift: 0, rhat, rho, elevation: el, grad: ZERO };
  if (dot(P, k.axial) <= 0) return { shift: 0, rhat, rho, elevation: el, grad: ZERO };
  const sigma = dot(P, k.lateral) / rho;
  // tabla y su derivada en σ (lineal a tramos; 0 fuera de la cara) y la cola lateral
  const h = Math.sin(k.halfAngle);
  const n = C.nodes;
  const xr = ((sigma + h) / (2 * h)) * (n - 1);
  const x = clamp(xr, 0, n - 1);
  const i = Math.min(Math.floor(x), n - 2);
  const t = x - i;
  const a = k.nodes[i];
  const b = k.nodes[i + 1];
  const inside = xr > 0 && xr < n - 1 ? (n - 1) / (2 * h) : 0;
  const v0 = a[0] + (b[0] - a[0]) * t;
  const v1 = a[1] + (b[1] - a[1]) * t;
  const tl = 1 - smoothstep(h, h + C.lateralTaperSin, Math.abs(sigma));
  const dtl = -smoothstepSlope(h, h + C.lateralTaperSin, Math.abs(sigma)) * Math.sign(sigma);
  const s0 = v0 * tl;
  const bm1 = v1 * tl;
  const ds0 = (b[0] - a[0]) * inside * tl + v0 * dtl;
  const dbm1 = (b[1] - a[1]) * inside * tl + v1 * dtl;
  // caída bajo la placa: su longitud depende de s_W (de σ)
  const sW = s0 + bm1 * W;
  const longSpan = C.decaySpanPerShift * sW > 2 * C.decayMm;
  const span = longSpan ? C.decaySpanPerShift * sW : 2 * C.decayMm;
  const dspan = longSpan ? C.decaySpanPerShift * (ds0 + dbm1 * W) : 0;
  const u = clamp((depth - W) / span, 0, 1);
  const f = 1 - u * u * (3 - 2 * u);
  const fu = u > 0 && u < 1 ? -6 * u * (1 - u) : 0;
  const md = Math.min(depth, W);
  const g = s0 + bm1 * md;
  // la ventana elevacional es plana en ±E0 (toda muestra de la imagen cae ahí): su derivada no se lleva
  const we = 1 - smoothstep(E0, E0 + C.elevationTaperMm, Math.abs(e));
  const dDepth = we * ((fu / span) * g + f * (depth < W ? bm1 : 0));
  const dSigma = we * (fu * (-u / span) * dspan * g + f * (ds0 + dbm1 * md));
  // ∇σ = (lateral − σ·r̂)/ρ
  const q = dSigma / rho;
  const grad: Vec3 = [
    dDepth * rhat[0] + q * (k.lateral[0] - sigma * rhat[0]),
    dDepth * rhat[1] + q * (k.lateral[1] - sigma * rhat[1]),
    dDepth * rhat[2] + q * (k.lateral[2] - sigma * rhat[2]),
  ];
  return { shift: we * f * g, rhat, rho, elevation: el, grad };
}

/** Derivada de smoothstep(e0, e1, x) respecto a x. */
function smoothstepSlope(e0: number, e1: number, x: number): number {
  const u = (x - e0) / (e1 - e0);
  return u > 0 && u < 1 ? (6 * u * (1 - u)) / (e1 - e0) : 0;
}

/**
 * Gradiente en el mundo de un campo material cuyo gradiente material es `n` (sin normalizar):
 * J^T·n = n + (r̂·n)·∇s + (s/ρ)·(n − (n·r̂)·r̂ − (n·ê)·ê). La normal de una cara en el mundo es su dirección y su
 * norma pasa la distancia de la cara a distancia por la normal en el mundo (el eco de interfaz, decisión 57).
 */
export function warpNormal(w: Warp, n: Vec3): Vec3 {
  const rn = dot(w.rhat, n);
  const en = dot(w.elevation, n);
  const q = w.shift / w.rho;
  return [
    n[0] + rn * w.grad[0] + q * (n[0] - rn * w.rhat[0] - en * w.elevation[0]),
    n[1] + rn * w.grad[1] + q * (n[1] - rn * w.rhat[1] - en * w.elevation[1]),
    n[2] + rn * w.grad[2] + q * (n[2] - rn * w.rhat[2] - en * w.elevation[2]),
  ];
}

/** Cota de |J^T·n|/|n| (la salida barata del eco de interfaz): 1 + |∇s| + |s|/ρ. */
export function warpBound(w: Warp): number {
  return 1 + length(w.grad) + Math.abs(w.shift) / w.rho;
}

const f4 = (x: number): string => x.toFixed(4);

/**
 * Gemelo GLSL (en `ANATOMY_GLSL`, antes de `toMaterial`; usa los uniforms `uComp*` del esquema único,
 * `anatomy/gpu/sceneUniforms.ts`).
 */
export const COMPRESSION_GLSL = /* glsl */ `
#define COMP_NODES ${PROBE_COMPRESSION.nodes}
#define COMP_DECAY_MM ${f4(PROBE_COMPRESSION.decayMm)}
#define COMP_SPAN_PER_SHIFT ${f4(PROBE_COMPRESSION.decaySpanPerShift)}
#define COMP_PLATE_SHIFT_MAX ${f4(PROBE_COMPRESSION.plateShiftMaxMm)}
#define COMP_LAT_TAPER ${f4(PROBE_COMPRESSION.lateralTaperSin)}
#define COMP_ELEV_TAPER ${f4(PROBE_COMPRESSION.elevationTaperMm)}
// la tabla por nodo en la textura de escena (COMP_BASE, de ANATOMY_GLSL): (s₀, b − 1)
vec2 compressionTable(int i) { return sceneTexel(COMP_BASE + i).xy; }
vec3 compressionElevation() { return cross(uCompAx.xyz, uCompLat.xyz); }
// s(p) a lo largo de r̂ (anatomy/compression.ts); rhat y rho, la geometría polar de la cara
float compressionSample(vec3 p, out vec3 rhat, out float rho) {
  vec3 el = compressionElevation();
  vec3 d = p - uCompC.xyz;
  float e = dot(d, el);
  vec3 P = d - e * el;
  rho = length(P);
  rhat = rho > 1e-6 ? P / rho : vec3(0.0);
  if (uCompC.w <= 0.0 || rho < 1e-6) return 0.0;
  float depth = rho - uCompC.w;
  float W = uWall.x + uWall.y + uWall.z;
  if (depth >= W + max(2.0 * COMP_DECAY_MM, COMP_SPAN_PER_SHIFT * COMP_PLATE_SHIFT_MAX) || abs(e) >= uCompLat.w + COMP_ELEV_TAPER || dot(P, uCompAx.xyz) <= 0.0)
    return 0.0;
  float sg = dot(P, uCompLat.xyz) / rho;
  float h = uCompAx.w;
  float x = clamp((sg + h) / (2.0 * h) * float(COMP_NODES - 1), 0.0, float(COMP_NODES - 1));
  int i = min(int(floor(x)), COMP_NODES - 2);
  vec2 nd = mix(compressionTable(i), compressionTable(i + 1), x - float(i)) * (1.0 - smoothstep(h, h + COMP_LAT_TAPER, abs(sg)));
  float sW = nd.x + nd.y * W;
  float span = max(2.0 * COMP_DECAY_MM, COMP_SPAN_PER_SHIFT * max(sW, 0.0));
  float we = 1.0 - smoothstep(uCompLat.w, uCompLat.w + COMP_ELEV_TAPER, abs(e));
  float f = 1.0 - smoothstep(W, W + span, depth);
  return we * f * (nd.x + nd.y * min(depth, W));
}
vec3 uncompress(vec3 p) {
  vec3 rhat;
  float rho;
  float s = compressionSample(p, rhat, rho);
  return p + s * rhat;
}
// Jacobiana de la inversa: s, r̂, ρ y ∇s (analítico: una evaluación del campo), para llevar normales al mundo
struct Warp { float s; vec3 rhat; float rho; vec3 g; };
Warp noWarp() { Warp w; w.s = 0.0; w.rhat = vec3(0.0); w.rho = 1.0; w.g = vec3(0.0); return w; }
float smoothstepSlope(float e0, float e1, float x) {
  float u = (x - e0) / (e1 - e0);
  return u > 0.0 && u < 1.0 ? 6.0 * u * (1.0 - u) / (e1 - e0) : 0.0;
}
Warp warpAt(vec3 p) {
  Warp w = noWarp();
  if (uCompC.w <= 0.0) return w;
  vec3 el = compressionElevation();
  vec3 dd = p - uCompC.xyz;
  float e = dot(dd, el);
  vec3 P = dd - e * el;
  float rho = length(P);
  if (rho < 1e-6) return w;
  w.rho = rho;
  w.rhat = P / rho;
  float depth = rho - uCompC.w;
  float W = uWall.x + uWall.y + uWall.z;
  float E0 = uCompLat.w;
  if (depth >= W + max(2.0 * COMP_DECAY_MM, COMP_SPAN_PER_SHIFT * COMP_PLATE_SHIFT_MAX) || abs(e) >= E0 + COMP_ELEV_TAPER || dot(P, uCompAx.xyz) <= 0.0)
    return w;
  float sg = dot(P, uCompLat.xyz) / rho;
  float h = uCompAx.w;
  float xr = (sg + h) / (2.0 * h) * float(COMP_NODES - 1);
  float x = clamp(xr, 0.0, float(COMP_NODES - 1));
  int i = min(int(floor(x)), COMP_NODES - 2);
  vec2 a = compressionTable(i);
  vec2 b = compressionTable(i + 1);
  float inside = xr > 0.0 && xr < float(COMP_NODES - 1) ? float(COMP_NODES - 1) / (2.0 * h) : 0.0;
  vec2 v = mix(a, b, x - float(i));
  float tl = 1.0 - smoothstep(h, h + COMP_LAT_TAPER, abs(sg));
  float dtl = -smoothstepSlope(h, h + COMP_LAT_TAPER, abs(sg)) * sign(sg);
  vec2 nd = v * tl;
  vec2 dnd = (b - a) * inside * tl + v * dtl;
  float sW = nd.x + nd.y * W;
  bool longSpan = COMP_SPAN_PER_SHIFT * sW > 2.0 * COMP_DECAY_MM;
  float span = longSpan ? COMP_SPAN_PER_SHIFT * sW : 2.0 * COMP_DECAY_MM;
  float dspan = longSpan ? COMP_SPAN_PER_SHIFT * (dnd.x + dnd.y * W) : 0.0;
  float u = clamp((depth - W) / span, 0.0, 1.0);
  float f = 1.0 - u * u * (3.0 - 2.0 * u);
  float fu = u > 0.0 && u < 1.0 ? -6.0 * u * (1.0 - u) : 0.0;
  float md = min(depth, W);
  float g = nd.x + nd.y * md;
  float we = 1.0 - smoothstep(E0, E0 + COMP_ELEV_TAPER, abs(e));
  float dDepth = we * (fu / span * g + f * (depth < W ? nd.y : 0.0));
  float dSigma = we * (fu * (-u / span) * dspan * g + f * (dnd.x + dnd.y * md));
  w.s = we * f * g;
  w.g = dDepth * w.rhat + dSigma / rho * (uCompLat.xyz - sg * w.rhat);
  return w;
}
vec3 warpNormal(Warp w, vec3 n) {
  float rn = dot(w.rhat, n);
  vec3 el = compressionElevation();
  return n + rn * w.g + (w.s / w.rho) * (n - rn * w.rhat - dot(el, n) * el);
}
// Cota de |J^T·n|/|n|: la salida barata del eco de interfaz la usa para no descartar muestras a su alcance
float warpBound(Warp w) { return 1.0 + length(w.g) + abs(w.s) / w.rho; }
`;
