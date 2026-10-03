import { RESPIRATORY_DIRECTION } from './respiratoryDirection';
import { clamp, dot, length, smoothstep, type Vec3 } from '../core/vec3';
import type { Torso } from './primitives';

/**
 * La sonda comprime el tejido (decisión 63). El tronco es rígido y la cara convexa de la sonda (radio 60 mm)
 * apoyada en una piel convexa solo la toca en un punto: sin deformación, bajo la huella las capas de la pared
 * (piel, septos, fascias, peritoneo, pleura) se dibujaban como una cúpula (∩) y los elementos de los bordes
 * quedaban en el aire. En un examen el operador aprieta hasta que los bordes apoyan y el tejido blando se amolda
 * a la cara.
 *
 * SOLO EMPUJA: el tejido se aparta de la sonda (nunca se estira hacia ella) y a lo largo de la dirección de
 * compresión de cada elemento (la normal de la cara: la línea radial desde el eje de curvatura) solo se comprime.
 * Para que los bordes apoyen, la sonda entera se hunde (`probe/contact.ts`: la indentación efectiva, con el tope
 * de la presión del examen): el campo de cerca se acerca a la sonda y lo profundo aparece unos milímetros menos
 * profundo, como en un examen real.
 *
 * El campo se define por su inversa, mundo → material, que es lo que necesitan la GPU y el gemelo: el punto p a
 * profundidad d bajo la cara (d = ρ − R, ρ la distancia al eje en el plano de la cara) en el ángulo α y la
 * elevación e viene del punto rígido de la misma línea a distancia d + s, s ≤ 0:
 *
 *   m' = p + s·r̂,   s = W_e(e)·T_l(σ)·g(d),
 *   g(d) = s₀ + (s_D − s₀)·clamp(d, 0, D)/D  (d < D),   g(d) = s_D·(1 − smoothstep(D, D + S, d))  (d ≥ D),
 *
 * con, por nodo de la cara (`probe/contact.ts`; la tabla viaja en la textura de escena, `uSceneTex` desde
 * `COMPRESSION_BASE`, sin ranuras de uniforms ni indexado dinámico):
 *  - s₀ ≤ 0: la piel rígida a lo largo de la normal del elemento cuando la cara la hunde (0 si no la toca: no se
 *    tira de ella; el gel salva un hueco pequeño y más allá la línea no acopla);
 *  - D: la profundidad del mundo a la que queda la cara interna de la pared (peritoneo, pleura): la misma en
 *    toda la huella que apoya (D* = W + tolerancia, W el espesor de la pared) si la presión basta, la rígida si no;
 *  - s_D ≤ 0: lo que se empuja la cara interna de la pared, s_D ≥ s₀ (la pared se comprime o se traslada
 *    entera);
 *  - bajo la pared el empuje se apaga en S = max(2L, κ·|s_D|): cero exacto a D + S. dr/dd = 1 + ∂s/∂d ≥ 1: la
 *    compresión nunca pliega el tejido (el mapa es monótono a lo largo de cada línea) y nunca lo estira a lo largo
 *    de ella. A lo ancho, en cambio, el tejido empujado se abre: el arco a la misma α mide ρ en el mundo y ρ + s en
 *    el material (ρ/(ρ + s) > 1).
 *
 * El mapa es radial en coordenadas polares de la cara (α y e no cambian): es invertible porque r + s crece con d.
 * Los nodos son equiespaciados en σ = sen α (σ = (P·lateral)/ρ: sin atan, que en SwiftShader encarecía la
 * compilación de cada `toMaterial`). W_e, la ventana elevacional (la huella mide 13 mm), y T_l, más allá del borde
 * de la cara los nodos del borde se apagan en `lateralTaperSin` (en σ). Después, la respiración (`deformation.ts`).
 *
 * Todo lo que pasa por `toMaterial` ve el mismo tejido deformado: clasificación, moteado anclado, transmisión,
 * ecos de interfaz, pleura y cortina, velocidades Doppler y los gemelos TS. Las direcciones (la incidencia de un
 * eco, la de una lámina de la textura) se llevan al mundo con la jacobiana de la inversa (`warpAt`,
 * `warpNormal`): ∇_mundo = J^T·∇_material, J = I + r̂⊗∇s + (s/ρ)·(I − r̂r̂ − êê). Gemelo GLSL con los mismos
 * nombres: `COMPRESSION_GLSL`.
 */
export const PROBE_COMPRESSION = {
  /**
   * Nodos de la tabla a lo largo de la cara, de −halfAngle a +halfAngle (un téxel cada uno; 3 líneas de 192 por
   * nodo). Entre nodos la tabla es lineal: la pendiente de las capas en el mundo oscila con el periodo de un nodo
   * (con 32, hasta 9° en la media pared de la intercostal: el eco especular de las fascias se «abalorio»).
   */
  nodes: 64,
  /**
   * L (mm): bajo la pared el empuje se apaga en al menos 2·L con un smoothstep. [ESTIMADO 12–25 mm; ver
   * DECISIONS 63: carga en franja de Boussinesq/Flamant sobre la huella de 13 × 62 mm, de memoria]
   */
  decayMm: 16,
  /**
   * κ: la caída bajo la pared mide al menos κ veces el empuje s_D, así el tejido de debajo se comprime a lo largo de
   * la línea a lo sumo 1,5/κ (el hígado, casi incompresible, ≤ 20 %: con κ = 4, 27 %, y el hígado despejado del
   * banco en la subxifoidea pasaba de 31 a 22 parches). A cambio lo hondo se mueve más: con el empuje de 15–24 mm,
   * los vasos y el riñón a más de 6 cm, 8–14 mm. [ESTIMADO]
   */
  decaySpanPerShift: 6,
  /** Más allá del borde de la cara la tabla se apaga en este intervalo de σ = sen α (~6° y ~6 mm de arco). [ESTIMADO] */
  lateralTaperSin: 0.09,
  /** Más allá de la media huella elevacional se apaga en estos mm. [ESTIMADO] */
  elevationTaperMm: 10,
} as const;

/** Un nodo de la cara: (s₀ mm, s_D mm, D mm). */
export type CompressionNode = readonly [number, number, number];

/**
 * Estado del contacto de un cuadro (lo calcula `probe/contact.ts` desde la pose): la geometría de la cara ya
 * hundida y la tabla por nodo. Datos planos: la anatomía no conoce la sonda.
 */
export interface ProbeCompression {
  /** Centro de curvatura de la cara (mm, mundo), el del marco efectivo (con la indentación). */
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
  /** Espesor de la pared (mm). */
  plateMm: number;
  /** Tabla por nodo: (s₀, s_D, D); `PROBE_COMPRESSION.nodes` nodos. La que sube a la GPU (`uSceneTex`). */
  nodes: readonly CompressionNode[];
  /** Profundidad bajo la cara (mm) desde la que s = 0: el máximo de D + S en la tabla (`compressionReachMm`). */
  reachMm: number;
  /** Contacto conseguido por nodo (0–1): el acoplamiento de las líneas (`probe/contact.ts`). Solo CPU. */
  contact: readonly number[];
}

/** Espesor total de la pared (mm): piel, grasa y músculo con la preperitoneal. */
export function compressionPlateMm(t: Torso): number {
  return t.skinMm + t.fatMm + t.muscleMm;
}

/** S: longitud de la caída del empuje bajo la pared (mm), max(2L, κ·|s_D|). */
export function compressionSpanMm(sD: number): number {
  return Math.max(2 * PROBE_COMPRESSION.decayMm, PROBE_COMPRESSION.decaySpanPerShift * Math.max(0, -sD));
}

/**
 * Alcance del campo (mm bajo la cara): max_k (D_k + S_k). Entre dos nodos D y s_D se interpolan linealmente y
 * D + max(2L, −κ·s_D) es convexa en la interpolación: su máximo está en los nodos.
 */
export function compressionReachMm(nodes: readonly CompressionNode[]): number {
  let r = 0;
  for (const n of nodes) r = Math.max(r, n[2] + compressionSpanMm(n[1]));
  return r;
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

/** Perfil g(d) a lo largo de la línea de un nodo (s₀, s_D, D) y sus derivadas (en d y en los tres parámetros). */
interface Profile {
  g: number;
  /** ∂g/∂d. */
  gd: number;
  /** ∂g/∂s₀, ∂g/∂s_D, ∂g/∂D. */
  g0: number;
  gD: number;
  gDepth: number;
}

function profile(depth: number, s0: number, sD: number, D: number): Profile {
  if (depth <= 0) return { g: s0, gd: 0, g0: 1, gD: 0, gDepth: 0 };
  if (depth < D) {
    const t = depth / D;
    return { g: s0 + (sD - s0) * t, gd: (sD - s0) / D, g0: 1 - t, gD: t, gDepth: (-(sD - s0) * t) / D };
  }
  const C = PROBE_COMPRESSION;
  const longSpan = -C.decaySpanPerShift * sD > 2 * C.decayMm;
  const span = longSpan ? -C.decaySpanPerShift * sD : 2 * C.decayMm;
  const u = Math.min(1, (depth - D) / span);
  const f = 1 - u * u * (3 - 2 * u);
  const fu = u < 1 ? -6 * u * (1 - u) : 0;
  // ∂u/∂s_D (por S) y ∂u/∂D
  const uS = longSpan ? (u / span) * C.decaySpanPerShift : 0;
  return { g: sD * f, gd: (sD * fu) / span, g0: 0, gD: f + sD * fu * uS, gDepth: (-sD * fu) / span };
}

/** (s₀, s_D, D) en σ con interpolación lineal, su derivada en σ (0 fuera de la cara) y la cola lateral T_l. */
function tableAt(sigma: number, k: ProbeCompression): { v: CompressionNode; dv: CompressionNode; tl: number; dtl: number } {
  const C = PROBE_COMPRESSION;
  const h = Math.sin(k.halfAngle);
  const n = C.nodes;
  const xr = ((sigma + h) / (2 * h)) * (n - 1);
  const x = clamp(xr, 0, n - 1);
  const i = Math.min(Math.floor(x), n - 2);
  const t = x - i;
  const a = k.nodes[i];
  const b = k.nodes[i + 1];
  // en el borde exacto de la cara (las líneas extremas) la pendiente de dentro: la de las líneas vecinas
  const inside = xr >= -1e-4 && xr <= n - 1 + 1e-4 ? (n - 1) / (2 * h) : 0;
  return {
    v: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    dv: [(b[0] - a[0]) * inside, (b[1] - a[1]) * inside, (b[2] - a[2]) * inside],
    tl: 1 - smoothstep(h, h + C.lateralTaperSin, Math.abs(sigma)),
    dtl: -smoothstepSlope(h, h + C.lateralTaperSin, Math.abs(sigma)) * Math.sign(sigma),
  };
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
  if (depth >= k.reachMm || Math.abs(e) >= k.halfElevationMm + PROBE_COMPRESSION.elevationTaperMm || dot(P, k.axial) <= 0)
    return { shift: 0, rhat, rho };
  const { v, tl } = tableAt(dot(P, k.lateral) / rho, k);
  const we = 1 - smoothstep(k.halfElevationMm, k.halfElevationMm + PROBE_COMPRESSION.elevationTaperMm, Math.abs(e));
  return { shift: we * tl * profile(depth, v[0], v[1], v[2]).g, rhat, rho };
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
  /** D ∇w / det(J), en el marco material; ausente significa respiración OFF. */
  respiratory?: Vec3;
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
  const E0 = k.halfElevationMm;
  if (depth >= k.reachMm || Math.abs(e) >= E0 + C.elevationTaperMm || dot(P, k.axial) <= 0)
    return { shift: 0, rhat, rho, elevation: el, grad: ZERO };
  const sigma = dot(P, k.lateral) / rho;
  const { v, dv, tl, dtl } = tableAt(sigma, k);
  const pr = profile(depth, v[0], v[1], v[2]);
  // la ventana elevacional es plana en ±E0 (toda muestra de la imagen cae ahí): su derivada no se lleva
  const we = 1 - smoothstep(E0, E0 + C.elevationTaperMm, Math.abs(e));
  const dDepth = we * tl * pr.gd;
  const dSigma = we * (dtl * pr.g + tl * (pr.g0 * dv[0] + pr.gD * dv[1] + pr.gDepth * dv[2]));
  // ∇σ = (lateral − σ·r̂)/ρ
  const q = dSigma / rho;
  const grad: Vec3 = [
    dDepth * rhat[0] + q * (k.lateral[0] - sigma * rhat[0]),
    dDepth * rhat[1] + q * (k.lateral[1] - sigma * rhat[1]),
    dDepth * rhat[2] + q * (k.lateral[2] - sigma * rhat[2]),
  ];
  return { shift: we * tl * pr.g, rhat, rho, elevation: el, grad };
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
 * Si hay respiración, primero se aplica J_resp^(-T): n − (D∇w/det)·(dir·n), sin normalizar.
 */
export function warpNormal(w: Warp, n: Vec3): Vec3 {
  if (w.respiratory) {
    const dn = dot(RESPIRATORY_DIRECTION, n);
    n = [n[0] - w.respiratory[0] * dn, n[1] - w.respiratory[1] * dn, n[2] - w.respiratory[2] * dn];
  }
  const rn = dot(w.rhat, n);
  const en = dot(w.elevation, n);
  const q = w.shift / w.rho;
  return [
    n[0] + rn * w.grad[0] + q * (n[0] - rn * w.rhat[0] - en * w.elevation[0]),
    n[1] + rn * w.grad[1] + q * (n[1] - rn * w.rhat[1] - en * w.elevation[1]),
    n[2] + rn * w.grad[2] + q * (n[2] - rn * w.rhat[2] - en * w.elevation[2]),
  ];
}

/** Cota de norma de la composición: (1 + |∇s| + |s|/ρ) · (1 + |D∇w/det|). */
export function warpBound(w: Warp): number {
  return (1 + length(w.grad) + Math.abs(w.shift) / w.rho) * (1 + (w.respiratory ? length(w.respiratory) : 0));
}

const f4 = (x: number): string => x.toFixed(4);

/**
 * Gemelo GLSL (en `ANATOMY_GLSL`, antes de `toMaterial`; usa los uniforms `uComp*` del esquema único,
 * `anatomy/gpu/sceneUniforms.ts`): uCompC = (centro, R + alcance; 0 = sin compresión), uCompAx = (axial,
 * sen del semiángulo), uCompLat = (lateral, media huella elevacional) y la tabla en la textura de escena, un téxel
 * por nodo (s₀, s_D, D, R): el radio viaja en la tabla para que el alcance quepa en las tres ranuras.
 */
export const COMPRESSION_GLSL = /* glsl */ `
#define COMP_NODES ${PROBE_COMPRESSION.nodes}
#define COMP_DECAY_MM ${f4(PROBE_COMPRESSION.decayMm)}
#define COMP_SPAN_PER_SHIFT ${f4(PROBE_COMPRESSION.decaySpanPerShift)}
#define COMP_LAT_TAPER ${f4(PROBE_COMPRESSION.lateralTaperSin)}
#define COMP_ELEV_TAPER ${f4(PROBE_COMPRESSION.elevationTaperMm)}
// la tabla por nodo en la textura de escena (COMP_BASE, de ANATOMY_GLSL): (s₀, s_D, D, R)
vec4 compressionTable(int i) { return sceneTexel(COMP_BASE + i); }
vec3 compressionElevation() { return cross(uCompAx.xyz, uCompLat.xyz); }
// perfil g(d) de un nodo (s₀, s_D, D) interpolado; gd = ∂g/∂d y gp = (∂g/∂s₀, ∂g/∂s_D, ∂g/∂D)
float compressionProfile(float depth, vec3 v, out float gd, out vec3 gp) {
  if (depth <= 0.0) { gd = 0.0; gp = vec3(1.0, 0.0, 0.0); return v.x; }
  if (depth < v.z) {
    float t = depth / v.z;
    gd = (v.y - v.x) / v.z;
    gp = vec3(1.0 - t, t, -(v.y - v.x) * t / v.z);
    return v.x + (v.y - v.x) * t;
  }
  bool longSpan = -COMP_SPAN_PER_SHIFT * v.y > 2.0 * COMP_DECAY_MM;
  float span = longSpan ? -COMP_SPAN_PER_SHIFT * v.y : 2.0 * COMP_DECAY_MM;
  float u = min(1.0, (depth - v.z) / span);
  float f = 1.0 - u * u * (3.0 - 2.0 * u);
  float fu = u < 1.0 ? -6.0 * u * (1.0 - u) : 0.0;
  float uS = longSpan ? u / span * COMP_SPAN_PER_SHIFT : 0.0;
  gd = v.y * fu / span;
  gp = vec3(0.0, f + v.y * fu * uS, -v.y * fu / span);
  return v.y * f;
}
// s(p) a lo largo de r̂ (anatomy/compression.ts); rhat y rho, la geometría polar de la cara
float compressionSample(vec3 p, out vec3 rhat, out float rho) {
  vec3 el = compressionElevation();
  vec3 d = p - uCompC.xyz;
  float e = dot(d, el);
  vec3 P = d - e * el;
  rho = length(P);
  rhat = rho > 1e-6 ? P / rho : vec3(0.0);
  if (rho < 1e-6 || rho >= uCompC.w || abs(e) >= uCompLat.w + COMP_ELEV_TAPER || dot(P, uCompAx.xyz) <= 0.0) return 0.0;
  float sg = dot(P, uCompLat.xyz) / rho;
  float h = uCompAx.w;
  float x = clamp((sg + h) / (2.0 * h) * float(COMP_NODES - 1), 0.0, float(COMP_NODES - 1));
  int i = min(int(floor(x)), COMP_NODES - 2);
  vec4 v = mix(compressionTable(i), compressionTable(i + 1), x - float(i));
  float gd;
  vec3 gp;
  float g = compressionProfile(rho - v.w, v.xyz, gd, gp);
  float we = 1.0 - smoothstep(uCompLat.w, uCompLat.w + COMP_ELEV_TAPER, abs(e));
  return we * (1.0 - smoothstep(h, h + COMP_LAT_TAPER, abs(sg))) * g;
}
vec3 uncompress(vec3 p) {
  vec3 rhat;
  float rho;
  float s = compressionSample(p, rhat, rho);
  return p + s * rhat;
}
// Jacobiana de la inversa: s, r̂, ρ y ∇s (analítico: una evaluación del campo), para llevar normales al mundo
struct Warp { float s; vec3 rhat; float rho; vec3 g; vec3 respiratory; };
Warp noWarp() { Warp w; w.s = 0.0; w.rhat = vec3(0.0); w.rho = 1.0; w.g = vec3(0.0); w.respiratory = vec3(0.0); return w; }
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
  float E0 = uCompLat.w;
  if (rho >= uCompC.w || abs(e) >= E0 + COMP_ELEV_TAPER || dot(P, uCompAx.xyz) <= 0.0) return w;
  float sg = dot(P, uCompLat.xyz) / rho;
  float h = uCompAx.w;
  float xr = (sg + h) / (2.0 * h) * float(COMP_NODES - 1);
  float x = clamp(xr, 0.0, float(COMP_NODES - 1));
  int i = min(int(floor(x)), COMP_NODES - 2);
  vec4 a = compressionTable(i);
  vec4 b = compressionTable(i + 1);
  float inside = xr >= -1e-4 && xr <= float(COMP_NODES - 1) + 1e-4 ? float(COMP_NODES - 1) / (2.0 * h) : 0.0;
  vec4 v = mix(a, b, x - float(i));
  vec3 dv = (b.xyz - a.xyz) * inside;
  float tl = 1.0 - smoothstep(h, h + COMP_LAT_TAPER, abs(sg));
  float dtl = -smoothstepSlope(h, h + COMP_LAT_TAPER, abs(sg)) * sign(sg);
  float gd;
  vec3 gp;
  float g = compressionProfile(rho - v.w, v.xyz, gd, gp);
  float we = 1.0 - smoothstep(E0, E0 + COMP_ELEV_TAPER, abs(e));
  float dSigma = we * (dtl * g + tl * dot(gp, dv));
  w.s = we * tl * g;
  w.g = we * tl * gd * w.rhat + dSigma / rho * (uCompLat.xyz - sg * w.rhat);
  return w;
}
vec3 warpNormal(Warp w, vec3 n) {
  n -= w.respiratory * dot(vec3(${RESPIRATORY_DIRECTION.map((v) => v.toPrecision(15)).join(',')}), n);
  float rn = dot(w.rhat, n);
  vec3 el = compressionElevation();
  return n + rn * w.g + (w.s / w.rho) * (n - rn * w.rhat - dot(el, n) * el);
}
// Cota de |J^T·n|/|n|: la salida barata del eco de interfaz la usa para no descartar muestras a su alcance
float warpBound(Warp w) { return (1.0 + length(w.g) + abs(w.s) / w.rho) * (1.0 + length(w.respiratory)); }
`;
