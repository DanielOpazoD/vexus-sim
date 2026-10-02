import type { Vec3 } from '../core/vec3';
import { TISSUE_GLSL_NAME, Tissue } from '../anatomy/tissues';
import { glslFloat } from './receiver';

/**
 * Medio de dispersores anclado (decisión 55). El moteado sale de un campo complejo en una retícula
 * de 0,42 mm cuya coordenada elevacional se comprime hasta el grosor de corte, para que la textura
 * se decorrele al inclinar la sonda un grosor de corte y no una célula (decisión 19, idea tomada de EchoTwin).
 * Esa compresión necesita un eje y un pivote. Antes eran la normal ACTUAL del plano y el origen del
 * mundo: el medio cambiaba al girar la sonda, y a 100 mm del origen un giro de 0,5° desplazaba el
 * campo 0,9 mm (correlación 0,16 con 0,5° y 0,02 con 1°, cuando un equipo conserva el moteado).
 *
 * Ahora el eje y el pivote son un ANCLA que se fija con la sonda y no la sigue: el medio queda
 * quieto y la imagen se decorrela solo porque el plano atraviesa otro tejido, como en un equipo
 * (gemelo: 0,95 con 0,5° de inclinación, 0,83 con 1°, 0,11 con 4°). Con la normal apartada α del
 * ancla, la célula elevacional se adelgaza (|dq/dn| = √(sin²α + k²cos²α), k ≈ 0,13): a 20° la
 * persistencia con 0,5° cae a 0,3–0,65 y la SNR sube un 11–17 %; a 5,5° sigue en 0,93 y +3–9 %. Así
 * que pasados REANCHOR_DEG el ancla se renueva con un fundido de CROSSFADE_SECONDS segundos entre los dos medios,
 * con semillas distintas: la suma √w·A + √(1−w)·B de dos campos gaussianos independientes sigue
 * siendo gaussiana, así que la estadística de Rayleigh no cambia durante el fundido. Un salto de
 * pose (el teletransporte de los ganchos de prueba) y el cambio de paciente reinician el ancla sin
 * fundido; los puntos de partida de la app se animan y reanclan con fundido.
 *
 * Gemelos: `speckleSliceField` (TS, pruebas) y `scattererFieldSlice` de la pasada B, misma fórmula.
 */

/** Ángulo entre la normal del plano y la del ancla a partir del cual se renueva el ancla. */
export const REANCHOR_DEG = 6;
/** Duración de transición [EXTRAPOLACIÓN PROPIA]: ocho cuadros a 60 Hz, ahora en tiempo de simulación. */
export const CROSSFADE_SECONDS = 8 / 60;
/** Entre dos cuadros, un desplazamiento o un giro mayores son un salto de pose: el ancla se reinicia. */
export const JUMP_MM = 15;
export const JUMP_DEG = 10;
/** Desplazamiento de la semilla del medio con paridad impar (dos medios independientes en el fundido). */
export const ANCHOR_SALT_STEP = 101.37;

export interface SpeckleAnchor {
  /** Eje de compresión (normal del plano cuando se fijó). */
  e: Vec3;
  /** Pivote: la coordenada elevacional se mide desde aquí (centro de la cara al fijarla). */
  p: Vec3;
  /** Paridad de la semilla (0/1): los dos medios del fundido son independientes. */
  parity: 0 | 1;
}

export interface SpeckleAnchorState {
  /** Ancla vigente. */
  a: SpeckleAnchor;
  /** Ancla anterior (igual a `a` fuera de un fundido). */
  b: SpeckleAnchor;
  /** Peso de potencia del ancla vigente (1 fuera del fundido): el campo es √w·A + √(1−w)·B. */
  w: number;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Ángulo entre ejes (°), sin signo: la compresión no distingue e de −e. */
const axisAngleDeg = (a: Vec3, b: Vec3): number => (Math.acos(Math.min(1, Math.abs(dot(a, b)))) * 180) / Math.PI;
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Ancla del medio de dispersores. `update` se llama una vez por cuadro renderizado con la cara y la
 * normal del plano y el tiempo del reloj único; devuelve las dos anclas y el peso del fundido que usa la pasada B.
 */
export class ElevationAnchor {
  private a: SpeckleAnchor | null = null;
  private b: SpeckleAnchor | null = null;
  private fadeStart: number | null = null;
  private lastTime = 0;
  private last: { face: Vec3; e: Vec3 } | null = null;

  /** Olvida el ancla: el siguiente cuadro fija una nueva (cambio de paciente). */
  reset(): void {
    this.a = null;
    this.b = null;
    this.fadeStart = null;
    this.lastTime = 0;
    this.last = null;
  }

  update(face: Vec3, elevation: Vec3, timeSeconds: number): SpeckleAnchorState {
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) throw new Error('Tiempo de moteado inválido');
    if (timeSeconds < this.lastTime) this.reset();
    const advancing = timeSeconds > this.lastTime;
    this.lastTime = timeSeconds;
    const here = (parity: 0 | 1): SpeckleAnchor => ({ e: [...elevation], p: [...face], parity });
    const jumped = this.last !== null && (dist(face, this.last.face) > JUMP_MM || axisAngleDeg(elevation, this.last.e) > JUMP_DEG);
    this.last = { face: [...face], e: [...elevation] };
    if (this.a === null || jumped) {
      this.a = here(0);
      this.b = this.a;
      this.fadeStart = null;
    } else if (advancing && this.fadeStart === null && axisAngleDeg(elevation, this.a.e) > REANCHOR_DEG) {
      // No se sustituye el medio viejo a mitad del fundido. En el instante inicial w=0:
      // repetir una pasada o renderizar con el reloj pausado no consume transición.
      this.b = this.a;
      this.a = here(this.a.parity === 0 ? 1 : 0);
      this.fadeStart = timeSeconds;
    }
    const elapsed = this.fadeStart === null ? CROSSFADE_SECONDS : timeSeconds - this.fadeStart;
    const w = elapsed >= CROSSFADE_SECONDS - 1e-12 ? 1 : elapsed / CROSSFADE_SECONDS;
    if (w === 1) {
      this.fadeStart = null;
      this.b = this.a;
    }
    return { a: this.a, b: this.b ?? this.a, w };
  }
}

// ——— Gemelo TS del campo de la pasada B (pruebas) ———

const f32 = Math.fround;
const fract = (x: number): number => f32(x - Math.floor(x));

/** `hash13` de `anatomy.glsl.ts`, en float32. */
export function hash13(p: Vec3): number {
  let x = fract(f32(p[0] * 0.1031));
  let y = fract(f32(p[1] * 0.1031));
  let z = fract(f32(p[2] * 0.1031));
  const d = f32(f32(x * f32(y + 33.33)) + f32(y * f32(z + 33.33)) + f32(z * f32(x + 33.33)));
  x = f32(x + d);
  y = f32(y + d);
  z = f32(z + d);
  return fract(f32(f32(x + y) * z));
}

// ——— Dispersores fuertes (decisión 89) ———

/**
 * (p, a, k) de `latticeValueS` (anatomía GLSL): una fracción p de los nodos de la retícula lleva la amplitud ×a y el
 * resto ×k. (0, 1, 1) es el nodo de siempre, bit a bit.
 */
export type StrongScatter = readonly [number, number, number];
export const NO_STRONG: StrongScatter = [0, 1, 1];

/**
 * El nodo fuerte (o no) según su hash de fase b: [factor de amplitud, fracción de vuelta de su fase]. Son fuertes los
 * nodos con b ≥ 1 − p (b es uniforme: la fracción es p) y la fase de cada grupo se reparte en toda la vuelta,
 * (b − 1 + p)/p en los fuertes y b/(1 − p) en el resto, así que ninguno de los dos grupos tiene fase preferida ni depende
 * de la amplitud (el otro hash). Los bits finos de b no sirven para elegir: `hash13` sale de la parte fraccionaria de un
 * producto de ~5·10³ y en float32 solo tiene ~2⁻¹¹ de resolución (con fract(991·b) < p la fase de los fuertes se
 * agrupaba: resultante media 0,48). Se eligen por arriba porque b = 0 exacto se repite (~0,04 % de los nodos): por
 * abajo caería entero en los fuertes. Con p = 0, b/(1 − 0) = b: el nodo de siempre, bit a bit.
 */
export function strongNode(b: number, s: StrongScatter): [number, number] {
  const q = f32(1 - f32(s[0]));
  return b >= q ? [s[1], f32(f32(b - q) / f32(s[0]))] : [s[2], f32(b / q)];
}

/** Factor de amplitud del nodo con hash de fase b (`strongNode`). */
export function strongFactor(b: number, s: StrongScatter): number {
  return strongNode(b, s)[0];
}

function latticeValue(c: Vec3, salt: number, s: StrongScatter = NO_STRONG): [number, number] {
  const a = hash13([c[0] + salt, c[1], c[2]]);
  const b = hash13([c[0], c[1] + salt + 17.1, c[2]]);
  const [k, turn] = strongNode(b, s);
  const r = Math.sqrt(-2 * Math.log(Math.max(1e-6, a))) * k;
  const ph = 6.2831853 * turn;
  return [r * Math.cos(ph), r * Math.sin(ph)];
}

const mix2 = (a: [number, number], b: [number, number], t: number): [number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

/**
 * `scattererField` (`scattererFieldS` con `strong`): interpolación con fundido smoothstep del campo complejo de la
 * retícula de paso h; `strong`, los dispersores fuertes del tejido (decisión 89).
 */
export function scattererField(m: Vec3, h: number, salt: number, strong: StrongScatter = NO_STRONG): [number, number] {
  const q: Vec3 = [m[0] / h, m[1] / h, m[2] / h];
  const c: Vec3 = [Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2])];
  const s = [0, 1, 2].map((i) => {
    const t = q[i] - c[i];
    return t * t * (3 - 2 * t);
  });
  const L = (dx: number, dy: number, dz: number) => latticeValue([c[0] + dx, c[1] + dy, c[2] + dz], salt, strong);
  const x00 = mix2(L(0, 0, 0), L(1, 0, 0), s[0]);
  const x10 = mix2(L(0, 1, 0), L(1, 1, 0), s[0]);
  const x01 = mix2(L(0, 0, 1), L(1, 0, 1), s[0]);
  const x11 = mix2(L(0, 1, 1), L(1, 1, 1), s[0]);
  return mix2(mix2(x00, x10, s[1]), mix2(x01, x11, s[1]), s[2]);
}

/** `scattererFieldSlice`: la coordenada elevacional, medida desde el pivote del ancla, se comprime a h/(2·σe). */
export function anchoredSliceField(
  m: Vec3,
  h: number,
  sliceHalfMm: number,
  salt: number,
  anchor: SpeckleAnchor,
  strong: StrongScatter = NO_STRONG,
): [number, number] {
  const e = anchor.e;
  const across = dot([m[0] - anchor.p[0], m[1] - anchor.p[1], m[2] - anchor.p[2]], e);
  const shrink = across * (1 - h / Math.max(h, 2 * sliceHalfMm));
  return scattererField(
    [m[0] - e[0] * shrink, m[1] - e[1] * shrink, m[2] - e[2] * shrink],
    h,
    salt + anchor.parity * ANCHOR_SALT_STEP,
    strong,
  );
}

/** Campo del medio con el fundido entre anclas (`speckleField` de la pasada B); `strong`, los dispersores fuertes del tejido. */
export function speckleSliceField(
  m: Vec3,
  h: number,
  sliceHalfMm: number,
  salt: number,
  st: SpeckleAnchorState,
  strong: StrongScatter = NO_STRONG,
): [number, number] {
  const fa = anchoredSliceField(m, h, sliceHalfMm, salt, st.a, strong);
  if (st.w >= 1) return fa;
  const fb = anchoredSliceField(m, h, sliceHalfMm, salt, st.b, strong);
  const wa = Math.sqrt(st.w);
  const wb = Math.sqrt(1 - st.w);
  return [wa * fa[0] + wb * fb[0], wa * fa[1] + wb * fb[1]];
}

// ——— Fase de mirada por nodo (composición espacial, decisión 58) ———

/**
 * Fase de una mirada dirigida en el punto de la muestra (decisión 58, `steering.ts`): Δ_k(P) y su
 * gradiente g = k2·(b_k − b_0) en el mundo (rad/mm). La pasada B la calcula una vez por muestra y la
 * reparte por nodo en su forma lineal, Δ_k(P) + g⊥·(x_n − P), dentro del cos/sin que ya existe en
 * `latticeValue` (sin sincos extra). g⊥ es g sin su componente en el eje del ancla: a lo largo de ese eje
 * la coordenada del medio está comprimida al grosor de corte y el desplazamiento del nodo no es el del
 * mundo (g, en el plano de imagen, apenas la tiene). El valor del nodo (c_n, con su sal por tejido y por
 * ancla) es el de siempre: grumos y heterogeneidad son del material y comunes a todas las miradas. La
 * forma lineal se aparta de la fase exacta del nodo ≤ 1e-2 rad (5,5e-3 a 20 mm).
 */
export interface LookPhase {
  /** Δ_k en el punto de la muestra (rad). */
  ph0: number;
  /** Gradiente de Δ_k en el mundo (rad/mm). */
  g: Vec3;
}

/** `latticeValue` con la fase de mirada sumada a la del nodo: con ph = 0, idéntico bit a bit. Los nodos fuertes son los mismos. */
export function latticeValuePh(c: Vec3, salt: number, ph: number, strong: StrongScatter = NO_STRONG): [number, number] {
  const a = hash13([c[0] + salt, c[1], c[2]]);
  const b = hash13([c[0], c[1] + salt + 17.1, c[2]]);
  const [k, turn] = strongNode(b, strong);
  const r = Math.sqrt(-2 * Math.log(Math.max(1e-6, a))) * k;
  const p = 6.2831853 * turn + ph;
  return [r * Math.cos(p), r * Math.sin(p)];
}

/**
 * `scattererField` de una mirada: el nodo c + d lleva la fase ph0 + g·(c + d − m/h)·h, escrita como
 * base + (g·h)·d con base = ph0 − (g·h)·(m/h − c), para no restar coordenadas grandes. Sin fase
 * (`lp` null) es `scattererField`; con ph0 = 0 y g = 0 da lo mismo bit a bit.
 */
export function scattererFieldPh(
  m: Vec3,
  h: number,
  salt: number,
  lp: LookPhase | null,
  strong: StrongScatter = NO_STRONG,
): [number, number] {
  if (lp === null) return scattererField(m, h, salt, strong);
  const q: Vec3 = [m[0] / h, m[1] / h, m[2] / h];
  const c: Vec3 = [Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2])];
  const fr = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
  const s = fr.map((t) => t * t * (3 - 2 * t));
  const gh: Vec3 = [lp.g[0] * h, lp.g[1] * h, lp.g[2] * h];
  const base = lp.ph0 - (gh[0] * fr[0] + gh[1] * fr[1] + gh[2] * fr[2]);
  const L = (dx: number, dy: number, dz: number) =>
    latticeValuePh([c[0] + dx, c[1] + dy, c[2] + dz], salt, base + gh[0] * dx + gh[1] * dy + gh[2] * dz, strong);
  const x00 = mix2(L(0, 0, 0), L(1, 0, 0), s[0]);
  const x10 = mix2(L(0, 1, 0), L(1, 1, 0), s[0]);
  const x01 = mix2(L(0, 0, 1), L(1, 0, 1), s[0]);
  const x11 = mix2(L(0, 1, 1), L(1, 1, 1), s[0]);
  return mix2(mix2(x00, x10, s[1]), mix2(x01, x11, s[1]), s[2]);
}

/** `anchoredSliceField` de una mirada: la fase se reparte con g⊥ (sin la componente del eje del ancla). */
export function anchoredSliceFieldPh(
  m: Vec3,
  h: number,
  sliceHalfMm: number,
  salt: number,
  anchor: SpeckleAnchor,
  lp: LookPhase | null,
  strong: StrongScatter = NO_STRONG,
): [number, number] {
  if (lp === null) return anchoredSliceField(m, h, sliceHalfMm, salt, anchor, strong);
  const e = anchor.e;
  const across = dot([m[0] - anchor.p[0], m[1] - anchor.p[1], m[2] - anchor.p[2]], e);
  const shrink = across * (1 - h / Math.max(h, 2 * sliceHalfMm));
  const ge = dot(lp.g, e);
  const gPerp: Vec3 = [lp.g[0] - e[0] * ge, lp.g[1] - e[1] * ge, lp.g[2] - e[2] * ge];
  return scattererFieldPh(
    [m[0] - e[0] * shrink, m[1] - e[1] * shrink, m[2] - e[2] * shrink],
    h,
    salt + anchor.parity * ANCHOR_SALT_STEP,
    { ph0: lp.ph0, g: gPerp },
    strong,
  );
}

/** `speckleSliceField` de una mirada (con el fundido entre anclas). Sin fase es `speckleSliceField`. */
export function speckleSliceFieldPh(
  m: Vec3,
  h: number,
  sliceHalfMm: number,
  salt: number,
  st: SpeckleAnchorState,
  lp: LookPhase | null,
  strong: StrongScatter = NO_STRONG,
): [number, number] {
  if (lp === null) return speckleSliceField(m, h, sliceHalfMm, salt, st, strong);
  const fa = anchoredSliceFieldPh(m, h, sliceHalfMm, salt, st.a, lp, strong);
  if (st.w >= 1) return fa;
  const fb = anchoredSliceFieldPh(m, h, sliceHalfMm, salt, st.b, lp, strong);
  const wa = Math.sqrt(st.w);
  const wb = Math.sqrt(1 - st.w);
  return [wa * fa[0] + wb * fb[0], wa * fa[1] + wb * fb[1]];
}

/**
 * Gemelo GLSL de las variantes con fase de mirada para la rama dirigida de la pasada B (etapa 2 de la
 * decisión 58). Va en `FRAG_RAWFIELD` detrás de `speckleField` (usa hash13 de la anatomía, uSeed y las
 * uniforms del ancla); la mirada 0 no lo llama. ph0 y g salen de `lookPhase`/`lookPhaseGrad`
 * (`STEERING_GLSL`), con g = gx·uLateral + gz·uAxial.
 */
export const SPECKLE_LOOK_GLSL = /* glsl */ `
vec2 latticeValuePh(vec3 cell, float salt, float ph, vec3 s) {
  float a = hash13(cell + vec3(salt, 0.0, 0.0));
  float b = hash13(cell + vec3(0.0, salt + 17.1, 0.0));
  bool strong = b >= 1.0 - s.x;
  float r = sqrt(-2.0 * log(max(1e-6, a))) * (strong ? s.y : s.z);
  float p = 6.2831853 * (strong ? (b - (1.0 - s.x)) / s.x : b / (1.0 - s.x)) + ph;
  return r * vec2(cos(p), sin(p));
}
vec2 scattererFieldPh(vec3 m, float h, float salt, float ph0, vec3 g, vec3 s) {
  vec3 q = m / h;
  vec3 c0 = floor(q);
  vec3 fr = q - c0;
  vec3 f = fr * fr * (3.0 - 2.0 * fr);
  vec3 gh = g * h;
  float base = ph0 - dot(gh, fr);
  vec2 v000 = latticeValuePh(c0, salt, base, s);
  vec2 v100 = latticeValuePh(c0 + vec3(1, 0, 0), salt, base + gh.x, s);
  vec2 v010 = latticeValuePh(c0 + vec3(0, 1, 0), salt, base + gh.y, s);
  vec2 v110 = latticeValuePh(c0 + vec3(1, 1, 0), salt, base + gh.x + gh.y, s);
  vec2 v001 = latticeValuePh(c0 + vec3(0, 0, 1), salt, base + gh.z, s);
  vec2 v101 = latticeValuePh(c0 + vec3(1, 0, 1), salt, base + gh.x + gh.z, s);
  vec2 v011 = latticeValuePh(c0 + vec3(0, 1, 1), salt, base + gh.y + gh.z, s);
  vec2 v111 = latticeValuePh(c0 + vec3(1, 1, 1), salt, base + gh.x + gh.y + gh.z, s);
  vec2 x00 = mix(v000, v100, f.x);
  vec2 x10 = mix(v010, v110, f.x);
  vec2 x01 = mix(v001, v101, f.x);
  vec2 x11 = mix(v011, v111, f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}
vec2 scattererFieldSlicePh(vec3 m, float h, float sliceHalfMm, float salt, vec3 e, vec3 pivot, float ph0, vec3 g, vec3 s) {
  float across = dot(m - pivot, e);
  vec3 q = m - e * (across * (1.0 - h / max(h, 2.0 * sliceHalfMm)));
  return scattererFieldPh(q, h, salt, ph0, g - e * dot(g, e), s);
}
vec2 speckleFieldPh(vec3 m, float h, float se, float salt, float ph0, vec3 g, vec3 s) {
  vec2 fa = scattererFieldSlicePh(m, h, se, uSeed + salt + uAnchorSalt.x, uAnchorE0, uAnchorP0, ph0, g, s);
  if (uAnchorW >= 1.0) return fa;
  vec2 fb = scattererFieldSlicePh(m, h, se, uSeed + salt + uAnchorSalt.y, uAnchorE1, uAnchorP1, ph0, g, s);
  return sqrt(uAnchorW) * fa + sqrt(1.0 - uAnchorW) * fb;
}
`;

// ——— Moteado por tejido (decisión 56) ———

/**
 * Paso de semilla entre tejidos: cada tejido tiene su propia población de dispersores, así que su
 * moteado es otra realización y no continúa a través de un borde. El hash repite con periodo
 * 1/0,1031 ≈ 9,70 en su coordenada: 9,861 deja todas las diferencias de semilla (tejido y paridad
 * del ancla) a ≥ 0,017 de un periodo (7,919 dejaba una a 0,002, y esa pareja correlacionaba).
 */
export const TISSUE_SALT_STEP = 9.861;
/** Célula de la heterogeneidad lenta del parénquima (mm). */
export const HET_CELL_MM = 6.25;
/**
 * Escala del ruido de valor de la heterogeneidad (dB por unidad): da la misma desviación que los
 * antiguos cubos uniformes de ±2 dB (1,15 dB), ahora continua.
 */
export const HET_SCALE_DB = 6.24;
/** Célula de los grumos de dispersores (mm): ~ la PSF lateral, para que se vean como ecos sueltos. */
export const CLUMP_CELL_MM = 1.2;

/** Ruido de valor 3D en [0, 1] con fundido smoothstep (continuo, correlación ~ 1 célula). */
export function valueNoise(q: Vec3, salt: number): number {
  const c: Vec3 = [Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2])];
  const s = [0, 1, 2].map((i) => {
    const t = q[i] - c[i];
    return t * t * (3 - 2 * t);
  });
  const h = (dx: number, dy: number, dz: number) => hash13([c[0] + dx + salt, c[1] + dy + salt, c[2] + dz + salt]);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = lerp(h(0, 0, 0), h(1, 0, 0), s[0]);
  const x10 = lerp(h(0, 1, 0), h(1, 1, 0), s[0]);
  const x01 = lerp(h(0, 0, 1), h(1, 0, 1), s[0]);
  const x11 = lerp(h(0, 1, 1), h(1, 1, 1), s[0]);
  return lerp(lerp(x00, x10, s[1]), lerp(x01, x11, s[1]), s[2]);
}

/** Heterogeneidad lenta del parénquima (dB), continua: `hetGain` de la pasada B. */
export function heterogeneityDb(m: Vec3, seed: number): number {
  return (valueNoise([m[0] / HET_CELL_MM, m[1] / HET_CELL_MM, m[2] / HET_CELL_MM], seed + 11) - 0.5) * HET_SCALE_DB;
}

/**
 * Grumos de dispersores (`clumpGain`): la potencia se multiplica por P = exp(σz)/E[exp(σz)] con z
 * uniforme de varianza 1 (log-uniforme, media 1) en células de CLUMP_CELL_MM, σ = `clump` en nepers.
 * Con `clump` = 0 no hace nada (moteado plenamente desarrollado, Rayleigh); con más, pocos
 * dispersores dominan (estadística K), como la grasa del seno renal. `q` es la coordenada ya anclada.
 */
export function clumpGain(q: Vec3, clump: number, seed: number, salt = 0): number {
  if (clump <= 0) return 1;
  const u =
    hash13([Math.floor(q[0] / CLUMP_CELL_MM) + seed + 29 + salt, Math.floor(q[1] / CLUMP_CELL_MM), Math.floor(q[2] / CLUMP_CELL_MM)]) - 0.5;
  const a = clump * Math.sqrt(3);
  return Math.sqrt(Math.exp(clump * Math.sqrt(12) * u) / (Math.sinh(a) / a));
}

/**
 * Grumos anclados (`anchoredClump` de la pasada B): la célula se comprime en elevación hasta el grosor
 * de corte sobre el eje del ancla, como el moteado (decisión 55), y durante el fundido se mezcla en
 * potencia. Un factor por píxel para los tres planos: conserva la potencia media.
 */
export function anchoredClumpGain(m: Vec3, sliceHalfMm: number, clump: number, seed: number, salt: number, st: SpeckleAnchorState): number {
  const at = (a: SpeckleAnchor) => {
    const e = a.e;
    const across = dot([m[0] - a.p[0], m[1] - a.p[1], m[2] - a.p[2]], e);
    const shrink = across * (1 - CLUMP_CELL_MM / Math.max(CLUMP_CELL_MM, 2 * sliceHalfMm));
    return clumpGain([m[0] - e[0] * shrink, m[1] - e[1] * shrink, m[2] - e[2] * shrink], clump, seed, salt + a.parity * ANCHOR_SALT_STEP);
  };
  const ga = at(st.a);
  if (st.w >= 1) return ga;
  const gb = at(st.b);
  return Math.sqrt(st.w * ga * ga + (1 - st.w) * gb * gb);
}

// ——— Dispersores fuertes y densidad de dispersores del parénquima (decisión 89) ———

/**
 * Población de dispersores fuertes de un tejido: la fracción de los nodos de la retícula del moteado (0,42 mm) que son
 * reflectores sub-resolución más fuertes que el resto, su amplitud relativa (×`gain` frente a los demás) y el nivel de
 * todos los nodos (`level`), que devuelve la mediana de la envolvente del tejido a la del moteado difuso.
 */
export interface StrongScatterers {
  fraction: number;
  gain: number;
  level: number;
}
/**
 * El hígado real no es un moteado de Rayleigh de un solo grano: su retrodispersión la dominan las estructuras
 * conectivas de los espacios porta (vaina de Glisson, paredes de vénulas y conductillos), con una separación media de
 * ~1 mm (Fellingham y Sommer 1984, IEEE Trans Sonics Ultrason 31:418) y tamaños que siguen el árbol (muchas pequeñas,
 * pocas grandes). Esa cola de dispersores fuertes da una envolvente pre-Rayleigh (distribución K, Jakeman y Pusey 1976;
 * Tuthill, Sperry y Parker 1988, Ultrason Imaging 10:81; m de Nakagami < 1, Shankar 2000, IEEE TUFFC 47:727) y los
 * «destellos aislados» del parénquima real. Dos niveles de un espectro continuo: las tríadas grandes (decisión 78) y
 * estos nodos fuertes por debajo de la resolución. Fracción y ganancia [EXTRAPOLACIÓN PROPIA], calibradas con los
 * paneles reales del juez ciego (asimetría del gris, cola brillante y destellos por cm², `docs/fidelity/README.md`).
 */
export const STRONG_SCATTERERS: Partial<Record<Tissue, StrongScatterers>> = {
  [Tissue.Liver]: { fraction: 0.012, gain: 4.5, level: 0.946 },
};

/**
 * (p, a, k) de un tejido para `latticeValueS`: los nodos fuertes llevan la amplitud gain·level y los corrientes level.
 * Cada muestra de la envolvente es la suma coherente de ~15 nodos, así que la población fuerte no solo alarga la cola:
 * también levanta la muestra típica, y con level = 1 la mediana de la envolvente del hígado subía +0,48 dB (gemelo B → C →
 * D de la mirada 0, 16 realizaciones a 20, 45, 90 y 150 mm; +0,44 a +0,52 por profundidad). level = 10^(−0,48/20) la
 * devuelve a la del moteado difuso (±0,05 dB por profundidad, `parenchymaTextureTwin.test.ts`): el hígado queda a media
 * escala (decisión 53) y todo lo que el banco mide frente a su mediana (paredes, cápsula, Morison, líneas de la pared,
 * deslizamiento) queda donde estaba. La potencia media sube level²·(1 − p + p·gain²), +0,42 dB en el hígado. Normalizar
 * la potencia media, en cambio, bajaba la mediana ~1,3 dB (4–5 grises con GPU).
 */
export function strongScatter(t: Tissue): StrongScatter {
  const s = STRONG_SCATTERERS[t];
  return s ? [s.fraction, s.gain * s.level, s.level] : NO_STRONG;
}

/**
 * Variación de la densidad de dispersores a escala de milímetros (la textura sobre la textura: lobulillos y territorios
 * de espacios porta): un factor de amplitud 10^(x/20) con x un ruido de valor continuo simétrico en dB (mediana 0 dB, DE
 * 0,185·escala ≈ 2,04 dB), además de la heterogeneidad lenta de 6,25 mm. Como los dispersores fuertes, conserva la mediana
 * del tejido (la potencia media sube aproximadamente +0,5 dB). Anclada al material como la heterogeneidad (no se decorrela al abanicar
 * ni hierve) y del plano central, como los grumos (un factor para los tres planos). Célula y escala [EXTRAPOLACIÓN
 * PROPIA]; ajuste de apariencia normal en la decisión 104, con las guardas estadísticas de `docs/fidelity/README.md`.
 */
// Decisión 104: relieve fino del hígado normal; se conserva el campo complejo, la PSF y la mediana.
export const DENSITY = { cellMm: 3, scaleDb: 11, salt: 41 } as const;
/** Tejidos con la variación de densidad de dispersores (decisión 89). */
export const DENSITY_TISSUES: readonly Tissue[] = [Tissue.Liver];

/** Variación de la densidad de dispersores (dB) en el punto material m, antes de normalizar. */
export function densityDb(m: Vec3, seed: number): number {
  return (valueNoise([m[0] / DENSITY.cellMm, m[1] / DENSITY.cellMm, m[2] / DENSITY.cellMm], seed + DENSITY.salt) - 0.5) * DENSITY.scaleDb;
}

/** Factor de amplitud de la densidad de dispersores (`densityGain` de la pasada B): 1 fuera de `DENSITY_TISSUES`. */
export function densityGain(m: Vec3, seed: number, t: Tissue): number {
  return DENSITY_TISSUES.includes(t) ? Math.pow(10, densityDb(m, seed) / 20) : 1;
}

const glslVec3 = (v: StrongScatter): string => `vec3(${v.map((x) => glslFloat(x)).join(', ')})`;

/**
 * Gemelo GLSL del moteado por tejido para la pasada B (`fieldFor`): mismas fórmulas que
 * `valueNoise`, `heterogeneityDb`, `clumpGain`, `strongScatter` y `densityGain`. Necesita `hash13` (anatomía),
 * los `T_…` de los tejidos y `uSeed`.
 */
export const SPECKLE_TISSUE_GLSL = /* glsl */ `
const float TISSUE_SALT_STEP = ${TISSUE_SALT_STEP.toFixed(4)};
const float HET_CELL_MM = ${HET_CELL_MM.toFixed(4)};
const float HET_SCALE_DB = ${HET_SCALE_DB.toFixed(4)};
const float CLUMP_CELL_MM = ${CLUMP_CELL_MM.toFixed(4)};
// dispersores fuertes del tejido (decisión 89): (p, a, k) de latticeValueS
vec3 strongScatter(int t) {
${Object.keys(STRONG_SCATTERERS)
  .map((k): Tissue => Number(k))
  .map((t) => `  if (t == ${TISSUE_GLSL_NAME[t]}) return ${glslVec3(strongScatter(t))};`)
  .join('\n')}
  return vec3(0.0, 1.0, 1.0);
}
float valueNoise(vec3 q, float salt) {
  vec3 c = floor(q);
  vec3 s = q - c;
  s = s * s * (3.0 - 2.0 * s);
  vec3 o = vec3(salt);
  float x00 = mix(hash13(c + o), hash13(c + vec3(1, 0, 0) + o), s.x);
  float x10 = mix(hash13(c + vec3(0, 1, 0) + o), hash13(c + vec3(1, 1, 0) + o), s.x);
  float x01 = mix(hash13(c + vec3(0, 0, 1) + o), hash13(c + vec3(1, 0, 1) + o), s.x);
  float x11 = mix(hash13(c + vec3(0, 1, 1) + o), hash13(c + vec3(1, 1, 1) + o), s.x);
  return mix(mix(x00, x10, s.y), mix(x01, x11, s.y), s.z);
}
float hetGain(vec3 m) {
  return pow(10.0, (valueNoise(m / HET_CELL_MM, uSeed + 11.0) - 0.5) * HET_SCALE_DB / 20.0);
}
float clumpGain(vec3 q, float clump, float salt) {
  float u = hash13(vec3(floor(q.x / CLUMP_CELL_MM) + uSeed + 29.0 + salt, floor(q.y / CLUMP_CELL_MM), floor(q.z / CLUMP_CELL_MM))) - 0.5;
  float a = clump * sqrt(3.0);
  return sqrt(exp(clump * sqrt(12.0) * u) / (sinh(a) / a));
}
float clumpAt(vec3 m, float se, float clump, float salt, vec3 e, vec3 pivot) {
  float across = dot(m - pivot, e);
  vec3 q = m - e * (across * (1.0 - CLUMP_CELL_MM / max(CLUMP_CELL_MM, 2.0 * se)));
  return clumpGain(q, clump, salt);
}
float anchoredClump(vec3 m, float se, float clump, float salt) {
  float ga = clumpAt(m, se, clump, salt + uAnchorSalt.x, uAnchorE0, uAnchorP0);
  if (uAnchorW >= 1.0) return ga;
  float gb = clumpAt(m, se, clump, salt + uAnchorSalt.y, uAnchorE1, uAnchorP1);
  return sqrt(uAnchorW * ga * ga + (1.0 - uAnchorW) * gb * gb);
}
// densidad de dispersores a escala de milímetros (decisión 89), del plano central: 1 fuera de sus tejidos
float densityGain(vec3 m, int t) {
  if (${DENSITY_TISSUES.map((t) => `t != ${TISSUE_GLSL_NAME[t]}`).join(' && ')}) return 1.0;
  return pow(10.0, (valueNoise(m / ${glslFloat(DENSITY.cellMm)}, uSeed + ${glslFloat(DENSITY.salt)}) - 0.5) * ${glslFloat(DENSITY.scaleDb)} / 20.0);
}
`;
