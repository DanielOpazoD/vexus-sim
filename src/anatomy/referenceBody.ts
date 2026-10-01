import type { Vec3 } from '../core/vec3';

/** BodyParts3D release4, único registro mm/LAS anclado al xifoides. Véase docs/anatomy.
 * Ocho cortes −160..120mm, paso40mm, centroY+64 radios polares/corte.
 * La interpolación de sectores sin piel torácica identificada es una aproximación declarada,
 * no una dimensión clínica ni validación humana. */
export const BODY_ROWS = 8;
export const BODY_STRIDE = 65;
export let referenceBody: Float32Array | undefined;
export function validateReferenceBody(values: Float32Array): Float32Array {
  if (values.length !== BODY_ROWS * BODY_STRIDE || !values.every(Number.isFinite)) throw new Error('Referencia corporal inválida');
  for (let i = 0; i < values.length; i++)
    if (i % BODY_STRIDE !== 0 && (values[i] < 40 || values[i] > 300)) throw new Error('Radio corporal fuera del dominio del asset');
  return values;
}
export function setReferenceBody(values?: Float32Array): void {
  referenceBody = values ? validateReferenceBody(values) : undefined;
}
/** Radio, derivadas en φ/z, centro Y y su derivada; clamping explícito fuera de los cortes fuente. */
export function bodySection(phi: number, z: number, data: Float32Array): [number, number, number, number, number] {
  const zz = Math.max(0, Math.min(BODY_ROWS - 1, (z + 160) / 40));
  const row = Math.min(BODY_ROWS - 2, Math.floor(zz));
  const f = zz - row;
  const angle = ((((phi / (2 * Math.PI)) % 1) + 1) % 1) * 64;
  const i = Math.floor(angle),
    g = angle - i;
  const sample = (r: number, a: number) => data[r * BODY_STRIDE + 1 + (a % 64)];
  const a = sample(row, i),
    b = sample(row, i + 1),
    c = sample(row + 1, i),
    d = sample(row + 1, i + 1);
  const r0 = a + (b - a) * g,
    r1 = c + (d - c) * g;
  const cy0 = data[row * BODY_STRIDE],
    cy1 = data[(row + 1) * BODY_STRIDE];
  const inside = z >= -160 && z <= 120;
  return [
    r0 + (r1 - r0) * f,
    (((b - a) * (1 - f) + (d - c) * f) * 64) / (2 * Math.PI),
    inside ? (r1 - r0) / 40 : 0,
    cy0 + (cy1 - cy0) * f,
    inside ? (cy1 - cy0) / 40 : 0,
  ];
}
export function bodyDepth(p: Vec3, data: Float32Array): number {
  const cy = bodySection(0, p[2], data)[3];
  const y = p[1] - cy;
  return Math.hypot(p[0], y) - bodySection(Math.atan2(y, p[0]), p[2], data)[0];
}
export function bodyGradient(p: Vec3, data: Float32Array): Vec3 {
  const cy = bodySection(0, p[2], data)[3];
  const x = p[0],
    y = p[1] - cy,
    r = Math.hypot(x, y);
  if (r < 1e-6) return [0, 1, 0];
  const [, dp, dz, , dc] = bodySection(Math.atan2(y, x), p[2], data);
  const gy = y / r - (dp * x) / (r * r);
  return [x / r + (dp * y) / (r * r), gy, -dz - dc * gy];
}
