/**
 * Ecos parásitos del modo fundamental (decisión 76): lo que en un ecógrafo real ensucia las luces anecoicas
 * (vasos, vesícula) y que el simulador no tenía («luces sin ruido», el juez ciego de la ronda 2).
 *
 *  - Lóbulos laterales: la PSF lateral de dos vías no es solo el lóbulo principal gaussiano de `beamModel.ts`;
 *    los lóbulos laterales de la apertura, y sobre todo la aberración de fase de la pared (grasa y músculo con otra
 *    velocidad del sonido), reparten una fracción de la energía en un pedestal ancho. Se modela como una segunda
 *    gaussiana coherente en el núcleo de la pasada D, de anchura `sidelobeWidth` veces la del lóbulo principal y con
 *    energía integrada relativa ISLR: dentro del tejido no cambia nada visible, pero junto a una cara brillante
 *    (diafragma, pared de la VCI, costilla) lleva al interior de la luz vecina una neblina moteada.
 *  - Reverberación de la pared: el eco de cada capa de la pared vuelve a reflejarse en la cara de la sonda y en
 *    las capas de encima, y llega de nuevo a una y dos veces el grosor de la pared; en la pasada C se suman al campo
 *    dos réplicas del propio campo desplazadas `W` y `2W` hacia arriba, ancladas a la sonda (no al tejido). En el
 *    tejido quedan bajo el moteado; en una luz cercana a la pared (vesícula, VCI subxifoidea) dan bandas tenues
 *    paralelas a la piel.
 *
 * Los dos crecen con la grasa subcutánea (la aberración y la reverberación empeoran en el obeso) y la armónica
 * tisular los reduce (decisión 77). Niveles [ESTIMADO] con capturas de GPU frente a las referencias de la
 * revisión: neblina de 8–20 de gris en luces junto a caras brillantes y bandas de reverberación apenas visibles en
 * la vesícula. Gemelos: `lateralKernel`/`axialReverb` (TS, los usan los gemelos de CPU) y los núcleos de
 * `FRAG_AXIAL`/`FRAG_LATERAL` (misma fórmula).
 */
export const CLUTTER = {
  /** Energía integrada del pedestal de lóbulos laterales respecto a la del principal (dB). */
  sidelobeIslrDb: -24,
  /** Anchura del pedestal (σ, en múltiplos de la σ del lóbulo principal). */
  sidelobeWidth: 7,
  /** Radio máximo del núcleo lateral (líneas). */
  lateralMaxLines: 40,
  /** Réplicas de reverberación de la pared: primera (a W) y segunda (a 2W), dB de amplitud sobre el campo. */
  reverbFirstDb: -50,
  reverbSecondDb: -62,
  /**
   * Solo reverberan los ecos fuertes (caras especulares de la pared: fascias, peritoneo), no el moteado: umbral
   * suave sobre el módulo del campo en bruto (el moteado del hígado sin atenuar tiene módulo medio ≈ 0,89).
   */
  reverbGate: [1.5, 3.5] as const,
  /** Grasa subcutánea de referencia (mm): con más grasa, más aberración y más reverberación. */
  fatRefMm: 14,
  /** Pendiente con la grasa (dB por mm por encima de la referencia; negativa por debajo). */
  fatSlopeDbPerMm: 0.35,
  /** La armónica tisular (decisión 77) reduce el pedestal y la reverberación estos dB. */
  harmonicReductionDb: 12,
} as const;

/** Parámetros de los ecos parásitos para una pared y un modo: amplitud del pedestal y ganancias de las réplicas. */
export interface ClutterParams {
  /** Amplitud relativa del pedestal en el núcleo lateral (peso en el centro frente al principal = 1). */
  sidelobeAmp: number;
  sidelobeWidth: number;
  /** Profundidad de la cara interna de la pared (mm): el desplazamiento de las réplicas. */
  wallMm: number;
  /** Ganancias de amplitud de la primera y la segunda réplica. */
  reverb: [number, number];
}

const dbAmp = (db: number): number => Math.pow(10, db / 20);

/**
 * Parámetros para una pared de `wallMm` con `fatMm` de grasa subcutánea, en fundamental o en armónica. La amplitud
 * del pedestal sale de su energía: a²·Σexp(−(k/wσ)²) / Σexp(−(k/σ)²) = ISLR, es decir a² · w = ISLR.
 */
export function clutterParams(wallMm: number, fatMm: number, harmonic = false): ClutterParams {
  const c = CLUTTER;
  const fatDb = c.fatSlopeDbPerMm * (fatMm - c.fatRefMm) - (harmonic ? c.harmonicReductionDb : 0);
  const islr = Math.pow(10, (c.sidelobeIslrDb + fatDb) / 10);
  return {
    sidelobeAmp: Math.sqrt(islr / c.sidelobeWidth),
    sidelobeWidth: c.sidelobeWidth,
    wallMm,
    reverb: [dbAmp(c.reverbFirstDb + fatDb), dbAmp(c.reverbSecondDb + 2 * fatDb)],
  };
}

/**
 * Pantalla de fase del pedestal por desplazamiento de línea k ∈ [−R, R] (R = `lateralMaxLines`): la aberración de la
 * pared da a los lóbulos laterales una fase aleatoria fija, así que su suma coherente sobre un reflector continuo
 * (cápsula, pared) promedia cero y no cambia el eco especular calibrado, mientras su energía (ISLR) lleva a las luces
 * el moteado de lo que las rodea. Generador congruencial determinista: la misma tabla en TS y en GLSL.
 */
export const SIDELOBE_PHASES: readonly number[] = (() => {
  let s = 20260926;
  const out: number[] = [];
  for (let k = 0; k <= 2 * CLUTTER.lateralMaxLines; k++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    out.push((s / 2147483648) * 2 * Math.PI);
  }
  return out;
})();

/**
 * Núcleo lateral de la pasada D (pesos complejos por línea, energía unidad): gaussiana principal real de σ líneas
 * más el pedestal de lóbulos laterales con su fase (`SIDELOBE_PHASES`). Gemelo de `FRAG_LATERAL`. `coupling` es el
 * acoplamiento de la línea de destino: una línea sin contacto no recibe lóbulos laterales.
 */
export function lateralKernel(
  sigmaLines: number,
  p: Pick<ClutterParams, 'sidelobeAmp' | 'sidelobeWidth'>,
  coupling = 1,
): Array<[number, number]> {
  const amp = p.sidelobeAmp * coupling;
  const sp = sigmaLines * p.sidelobeWidth;
  const R = Math.min(CLUTTER.lateralMaxLines, Math.ceil(Math.max(sigmaLines * 2.5, amp > 0 ? sp * 2.5 : 0)));
  const w: Array<[number, number]> = [];
  for (let k = -R; k <= R; k++) {
    const gm = Math.exp(-0.5 * (k / sigmaLines) ** 2);
    const gp = amp * Math.exp(-0.5 * (k / sp) ** 2);
    const ph = SIDELOBE_PHASES[k + CLUTTER.lateralMaxLines];
    w.push([gm + gp * Math.cos(ph), gp * Math.sin(ph)]);
  }
  const n = Math.sqrt(w.reduce((a, [re, im]) => a + re * re + im * im, 0));
  return w.map(([re, im]) => [re / n, im / n]);
}

/** Aplica un núcleo complejo a un campo complejo: Σ w·f (producto complejo). */
export function applyComplexKernel(
  w: ReadonlyArray<readonly [number, number]>,
  at: (k: number) => readonly [number, number],
): [number, number] {
  const R = (w.length - 1) / 2;
  let re = 0;
  let im = 0;
  for (let k = -R; k <= R; k++) {
    const [wr, wi] = w[k + R];
    const [fr, fi] = at(k);
    re += wr * fr - wi * fi;
    im += wr * fi + wi * fr;
  }
  return [re, im];
}

/** Tabla GLSL de la pantalla de fase (cos, sin) indexada por k + R. */
export const SIDELOBE_PHASE_GLSL = `const vec2 PED_PHASE[${2 * CLUTTER.lateralMaxLines + 1}] = vec2[${2 * CLUTTER.lateralMaxLines + 1}](${SIDELOBE_PHASES.map(
  (ph) => `vec2(${Math.cos(ph).toFixed(7)}, ${Math.sin(ph).toFixed(7)})`,
).join(', ')});`;

/** Radio del núcleo lateral en líneas (el mismo recorte que `lateralKernel` y `FRAG_LATERAL`). */
export function lateralKernelRadius(sigmaLines: number, p: Pick<ClutterParams, 'sidelobeAmp' | 'sidelobeWidth'>, coupling = 1): number {
  return (lateralKernel(sigmaLines, p, coupling).length - 1) / 2;
}

/**
 * Réplicas de reverberación que la pasada C suma a la muestra de profundidad `rMm`: pares (desplazamiento hacia
 * arriba en mm, ganancia). Sin réplica donde el desplazamiento se saldría del campo. Gemelo de `FRAG_AXIAL`.
 */
/** Peso de un eco en las réplicas de reverberación según el módulo de su campo en bruto (smoothstep de `reverbGate`). */
export function reverbGateWeight(fieldMagnitude: number): number {
  const [a, b] = CLUTTER.reverbGate;
  const t = Math.min(1, Math.max(0, (fieldMagnitude - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function axialReverb(rMm: number, p: Pick<ClutterParams, 'wallMm' | 'reverb'>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (p.wallMm <= 0) return out;
  if (rMm > p.wallMm && p.reverb[0] > 0) out.push([p.wallMm, p.reverb[0]]);
  if (rMm > 2 * p.wallMm && p.reverb[1] > 0) out.push([2 * p.wallMm, p.reverb[1]]);
  return out;
}
