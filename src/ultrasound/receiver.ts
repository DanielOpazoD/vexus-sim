/**
 * Recepción: ruido del receptor y transitorio del transductor en el campo cercano. Una sola fuente para el
 * renderer (los uniforms `uNoise` y `uFrame` de la pasada C) y para el GLSL (`RECEIVER_GLSL` en la pasada B,
 * `RECEIVER_NOISE_GLSL` en la C, interpolados).
 *
 * El ruido del receptor es electrónico: nace en el preamplificador de cada canal, detrás del transductor, así
 * que no pasa por la PSF espacial del haz. Cada línea es otro disparo (otro instante), con ruido independiente
 * del de sus vecinas, y el filtro de recepción lo limita en banda solo a lo largo de la línea. Hasta la decisión
 * 89 se sumaba en la pasada B, antes de C y D: la PSF lateral lo correlacionaba entre líneas (en la luz de la VCI
 * del flanco, a 1,2 mm por línea, correlación 0,82 con la línea vecina y 0,47 a cuatro, frente a 0,65 a 0,5 mm en
 * profundidad) y las luces se veían con pinceladas a lo ancho. Ahora la pasada C lo genera por muestra (línea,
 * fila, cuadro), lo filtra con el mismo núcleo axial de energía unidad que al campo (el pulso de la fila) y la D
 * lo suma en su línea tras la PSF lateral, antes de la detección (`RECEIVER_NOISE_GLSL`). La potencia no cambia:
 * con núcleos de energía unidad el ruido blanco conserva su varianza por componente, uNoise².
 *
 * El transitorio es un moteado anclado a la sonda (línea, r), no al tejido, de amplitud
 * TRANSIENT_AMPLITUDE·e^(−r/TRANSIENT_DECAY_MM)·acoplamiento [EXTRAPOLACIÓN PROPIA]: una resonancia del
 * transductor, que sí pasa por el haz (sigue en la pasada B). Cae por debajo del ruido del receptor hacia los
 * 29 mm, pero la pasada B lo calculaba en toda la profundidad (un campo de dispersores más por muestra). Ahora
 * se omite desde TRANSIENT_SKIP_MM, donde su escala es la décima parte del rms por componente del ruido (−20 dB),
 * comparados en la escala de la pasada B: ahí lo que se deja de sumar es ≤ ruido/10. Las pasadas C y D (núcleos de
 * energía unidad) no cambian la potencia del ruido, que es blanco, pero sí dan ganancia coherente al transitorio,
 * correlacionado en profundidad: en la imagen lo omitido llega a ≈ ruido/7 (−17 dB) con 60 mm de profundidad
 * seleccionada (la mínima, el peor caso), ruido/8 con 90 mm y ruido/14 con 240 mm. El suelo de ruido sube así
 * ≤ 0,1 dB a partir del corte, y el ruido, nuevo en cada cuadro, lo tapa (`receiver.test.ts`).
 */

/**
 * Ruido del receptor (escala del gaussiano complejo por componente) ≈ −72 dB respecto al eco hepático
 * sin atenuar; con el techo de compensación el campo profundo queda como «nieve» gris oscura
 * [EXTRAPOLACIÓN PROPIA].
 */
export const RECEIVER_NOISE = 2.5e-4;
/** Amplitud del transitorio en la cara del transductor (misma escala que el ruido). */
export const TRANSIENT_AMPLITUDE = 0.35;
/** Decaimiento del transitorio con la profundidad (mm). */
export const TRANSIENT_DECAY_MM = 4;
/** Fracción del ruido del receptor bajo la que el transitorio se omite (−20 dB al sumarse, antes de la PSF). */
export const TRANSIENT_SKIP_NOISE_FRACTION = 0.1;
/**
 * Profundidad desde la que la pasada B omite el transitorio: donde su escala vale
 * TRANSIENT_SKIP_NOISE_FRACTION × el ruido del receptor al sumarse (antes de la PSF),
 * D·ln(A / (f·ruido)) = 38,2 mm.
 */
export const TRANSIENT_SKIP_MM = TRANSIENT_DECAY_MM * Math.log(TRANSIENT_AMPLITUDE / (TRANSIENT_SKIP_NOISE_FRACTION * RECEIVER_NOISE));

/** Escala del transitorio a la profundidad `rMm` sin el acoplamiento (≤ 1), la que multiplica al campo. */
export function transientScale(rMm: number): number {
  return TRANSIENT_AMPLITUDE * Math.exp(-rMm / TRANSIENT_DECAY_MM);
}

/**
 * Literal GLSL de un número de TS: los enteros con punto decimal (GLSL ES 3.0 no convierte int en
 * float) y el resto con todos sus dígitos, para que el float32 del shader sea el de TS.
 */
export const glslFloat = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/**
 * Constantes del transitorio para la pasada B (`FRAG_RAWFIELD`) y su ganancia: 1 en fundamental; en armónica,
 * el rechazo de su banda (`transientGain` de `harmonic.ts`, decisión 77). El corte TRANSIENT_SKIP_MM es el
 * del fundamental: con la ganancia < 1 lo omitido es aún menor.
 */
export const RECEIVER_GLSL = /* glsl */ `
const float TRANSIENT_AMPLITUDE = ${glslFloat(TRANSIENT_AMPLITUDE)};
const float TRANSIENT_DECAY_MM = ${glslFloat(TRANSIENT_DECAY_MM)};
const float TRANSIENT_SKIP_MM = ${glslFloat(TRANSIENT_SKIP_MM)};
uniform float uTransientGain;
`;

/**
 * Cuadros tras los que se repite la secuencia del ruido (el índice del cuadro que recibe la pasada C va módulo
 * este número): con índices pequeños el hash no pierde bits de float32 en una sesión larga (a 60 cps se repite
 * cada ~68 s, sin patrón visible: el ruido de cada cuadro se funde con la persistencia y el compuesto).
 */
export const RECEIVER_NOISE_FRAMES = 4096;
/**
 * Escalas de las coordenadas (línea, fila) y del cuadro en los dos hashes de cada muestra de ruido: las del ruido de
 * la pasada B de antes (vUv·977 y vUv·613 con 192 líneas y 1024 filas; el cuadro ×1,7 y ×3,1), en téxeles.
 */
const NOISE_HASH = { a: [977 / 192, 977 / 1024, 1.7], b: [613 / 192, 613 / 1024, 3.1] } as const;
/** Varianza 1 de una uniforme centrada: ×√12. */
const UNIFORM_TO_UNIT = Math.sqrt(12);

/**
 * Ruido del receptor de la pasada C: por muestra (línea, fila) y cuadro, un complejo de componentes uniformes
 * centradas e independientes de varianza 1, que el núcleo axial de energía unidad de C (7–25 tomas con el pulso de
 * 0,26–0,35 mm) suma en una casi gaussiana y la pasada D suma a su línea tras la PSF lateral. Su curtosis en exceso por
 * componente es −1,2·Σw⁴ (`receiver.test.ts`): −0,09 a −0,42 según la profundidad seleccionada, −0,24 a −0,31 con 18 cm,
 * así que la mediana de su envolvente queda 1,5–4,5 % sobre la de Rayleigh de la misma potencia (el suelo de ruido, hasta
 * +0,4 dB con 24 cm). Sin logaritmos ni senos en el bucle: 2 hashes por toma. Necesita los uniforms `uNoise` (escala por
 * componente, `RECEIVER_NOISE` × la del modo) y `uFrame` (cuadro módulo RECEIVER_NOISE_FRAMES). Gemelo:
 * `receiverNoiseSample`.
 */
export const RECEIVER_NOISE_GLSL = /* glsl */ `
uniform float uNoise;
uniform float uFrame;
float hash12b(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 receiverNoise(vec2 cell) {
  float a = hash12b(cell * vec2(${glslFloat(NOISE_HASH.a[0])}, ${glslFloat(NOISE_HASH.a[1])}) + uFrame * ${glslFloat(NOISE_HASH.a[2])});
  float b = hash12b(cell * vec2(${glslFloat(NOISE_HASH.b[0])}, ${glslFloat(NOISE_HASH.b[1])}) + uFrame * ${glslFloat(NOISE_HASH.b[2])} + 11.0);
  return ${glslFloat(UNIFORM_TO_UNIT)} * (vec2(a, b) - 0.5);
}
`;

const f32 = Math.fround;
const fract32 = (x: number): number => f32(x - Math.floor(x));

/** `hash12b` de la pasada C en float32 (gemelo para las pruebas). */
export function hash12b(px: number, py: number): number {
  let x = fract32(f32(px * 0.1031));
  let y = fract32(f32(py * 0.1031));
  let z = x;
  const d = f32(f32(x * f32(y + 33.33)) + f32(y * f32(z + 33.33)) + f32(z * f32(x + 33.33)));
  x = f32(x + d);
  y = f32(y + d);
  z = f32(z + d);
  return fract32(f32(f32(x + y) * z));
}

/**
 * `receiverNoise` de la pasada C (sin la escala uNoise): el complejo de la muestra (línea, fila) del cuadro, con las
 * operaciones de float32 en el orden del GLSL (cell·escala + cuadro·escala, y después + 11).
 */
export function receiverNoiseSample(line: number, row: number, frame: number): [number, number] {
  const [A0, A1, A2] = NOISE_HASH.a.map(f32);
  const [B0, B1, B2] = NOISE_HASH.b.map(f32);
  const fr = f32(frame);
  const fa = f32(fr * A2);
  const fb = f32(fr * B2);
  const a = hash12b(f32(f32(line * A0) + fa), f32(f32(row * A1) + fa));
  const b = hash12b(f32(f32(f32(line * B0) + fb) + 11), f32(f32(f32(row * B1) + fb) + 11));
  return [f32(UNIFORM_TO_UNIT) * (a - 0.5), f32(UNIFORM_TO_UNIT) * (b - 0.5)];
}
