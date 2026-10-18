import type { Vec3 } from '../core/vec3';

/** BodyParts3D release4, único registro mm/LAS anclado al xifoides. Véase docs/anatomy.
 * Ocho cortes −160..120mm, paso40mm, centroY+64 radios polares/corte.
 * La interpolación de sectores sin piel torácica identificada es una aproximación declarada,
 * no una dimensión clínica ni validación humana. */
export const BODY_ROWS = 8;
export const ABDOMINAL_BODY_ROWS = 14;
export const COSTAL_BODY_ROWS = 53;
export const BODY_MAX_ROWS = COSTAL_BODY_ROWS;
export const BODY_STRIDE = 65;
export let referenceBody: Float32Array | undefined;
export let abdominalBody: Float32Array | undefined;
export function setAbdominalBody(values?: Float32Array): void {
  if (values && values.length !== ABDOMINAL_BODY_ROWS * BODY_STRIDE) throw new Error('Perfil abdominal inválido');
  abdominalBody = values ? validateReferenceBody(values) : undefined;
}
export function validateReferenceBody(values: Float32Array): Float32Array {
  if (
    ![BODY_ROWS * BODY_STRIDE, ABDOMINAL_BODY_ROWS * BODY_STRIDE, COSTAL_BODY_ROWS * BODY_STRIDE].includes(values.length) ||
    !values.every(Number.isFinite)
  )
    throw new Error('Referencia corporal inválida');
  for (let i = 0; i < values.length; i++)
    if (i % BODY_STRIDE !== 0 && (values[i] < 40 || values[i] > 300)) throw new Error('Radio corporal fuera del dominio del asset');
  return values;
}
export function setReferenceBody(values?: Float32Array): void {
  referenceBody = values ? validateReferenceBody(values) : undefined;
}
/** Coeficientes bicúbicos compartidos por CPU/GPU; cuatro téxeles por celda y uno
 * para el centro de cada franja. Perfiles cargados inmutables por identidad (216). */
/** Subdivisión numérica Z; 128 sectores angulares. Conserva muestras intermedias
 * de la geometría previa al reconstruir las esquinas, no resolución del equipo. */
export const BODY_SUBDIVISIONS = 4;
export const BODY_SECTORS = 128;
export const BODY_COEFFICIENT_STRIDE = BODY_SECTORS * 16 + 4;
const coefficients = new WeakMap<Float32Array, Float64Array>();
const slope = (a: number, b: number): number => (a * b > 0 ? Math.sign(a) * Math.min(Math.abs(a), Math.abs(b)) : 0);
const angularSlope = (a: number, b: number): number =>
  a * b > 0 ? Math.sign(a) * Math.max(Math.min(2 * Math.abs(a), Math.abs(b)), Math.min(Math.abs(a), 2 * Math.abs(b))) : 0;
const power = (a: number, b: number, da: number, db: number): number[] => [a, da, 3 * (b - a) - 2 * da - db, 2 * (a - b) + da + db];

/** Hermite con pendientes limitadas y derivada mixta nula.
 * Reconstrucción C1 [EXTRAPOLACIÓN PROPIA] / NEEDS_CALIBRATION visual: interpola los nodos, sin una nueva segmentación. */
export function bodyCoefficients(data: Float32Array): Float64Array {
  const cached = coefficients.get(data);
  if (cached) return cached;
  const rows = BODY_SUBDIVISIONS * (data.length / BODY_STRIDE - 1) + 1;
  // El perfil costal ya está ajustado al contacto visceral: mantiene minmod.
  // En los cortes fuente, Superbee angular conserva mejor las bandas costales registradas.
  const limitAngle = data.length === COSTAL_BODY_ROWS * BODY_STRIDE ? slope : angularSlope;
  const out = new Float64Array((rows - 1) * BODY_COEFFICIENT_STRIDE);
  const raw = (r: number, a: number): number => {
    const q = Math.max(0, Math.min((rows - 1) / BODY_SUBDIVISIONS, r / BODY_SUBDIVISIONS)),
      i = Math.min((rows - 1) / BODY_SUBDIVISIONS - 1, Math.floor(q));
    return data[i * BODY_STRIDE + a] + (data[(i + 1) * BODY_STRIDE + a] - data[i * BODY_STRIDE + a]) * (q - i);
  };
  // Ancla también muestras intermedias de la reconstrucción bilineal previa:
  // limita la desviación entre observaciones sin conservar sus esquinas.
  const at = (r: number, a: number): number => {
    if (a < 0) return raw(r, 0);
    const q = (((a + BODY_SECTORS) % BODY_SECTORS) * 64) / BODY_SECTORS,
      k = Math.floor(q);
    return raw(r, k + 1) + (raw(r, 1 + ((k + 1) % 64)) - raw(r, k + 1)) * (q - k);
  };
  const radius = (r: number, a: number) => at(r, (a + BODY_SECTORS) % BODY_SECTORS);
  const dz = (r: number, a: number) => slope(at(r, a) - at(r - 1, a), at(r + 1, a) - at(r, a));
  const dx = (r: number, a: number) => limitAngle(radius(r, a) - radius(r, a - 1), radius(r, a + 1) - radius(r, a));
  for (let r = 0; r < rows - 1; r++) {
    for (let a = 0; a < BODY_SECTORS; a++) {
      const b = (a + 1) % BODY_SECTORS;
      const p = power(radius(r, a), radius(r, b), dx(r, a), dx(r, b));
      const q = power(radius(r + 1, a), radius(r + 1, b), dx(r + 1, a), dx(r + 1, b));
      const u = power(dz(r, a), dz(r, b), 0, 0);
      const v = power(dz(r + 1, a), dz(r + 1, b), 0, 0);
      for (let k = 0; k < 4; k++) {
        const c = power(p[k], q[k], u[k], v[k]);
        for (let j = 0; j < 4; j++) out[r * BODY_COEFFICIENT_STRIDE + a * 16 + j * 4 + k] = c[j];
      }
    }
    out.set(power(at(r, -1), at(r + 1, -1), dz(r, -1), dz(r + 1, -1)), (r + 1) * BODY_COEFFICIENT_STRIDE - 4);
  }
  coefficients.set(data, out);
  return out;
}

const polynomial = (a: ArrayLike<number>, offset: number, t: number): number =>
  ((a[offset + 3] * t + a[offset + 2]) * t + a[offset + 1]) * t + a[offset];
const differential = (a: ArrayLike<number>, offset: number, t: number): number =>
  (3 * a[offset + 3] * t + 2 * a[offset + 2]) * t + a[offset + 1];

/** Radio, derivadas en φ/z, centro Y y su derivada. Ángulo periódico y
 * tangente nula en los extremos Z de la prolongación constante. */
export function bodySection(phi: number, z: number, data: Float32Array): [number, number, number, number, number] {
  const rows = BODY_SUBDIVISIONS * (data.length / BODY_STRIDE - 1) + 1,
    minZ = data.length === BODY_ROWS * BODY_STRIDE ? -160 : -400;
  const step = (120 - minZ) / (rows - 1);
  const zz = Math.max(0, Math.min(rows - 1, (z - minZ) / step));
  const row = Math.min(rows - 2, Math.floor(zz)),
    f = zz - row;
  const angle = ((((phi / (2 * Math.PI)) % 1) + 1) % 1) * BODY_SECTORS;
  const i = Math.floor(angle),
    g = angle - i;
  const c = bodyCoefficients(data),
    base = row * BODY_COEFFICIENT_STRIDE + i * 16;
  const r = [],
    dp = [];
  for (let k = 0; k < 4; k++) {
    r.push(polynomial(c, base + k * 4, g));
    dp.push(differential(c, base + k * 4, g));
  }
  const center = (row + 1) * BODY_COEFFICIENT_STRIDE - 4;
  const scale = z >= minZ && z <= 120 ? 1 / step : 0;
  return [
    polynomial(r, 0, f),
    (polynomial(dp, 0, f) * BODY_SECTORS) / (2 * Math.PI),
    scale ? differential(r, 0, f) * scale : 0,
    polynomial(c, center, f),
    scale ? differential(c, center, f) * scale : 0,
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
