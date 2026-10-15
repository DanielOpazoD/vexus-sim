/** Mapa rojo/azul compartido por imagen y barra. Presentación estimada, no calibración clínica. */
const TOWARD = [1, 0.13, 0.07] as const;
const AWAY = [0.08, 0.24, 1] as const;

/** Compresión de presentación: conserva flujo lento visible, con negro común en velocidad cero. */
export function colorMapRgb(towardProbe: boolean, mag: number): [number, number, number] {
  const m = Math.sqrt(Math.min(1, Math.max(0, mag)));
  const hue = towardProbe ? TOWARD : AWAY;
  return hue.map((channel) => Math.round(255 * channel * m)) as [number, number, number];
}

const vector = (v: readonly number[]) => `vec3(${v.map((x) => x.toFixed(2)).join(', ')})`;
export const COLOR_MAP_GLSL = /* glsl */ `
vec3 colorVelocityMap(float f, float mag) {
  float m = sqrt(clamp(mag, 0.0, 1.0));
  return m * (f >= 0.0 ? ${vector(TOWARD)} : ${vector(AWAY)});
}
`;
