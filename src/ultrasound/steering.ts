import { CONVEX_BEAM, type BeamParams } from './beamModel';

/**
 * Geometría exacta de las miradas dirigidas de un convexo (composición espacial, decisión 58).
 *
 * La mirada de ángulo θ (en el elemento, el mismo en todo el arreglo) sale del elemento φ con
 * dirección φ + θ. En el plano de imagen, con origen en el centro de curvatura (x lateral, z axial,
 * ángulo polar α = atan2(x, z) como `lineTheta`), el camino es
 *
 *   p(s) = R·(sin φ, cos φ) + s·(sin(φ + θ), cos(φ + θ)),
 *
 * y corta la circunferencia ρ = R + r a la distancia s(ρ) = √(ρ² − a²) − R·cos θ, con a = R·sin θ: s
 * depende solo de ρ, así que cada mirada conserva las filas de profundidad de la mirada 0. En ese cruce
 * el ángulo polar es α = φ + θ − β(ρ), β = asin(a/ρ) (teorema del seno), de modo que la inversa es
 * cerrada, φ_k = α − θ + β(ρ), y la dirección del haz en el punto es α + β. Con θ = 7° y R = 60 mm,
 * β = 5,24 / 3,99 / 2,79 / 2,00 / 1,75° a 20 / 45 / 90 / 150 / 180 mm.
 *
 * Fase de mirada: ψ_k(ρ, α) = √(ρ² − a²) + a·(α + β) − a·π/2 es un potencial exacto de la dirección del
 * haz (∇ψ_k = b_k: la involuta del círculo de radio a), así que el desfase de ida y vuelta de la mirada k
 * respecto a la 0, Δ_k = k2·(ψ_k − ρ), es una función global y suave de la posición, con gradiente
 * k2·(b_k − b_0) (k2 = 2·k_rx = 4π/λ). La pasada B lo aplica por nodo de la retícula del moteado
 * (`speckleField.ts`, variantes `…Ph`): cada mirada ve los mismos dispersores con otra fase, y su
 * moteado se decorrela de la mirada 0 según la ley gaussiana de la PSF (Trahey, Smith y von Ramm 1986;
 * O'Donnell y Silverstein 1988), sin ningún filtro.
 *
 * Gemelos: estas funciones (TS, pruebas y anillo del compuesto) y `STEERING_GLSL` (pasadas A2, A, B y K;
 * la GPU las incluye en la etapa 2 de la decisión 58), misma fórmula.
 */

/** Número de onda de ida y vuelta de la fase de mirada, k2 = 2·k_rx = 4π/λ_rx (rad/mm): 28,56 a 3,5 MHz. */
export function lookWavenumber(beam: BeamParams = CONVEX_BEAM): number {
  return (4 * Math.PI) / beam.lambdaMm;
}

/** Ángulo β(ρ) = asin(R·sin θ / ρ) entre el haz dirigido y el radio en el punto (con el signo de θ). */
export function steerBeta(rho: number, theta: number, R: number): number {
  if (theta === 0) return 0;
  return Math.asin((R * Math.sin(theta)) / rho);
}

/** Distancia a lo largo del camino dirigido hasta el radio ρ: s(ρ) = √(ρ² − a²) − R·cos θ (θ = 0: ρ − R). */
export function alongLineMm(rho: number, theta: number, R: number): number {
  if (theta === 0) return rho - R;
  const a = R * Math.sin(theta);
  return Math.sqrt(rho * rho - a * a) - R * Math.cos(theta);
}

/** Inversa de `alongLineMm`: el radio al que llega el camino dirigido tras recorrer s. */
export function rhoAlongLine(s: number, theta: number, R: number): number {
  return Math.sqrt(R * R + s * s + 2 * R * s * Math.cos(theta));
}

/** Elemento del que sale la mirada θ que pasa por (α, ρ): φ_k = α − θ + β(ρ). */
export function steeredElement(alpha: number, rho: number, theta: number, R: number): number {
  if (theta === 0) return alpha;
  return alpha - theta + steerBeta(rho, theta, R);
}

/**
 * Potencial exacto de la mirada, ψ_k = √(ρ² − a²) + a·(α + β) − a·π/2 (mm): ∇ψ_k es la dirección del haz
 * dirigido que pasa por el punto. Con θ = 0, ψ = ρ.
 */
export function lookPotential(rho: number, alpha: number, theta: number, R: number): number {
  if (theta === 0) return rho;
  const a = R * Math.sin(theta);
  return Math.sqrt(rho * rho - a * a) + a * (alpha + Math.asin(a / rho)) - (a * Math.PI) / 2;
}

/**
 * Desfase de la mirada respecto a la mirada 0 en (ρ, α), Δ_k = k2·(ψ_k − ρ) sin la constante −a·π/2 (una
 * fase común a toda la mirada no cambia la envolvente, y así la fase queda pequeña en float32). La forma
 * √(ρ² − a²) − ρ = −a²/(√(ρ² − a²) + ρ) evita la cancelación. θ = 0: 0 exacto.
 */
export function lookPhase(rho: number, alpha: number, theta: number, R: number, k2: number): number {
  if (theta === 0) return 0;
  const a = R * Math.sin(theta);
  const c = Math.sqrt(Math.max(rho * rho - a * a, 0));
  return k2 * (a * (alpha + Math.asin(a / rho)) - (a * a) / (c + rho));
}

/**
 * Gradiente de `lookPhase` (rad/mm) en el marco (x lateral, z axial): k2·(b_k − b_0), con
 * b_k − b_0 = 2·sin(β/2)·(cos(α + β/2), −sin(α + β/2)) (sin cancelación). θ = 0: (0, 0).
 */
export function lookPhaseGrad(rho: number, alpha: number, theta: number, R: number, k2: number): [number, number] {
  if (theta === 0) return [0, 0];
  const b = steerBeta(rho, theta, R);
  const m = alpha + 0.5 * b;
  const g = 2 * k2 * Math.sin(0.5 * b);
  return [g * Math.cos(m), -g * Math.sin(m)];
}

/**
 * Cobertura (0–1) de la mirada cuyo elemento es φ_k: 1 dentro del arreglo, 0 fuera, con una rampa de
 * `taperLines` líneas centrada en el borde (la última línea del arreglo, a media línea del borde, vale 1).
 * Un camino que saldría de un elemento inexistente no se forma.
 */
export function lookCoverage(phiK: number, halfSector: number, lines: number, taperLines: number): number {
  const dPhi = (2 * halfSector) / lines;
  const c = (halfSector - Math.abs(phiK)) / (taperLines * dPhi) + 0.5;
  return c <= 0 ? 0 : c >= 1 ? 1 : c;
}

/**
 * Las mismas funciones en GLSL (a = R·sin θ, rCos = R·cos θ; θ ≠ 0: la mirada 0 sigue la rama de hoy y no
 * las llama). Funciones puras, sin uniforms: las incluyen A2, A, B y K (etapa 2 de la decisión 58).
 */
export const STEERING_GLSL = /* glsl */ `
float steerBeta(float rho, float a) { return asin(a / rho); }
float alongLineMm(float rho, float a, float rCos) { return sqrt(max(rho * rho - a * a, 0.0)) - rCos; }
float steeredElement(float alpha, float rho, float theta, float a) { return alpha - theta + asin(a / rho); }
float lookPhase(float rho, float alpha, float a, float k2) {
  float c = sqrt(max(rho * rho - a * a, 0.0));
  return k2 * (a * (alpha + asin(a / rho)) - a * a / (c + rho));
}
vec2 lookPhaseGrad(float rho, float alpha, float a, float k2) {
  float b = asin(a / rho);
  float m = alpha + 0.5 * b;
  return 2.0 * k2 * sin(0.5 * b) * vec2(cos(m), -sin(m));
}
float lookCoverage(float phiK, float halfSector, float linesF, float taperLines) {
  float dPhi = 2.0 * halfSector / linesF;
  return clamp((halfSector - abs(phiK)) / (taperLines * dPhi) + 0.5, 0.0, 1.0);
}
`;
