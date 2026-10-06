/** Mapa rojo/azul de velocidad axial, compartido por imagen y barra. Presentación estimada (decisión 170). */
const TOWARD = [
  [0.65, 0.02, 0.01],
  [1, 0.13, 0.07],
] as const;
const AWAY = [
  [0.02, 0.05, 0.65],
  [0.08, 0.24, 1],
] as const;

export function colorMapRgb(towardProbe: boolean, mag: number): [number, number, number] {
  const m = Math.min(1, Math.max(0, mag));
  const [a, b] = towardProbe ? TOWARD : AWAY;
  return [0, 1, 2].map((k) => Math.round(255 * (a[k] + (b[k] - a[k]) * m))) as [number, number, number];
}

const vector = (v: readonly number[]) => `vec3(${v.map((x) => x.toFixed(2)).join(', ')})`;
export const COLOR_MAP_GLSL = /* glsl */ `
vec3 colorVelocityMap(float f, float mag) {
  return f >= 0.0 ? mix(${vector(TOWARD[0])}, ${vector(TOWARD[1])}, mag)
                  : mix(${vector(AWAY[0])}, ${vector(AWAY[1])}, mag);
}
`;
