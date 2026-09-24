import type { Vec3 } from '../core/vec3';

/**
 * Medio de dispersores anclado (decisión 55). El moteado sale de un campo complejo en una retícula
 * de 0,42 mm cuya coordenada elevacional se comprime hasta el grosor de corte, para que la textura
 * se decorrele al inclinar la sonda un grosor de corte y no una célula (decisión 99 de EchoTwin).
 * Esa compresión necesita un eje y un pivote. Antes eran la normal ACTUAL del plano y el origen del
 * mundo: el medio cambiaba al girar la sonda, y a 100 mm del origen un giro de 0,5° desplazaba el
 * campo 0,9 mm (correlación 0,16 con 0,5° y 0,02 con 1°, cuando un equipo conserva el moteado).
 *
 * Ahora el eje y el pivote son un ANCLA que se fija con la sonda y no la sigue: el medio queda
 * quieto y la imagen se decorrela solo porque el plano atraviesa otro tejido, como en un equipo
 * (gemelo: 0,95 con 0,5° de inclinación, 0,83 con 1°, 0,11 con 4°). Con la normal apartada α del
 * ancla, la célula elevacional se adelgaza (|dq/dn| = √(sin²α + k²cos²α), k ≈ 0,13): a 20° la
 * persistencia con 0,5° cae a 0,3–0,65 y la SNR sube un 11–17 %; a 5,5° sigue en 0,93 y +3–9 %. Así
 * que pasados REANCHOR_DEG el ancla se renueva con un fundido de CROSSFADE_FRAMES cuadros entre los dos medios,
 * con semillas distintas: la suma √w·A + √(1−w)·B de dos campos gaussianos independientes sigue
 * siendo gaussiana, así que la estadística de Rayleigh no cambia durante el fundido. Un salto de
 * pose (el teletransporte de los ganchos de prueba) y el cambio de paciente reinician el ancla sin
 * fundido; los puntos de partida de la app se animan y reanclan con fundido.
 *
 * Gemelos: `speckleSliceField` (TS, pruebas) y `scattererFieldSlice` de la pasada B, misma fórmula.
 */

/** Ángulo entre la normal del plano y la del ancla a partir del cual se renueva el ancla. */
export const REANCHOR_DEG = 6;
/** Cuadros del fundido entre el ancla vieja y la nueva. */
export const CROSSFADE_FRAMES = 8;
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
 * normal del plano; devuelve las dos anclas y el peso del fundido que usa la pasada B.
 */
export class ElevationAnchor {
  private a: SpeckleAnchor | null = null;
  private b: SpeckleAnchor | null = null;
  private fadeLeft = 0;
  private last: { face: Vec3; e: Vec3 } | null = null;

  /** Olvida el ancla: el siguiente cuadro fija una nueva (cambio de paciente). */
  reset(): void {
    this.a = null;
    this.b = null;
    this.fadeLeft = 0;
    this.last = null;
  }

  update(face: Vec3, elevation: Vec3): SpeckleAnchorState {
    const here = (parity: 0 | 1): SpeckleAnchor => ({ e: [...elevation], p: [...face], parity });
    const jumped = this.last !== null && (dist(face, this.last.face) > JUMP_MM || axisAngleDeg(elevation, this.last.e) > JUMP_DEG);
    this.last = { face: [...face], e: [...elevation] };
    if (this.a === null || jumped) {
      this.a = here(0);
      this.b = this.a;
      this.fadeLeft = 0;
    } else if (this.fadeLeft === 0 && axisAngleDeg(elevation, this.a.e) > REANCHOR_DEG) {
      // no se reancla a mitad de un fundido: descartar de golpe el medio más viejo era un salto de
      // grano (en GPU, a 1°/cuadro, correlación 0,65 con el cuadro anterior); se espera a que acabe
      this.b = this.a;
      this.a = here(this.a.parity === 0 ? 1 : 0);
      this.fadeLeft = CROSSFADE_FRAMES;
    }
    const out: SpeckleAnchorState = { a: this.a, b: this.b ?? this.a, w: 1 };
    if (this.fadeLeft > 0) {
      out.w = 1 - this.fadeLeft / (CROSSFADE_FRAMES + 1);
      this.fadeLeft--;
      // el medio viejo se suelta DESPUÉS del último cuadro del fundido: soltarlo antes sumaba el
      // mismo medio dos veces con w = 8/9 (√w + √(1−w) = 1,28: un destello de +2 dB en la GPU)
      if (this.fadeLeft === 0) this.b = this.a;
    }
    return out;
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

function latticeValue(c: Vec3, salt: number): [number, number] {
  const a = hash13([c[0] + salt, c[1], c[2]]);
  const b = hash13([c[0], c[1] + salt + 17.1, c[2]]);
  const r = Math.sqrt(-2 * Math.log(Math.max(1e-6, a)));
  const ph = 6.2831853 * b;
  return [r * Math.cos(ph), r * Math.sin(ph)];
}

const mix2 = (a: [number, number], b: [number, number], t: number): [number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

/** `scattererField`: interpolación con fundido smoothstep del campo complejo de la retícula de paso h. */
export function scattererField(m: Vec3, h: number, salt: number): [number, number] {
  const q: Vec3 = [m[0] / h, m[1] / h, m[2] / h];
  const c: Vec3 = [Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2])];
  const s = [0, 1, 2].map((i) => {
    const t = q[i] - c[i];
    return t * t * (3 - 2 * t);
  });
  const L = (dx: number, dy: number, dz: number) => latticeValue([c[0] + dx, c[1] + dy, c[2] + dz], salt);
  const x00 = mix2(L(0, 0, 0), L(1, 0, 0), s[0]);
  const x10 = mix2(L(0, 1, 0), L(1, 1, 0), s[0]);
  const x01 = mix2(L(0, 0, 1), L(1, 0, 1), s[0]);
  const x11 = mix2(L(0, 1, 1), L(1, 1, 1), s[0]);
  return mix2(mix2(x00, x10, s[1]), mix2(x01, x11, s[1]), s[2]);
}

/** `scattererFieldSlice`: la coordenada elevacional, medida desde el pivote del ancla, se comprime a h/(2·σe). */
export function anchoredSliceField(m: Vec3, h: number, sliceHalfMm: number, salt: number, anchor: SpeckleAnchor): [number, number] {
  const e = anchor.e;
  const across = dot([m[0] - anchor.p[0], m[1] - anchor.p[1], m[2] - anchor.p[2]], e);
  const shrink = across * (1 - h / Math.max(h, 2 * sliceHalfMm));
  return scattererField([m[0] - e[0] * shrink, m[1] - e[1] * shrink, m[2] - e[2] * shrink], h, salt + anchor.parity * ANCHOR_SALT_STEP);
}

/** Campo del medio con el fundido entre anclas (`speckleField` de la pasada B). */
export function speckleSliceField(m: Vec3, h: number, sliceHalfMm: number, salt: number, st: SpeckleAnchorState): [number, number] {
  const fa = anchoredSliceField(m, h, sliceHalfMm, salt, st.a);
  if (st.w >= 1) return fa;
  const fb = anchoredSliceField(m, h, sliceHalfMm, salt, st.b);
  const wa = Math.sqrt(st.w);
  const wb = Math.sqrt(1 - st.w);
  return [wa * fa[0] + wb * fb[0], wa * fa[1] + wb * fb[1]];
}

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

/**
 * Gemelo GLSL del moteado por tejido para la pasada B (`fieldFor`): mismas fórmulas que
 * `valueNoise`, `heterogeneityDb` y `clumpGain`. Necesita `hash13` (anatomía) y `uSeed`.
 */
export const SPECKLE_TISSUE_GLSL = /* glsl */ `
const float TISSUE_SALT_STEP = ${TISSUE_SALT_STEP.toFixed(4)};
const float HET_CELL_MM = ${HET_CELL_MM.toFixed(4)};
const float HET_SCALE_DB = ${HET_SCALE_DB.toFixed(4)};
const float CLUMP_CELL_MM = ${CLUMP_CELL_MM.toFixed(4)};
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
`;
