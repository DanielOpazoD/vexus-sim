import type { Vec3 } from '../core/vec3';
import { curtainSteerWeight } from './pleura';
import { glslFloat } from './receiver';
import { JUMP_DEG, JUMP_MM } from './speckleField';
import { lookCoverage, steeredElement } from './steering';

/**
 * Composición espacial (decisión 58): N = 3 miradas del mismo plano (0, +θ, −θ), una por cuadro
 * (adquisición intercalada con actualización continua), cada una formada en la rejilla común de la
 * mirada 0 con la línea dirigida que pasa por cada muestra, y promediadas en lineal (media de
 * envolventes ponderada por cobertura, sin remuestreo: la misma celda). El moteado de cada mirada se
 * decorrela de la 0 por la física de la fase (`steering.ts`, `speckleField.ts`): el grano no crece y la
 * SNR sube como √N_eff (Burckhardt 1978), sin ningún filtro de suavizado (§23).
 *
 * Aquí viven los parámetros, la regla de actividad, el anillo de miradas y el gemelo de la pasada K
 * (`compoundEnvelope`); la GPU es la etapa 2 de la decisión 58.
 */

export interface CompoundParams {
  /**
   * Ángulo de dirección de las miradas ±θ en el elemento (°). 7° de partida, calibrable en 6–8° con el
   * banco de GPU para una mediana de desviación del gris del hígado de 12–13 [ESTIMADO: 5–10° en
   * convexos, limitado por la directividad del elemento, que se ignora (−0,35 dB ida y vuelta a 8°)].
   * Predicción del gemelo 2D del diseño (no medida en GPU): ±6° → 12,2–13,7; ±7° → 11,7–13,3;
   * ±8° → 11,2–12,9 de desviación (la GPU, 0,5–1 menos). Un único θ global, sin ajuste por profundidad.
   */
  steerDeg: number;
  /** Orden de adquisición: signo de la dirección de cada mirada (la primera, la 0). */
  order: readonly (-1 | 0 | 1)[];
  /** Rampa de cobertura en el borde del arreglo (líneas) [EXTRAPOLACIÓN PROPIA]. */
  taperLines: number;
}

/** Límites de la calibración de θ con el banco de GPU (°): fuera de ellos, otra decisión. */
export const COMPOUND_STEER_RANGE_DEG = [6, 8] as const;

export const COMPOUND: CompoundParams = { steerDeg: 7, order: [0, 1, -1], taperLines: 1 };

/**
 * Regla de actividad (determinista): el compuesto se forma solo con el color apagado. Con color, el cuadro
 * B se refresca a la cadencia del color (4–11 Hz, decisión 39) y la ventana de 3 miradas duraría
 * 280–715 ms, con estela respiratoria de varios mm. El PW no limita la cadencia del modo B y lo mantiene.
 */
export function compoundActive(bmode: { compound: boolean }, color: { enabled: boolean }): boolean {
  return bmode.compound && !color.enabled;
}

/**
 * Ley gaussiana de decorrelación entre dos miradas cuyos haces difieren Δ en el punto (Trahey, Smith y
 * von Ramm 1986; O'Donnell y Silverstein 1988): ρ_I = exp(−(k2·2·sin(Δ/2)·σ)²/2), con σ la de la PSF
 * lateral de amplitud (FWHM/2,355). Con la σ del grano lateral medido de la mirada 0 es la referencia de la
 * composición en el gemelo (`compoundSpeckle.test.ts`) y en el banco de GPU (`fidelity.ts`).
 */
export function lookCorrelationLaw(delta: number, sigmaMm: number, k2: number): number {
  return Math.exp(-((k2 * 2 * Math.sin(Math.abs(delta) / 2) * sigmaMm) ** 2) / 2);
}

/** N_eff = N²/Σρ_ij (con ρ_ii = 1) de una matriz de correlaciones entre miradas dada por sus pares. */
export function effectiveLooks(n: number, pairs: readonly number[]): number {
  return (n * n) / (n + 2 * pairs.reduce((s, v) => s + v, 0));
}

/** Ángulo de dirección (rad, con signo) de la mirada `index` del orden. */
export function lookTheta(index: number, p: CompoundParams = COMPOUND): number {
  return (p.order[index] * p.steerDeg * Math.PI) / 180;
}

/**
 * Paso de sal por mirada del transitorio y de la cola sucia (anclados a la sonda, no al tejido): cada
 * mirada es otro disparo y no comparte sus artefactos. El hash repite con periodo 1/0,1031 ≈ 9,70 en su
 * coordenada; con 1/(3·0,1031) las sales de las miradas 1 y 2 quedan a un tercio de periodo entre sí y de
 * la 0. La mirada 0 lleva sal 0: idéntica bit a bit a la imagen sin compuesto.
 */
export const LOOK_SALT_STEP = 1 / (3 * 0.1031);

export function lookSalt(index: number): number {
  return index * LOOK_SALT_STEP;
}

/**
 * Peso de una mirada en la celda (α, ρ) de la rejilla común: 1 para la mirada 0 (c₀ ≡ 1, siempre
 * formada); para las dirigidas, la cobertura de su elemento (`lookCoverage`), 0 fuera del arreglo.
 */
export function lookWeight(
  alpha: number,
  rho: number,
  theta: number,
  geom: { curvatureRadius: number; halfSector: number; lines: number },
  taperLines: number = COMPOUND.taperLines,
): number {
  if (theta === 0) return 1;
  return lookCoverage(steeredElement(alpha, rho, theta, geom.curvatureRadius), geom.halfSector, geom.lines, taperLines);
}

/** Geometría de una envolvente (líneas × muestras) para el gemelo de K. */
export interface CompoundGrid {
  lines: number;
  samples: number;
  depthMm: number;
  halfSector: number;
  curvatureRadius: number;
}

/** Una ranura del anillo: ángulo de su mirada y su envolvente (null: no válida). */
export interface LookSlot {
  theta: number;
  data: Float32Array | null;
}

const f32 = Math.fround;

/** Pleura de la cortina de una línea de la mirada 0 (A0 h2 y la fracción de aire de B, decisión 61). */
export interface CurtainLineWeight {
  /** Cruce de la pleura parietal (mm; ≤ 0 sin él). */
  D: number;
  /** Fracción de aire del haz en el cruce. */
  fAir: number;
}

/**
 * Gemelo de la pasada K: en cada celda, media lineal de las envolventes válidas ponderada por su peso
 * (`lookWeight`), en float32 como la GPU. Con solo la mirada 0 válida da env·1/1: la misma envolvente,
 * bit a bit (paso directo). La celda (u, v) es la de la pasada D: α = lineTheta((u + ½)/líneas),
 * r = (v + ½)·profundidad/muestras. Con `curtain` (una entrada por línea), bajo la pleura de la cortina las
 * dirigidas pesan además `curtainSteerWeight` (1 − fAir; decisión 61).
 */
export function compoundEnvelope(
  slots: readonly LookSlot[],
  g: CompoundGrid,
  taperLines: number = COMPOUND.taperLines,
  curtain?: readonly CurtainLineWeight[],
): Float32Array {
  const out = new Float32Array(g.lines * g.samples);
  const dPhi = (2 * g.halfSector) / g.lines;
  for (let v = 0; v < g.samples; v++) {
    const rho = g.curvatureRadius + ((v + 0.5) * g.depthMm) / g.samples;
    for (let u = 0; u < g.lines; u++) {
      const alpha = -g.halfSector + (u + 0.5) * dPhi;
      let sum = 0;
      let wsum = 0;
      const c = curtain?.[u];
      const keep = c ? f32(curtainSteerWeight(rho - g.curvatureRadius, c.D, c.fAir)) : 1;
      for (const s of slots) {
        if (s.data === null) continue;
        let w = f32(lookWeight(alpha, rho, s.theta, g, taperLines));
        if (s.theta !== 0) w = f32(w * keep);
        if (w <= 0) continue;
        sum = f32(sum + f32(w * s.data[v * g.lines + u]));
        wsum = f32(wsum + w);
      }
      out[v * g.lines + u] = wsum > 0 ? f32(sum / wsum) : 0;
    }
  }
  return out;
}

/** Lo que el anillo necesita saber de cada cuadro B. */
export interface CompoundFrameInput {
  /** `compoundActive(bmode, color)`: cambiarlo es un cambio de modo y reinicia. */
  active: boolean;
  /** Profundidad, foco y líneas: cambiar cualquiera reinicia (las miradas guardadas son de otra rejilla). */
  depthMm: number;
  focusMm: number;
  lines: number;
  /** Pose (cara y ejes de la sonda): un salto de más de JUMP_MM o JUMP_DEG entre cuadros reinicia. */
  face: Vec3;
  axial: Vec3;
  elevation: Vec3;
}

/** Mirada que forma el cuadro y estado del anillo tras escribirla. */
export interface CompoundLook {
  /** Índice en el orden = ranura del anillo (la 0 es la mirada 0). */
  index: number;
  /** Ángulo de dirección de la mirada (rad, con signo). */
  theta: number;
  /** Sal del transitorio y de la cola de esta mirada (`lookSalt`). */
  salt: number;
  /** Este cuadro reinició el anillo. */
  reset: boolean;
  /** Validez de cada ranura tras escribir la de este cuadro. */
  valid: readonly boolean[];
  /** Número de ranuras válidas. */
  validCount: number;
}

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angleDeg = (a: Vec3, b: Vec3): number =>
  (Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

/**
 * Anillo de miradas (adquisición intercalada): una mirada por cuadro B, en el orden de `COMPOUND.order`
 * (0, +θ, −θ, 0, …), cada una en su ranura; K promedia las válidas. Se reinicia (todas las ranuras
 * inválidas y el siguiente cuadro es la mirada 0) con un salto de pose, `invalidate` (cambio de escena o
 * de paciente), un cambio de profundidad, foco o líneas y un cambio de modo (la regla de actividad).
 * Apagado, cada cuadro es la mirada 0 y K pasa la envolvente tal cual.
 */
export class CompoundRing {
  private readonly valid: boolean[];
  private cursor = 0;
  private key: string | null = null;
  private pose: { face: Vec3; axial: Vec3; elevation: Vec3 } | null = null;
  private pending = true;
  private resetCount = 0;
  private last: CompoundLook | null = null;

  constructor(private readonly params: CompoundParams = COMPOUND) {
    this.valid = params.order.map(() => false);
  }

  /** Olvida las miradas: el siguiente cuadro reinicia (cambio de escena o de paciente). */
  invalidate(): void {
    this.pending = true;
  }

  /** Mirada del cuadro B que se va a formar; una llamada por cuadro. */
  next(f: CompoundFrameInput): CompoundLook {
    const key = `${f.active ? 1 : 0}|${f.depthMm}|${f.focusMm}|${f.lines}`;
    const p = this.pose;
    const jumped =
      p !== null &&
      (dist(f.face, p.face) > JUMP_MM || angleDeg(f.axial, p.axial) > JUMP_DEG || angleDeg(f.elevation, p.elevation) > JUMP_DEG);
    const reset = this.pending || key !== this.key || jumped;
    if (reset) {
      this.valid.fill(false);
      this.cursor = 0;
      this.resetCount++;
    }
    this.pending = false;
    this.key = key;
    this.pose = { face: [...f.face], axial: [...f.axial], elevation: [...f.elevation] };
    const index = f.active ? this.cursor : 0;
    this.valid[index] = true;
    this.cursor = f.active ? (this.cursor + 1) % this.params.order.length : 0;
    const valid = [...this.valid];
    this.last = {
      index,
      theta: lookTheta(index, this.params),
      salt: lookSalt(index),
      reset,
      valid,
      validCount: valid.filter(Boolean).length,
    };
    return this.last;
  }

  /** Estado para los ganchos de prueba: la última mirada formada y los reinicios contados. */
  state(): { last: CompoundLook | null; resets: number } {
    return { last: this.last, resets: this.resetCount };
  }
}

/**
 * Constantes y peso de la pasada K en GLSL (etapa 2 de la decisión 58). Va detrás de `STEERING_GLSL`.
 * El número de miradas dimensiona los arrays de uniforms de K (`uLookSteer`, `uLookValid`).
 */
export const COMPOUND_GLSL = /* glsl */ `
const int COMPOUND_LOOKS = ${COMPOUND.order.length};
const float COMPOUND_TAPER_LINES = ${glslFloat(COMPOUND.taperLines)};
float lookWeight(float alpha, float rho, float theta, float curvR, float halfSector, float linesF) {
  if (theta == 0.0) return 1.0;
  float a = curvR * sin(theta);
  return lookCoverage(steeredElement(alpha, rho, theta, a), halfSector, linesF, COMPOUND_TAPER_LINES);
}
`;
