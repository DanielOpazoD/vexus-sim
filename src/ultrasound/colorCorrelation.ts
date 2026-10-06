/** Decisión 168: filtrar/interpolar R1 complejo antes de convertir su fase en frecuencia. */
export const COLOR_KERNEL = [1, 2, 1] as const;

/** R1 en unidades de potencia; frecuencia plegada en Hz, sin corrección angular. */
export function decodeColorCorrelation(real: number, imaginary: number, prfHz: number): { frequencyHz: number; power: number } {
  return { frequencyHz: (Math.atan2(imaginary, real) * prfHz) / (2 * Math.PI), power: Math.hypot(real, imaginary) };
}

/** Kernel separable normalizado 3×3; soporte de una línea/paquete, estimación propia. */
export function smoothColorCorrelation(samples: ReadonlyArray<readonly [number, number]>): readonly [number, number] {
  if (samples.length !== 9) throw new RangeError('R1: se necesitan nueve muestras');
  let real = 0,
    imaginary = 0;
  for (let i = 0; i < 9; i++) {
    const weight = (COLOR_KERNEL[i % 3] * COLOR_KERNEL[Math.floor(i / 3)]) / 16;
    real += weight * samples[i][0];
    imaginary += weight * samples[i][1];
  }
  return [real, imaginary];
}

/** No usa anatomía, máscara de vasos ni umbral de presentación. */
export const COLOR_FILTER_GLSL = /* glsl */ `#version 300 es
precision highp float;
uniform highp sampler2D uRawColor;
uniform vec2 uCellStep;
in vec2 vUv;
out vec4 oColor;
vec2 sampleR1(vec2 uv) {
  ivec2 size = textureSize(uRawColor, 0);
  vec2 p = uv * vec2(size) - 0.5;
  ivec2 a = ivec2(floor(p));
  vec2 f = fract(p);
  vec2 r00 = texelFetch(uRawColor, clamp(a, ivec2(0), size - 1), 0).xy;
  vec2 r10 = texelFetch(uRawColor, clamp(a + ivec2(1, 0), ivec2(0), size - 1), 0).xy;
  vec2 r01 = texelFetch(uRawColor, clamp(a + ivec2(0, 1), ivec2(0), size - 1), 0).xy;
  vec2 r11 = texelFetch(uRawColor, clamp(a + ivec2(1, 1), ivec2(0), size - 1), 0).xy;
  return mix(mix(r00, r10, f.x), mix(r01, r11, f.x), f.y);
}
void main() {
  vec2 r1 = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    float w = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0) / 16.0;
    r1 += w * sampleR1(vUv + vec2(float(x), float(y)) * uCellStep);
  }
  // Blood fraction is metadata of this cell, not a filtered correlation sample.
  // Fetch its integer texel so interpolation cannot alter it at cell boundaries.
  oColor = vec4(r1, texelFetch(uRawColor, ivec2(gl_FragCoord.xy), 0).z, 0.0);
}
`;
