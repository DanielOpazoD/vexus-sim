import type { BeamParams } from './beamModel';

/**
 * Armónica tisular (THI, decisión 77): el convexo emite a f1 y forma la imagen con el segundo armónico que
 * el propio tejido genera al propagar el pulso (propagación no lineal), separado del fundamental por
 * inversión de pulso. Es el modo por defecto de un equipo abdominal moderno y el de las referencias reales
 * del banco (desviación del gris 10–16 «en equipos modernos, THI y composición espacial»). Cambia frente al
 * fundamental esto, y nada más:
 *
 *  - Haz de la imagen: la fuente armónica va como p1², así que el haz de emisión a f1 (λ1 = 2λ, con el doble
 *    de cintura y de rango de Rayleigh en elevación) se estrecha ÷√2 en difracción y en desenfoque; la
 *    recepción es a 2·f1, la λ del fundamental de 3,5 MHz. El lóbulo principal queda ~15 % más ancho en el
 *    foco e igual o más estrecho fuera de él: lo que gana la armónica son los lóbulos laterales, no el
 *    principal [LITERATURA: Ward, Baker y Humphrey 1997, JASA 101:143; Humphrey 2000, Ultrasonics 38:267].
 *  - Ecos parásitos (decisión 76): el pedestal de lóbulos laterales y la reverberación de la pared bajan
 *    `CLUTTER.harmonicReductionDb` (`clutterParams(…, true)`): la reverberación recorre la pared, donde el
 *    armónico aún no se ha formado, y los lóbulos laterales del haz armónico son los del fundamental al
 *    cuadrado [LITERATURA: Anvari et al. 2015, RadioGraphics 35:1955; Choudhry et al. 2000, RadioGraphics
 *    20:1127; nivel ESTIMADO].
 *  - Transitorio del transductor (`receiver.ts`): es de banda fundamental y la inversión de pulso lo rechaza
 *    `fundamentalRejectionDb` [ESTIMADO; la inversión de pulso da 20–40 dB: Simpson, Chin y Burns 1999, IEEE
 *    UFFC 46:372].
 *  - Acumulación: el armónico crece con el camino recorrido y el preajuste lo compensa desde `buildUpRefMm`: solo los
 *    primeros milímetros (la piel) quedan más oscuros, `harmonicNearGain`. Se aplica al eco del tejido en la pasada B,
 *    antes de sumar el transitorio y el ruido, que no son armónicos. [ESTIMADO: con 8/10 mm las líneas de la pared de
 *    la decisión 62 bajaban hasta 6 dB (gemelo, revisión de #89); con 2/4 mm quedan como en fundamental.]
 *  - Ruido: la señal armónica es mucho más débil que el eco fundamental; con la potencia de emisión y la
 *    ganancia del preajuste, el ruido del receptor sube `noiseDb` respecto al eco: algo menos de penetración.
 *    [ESTIMADO: calibrado con el centro de la luz del banco. Con +6 dB la VCI subxifoidea quedaba en una mediana
 *    de 10 de gris, fuera de las referencias reales de equipos con THI (0,6–9,6). Con +3 dB queda en 7, y con
 *    0 dB en 4, lo mismo que el fundamental.]
 *  - Atenuación: la ida paga 2·α(f1), porque la fuente va como p1², y la vuelta α(2·f1). Con el
 *    desplazamiento a bajas de `bEffectiveMHz` (2,5 de 3,5 MHz), 2·α(1,25) + α(2,5) = 2·α(2,5) con α lineal
 *    en f: la del fundamental. `bEffectiveMHz`, la TGC nominal y su techo no cambian [DERIVADO].
 *  - Doppler: fundamental. El color y el PW no cambian (`CONVEX_BEAM`, `dopplerEffectiveMHz`).
 */
export const HARMONIC = {
  /** Emisión (f1) y recepción (2·f1), MHz. */
  txMHz: 1.75,
  rxMHz: 3.5,
  /** Rechazo de la banda fundamental por la inversión de pulso (dB de amplitud): el transitorio. */
  fundamentalRejectionDb: -20,
  /** Longitud de acumulación del armónico (mm) y profundidad desde la que el preajuste la compensa. */
  buildUpMm: 2,
  buildUpRefMm: 4,
  /** Subida del ruido del receptor respecto al eco (dB): la ganancia que compensa la conversión. */
  noiseDb: 3,
} as const;

const dbAmp = (db: number): number => Math.pow(10, db / 20);

/** Ganancia del transitorio del transductor: 1 en fundamental; el rechazo de su banda en armónica. */
export const transientGain = (harmonic: boolean): number => (harmonic ? dbAmp(HARMONIC.fundamentalRejectionDb) : 1);

/** Factor del ruido del receptor respecto al eco: 1 en fundamental. */
export const noiseGain = (harmonic: boolean): number => (harmonic ? dbAmp(HARMONIC.noiseDb) : 1);

/**
 * Haz de la imagen armónica a partir del fundamental del perfil: recibe a la frecuencia nominal de la sonda (la λ del
 * perfil) y emite a la mitad (λ1 = 2λ) con la fuente ∝ p1² (÷√2). Mismas aperturas, número F y apodización: la
 * apertura de emisión efectiva de 26 mm se supone la misma a f1, aunque la directividad de los elementos la ensancharía
 * algo (el haz de emisión saldría algo más estrecho).
 */
export function harmonicBeam(fundamental: BeamParams): BeamParams {
  return { ...fundamental, lambdaTxMm: 2 * fundamental.lambdaMm, txScale: Math.SQRT1_2 };
}

/**
 * Acumulación del armónico en el campo cercano (amplitud relativa a la compensada, ≤ 1): crece como
 * 1 − e^(−r/L) y el preajuste la lleva a 1 desde `buildUpRefMm`. 1 en fundamental. Gemelo de
 * `harmonicNearGain` de `HARMONIC_GLSL` (pasada B, uniform `uHarmonicNear`), con r el camino recorrido.
 */
export function harmonicNearGain(rMm: number, harmonic: boolean): number {
  const { buildUpMm: L, buildUpRefMm: ref } = HARMONIC;
  if (!harmonic || rMm >= ref) return 1;
  return (1 - Math.exp(-Math.max(0, rMm) / L)) / (1 - Math.exp(-ref / L));
}

/** Uniform `uHarmonicNear` de la pasada B: (L, profundidad de referencia) en armónica; (0, 0) en fundamental. */
export const harmonicNearUniform = (harmonic: boolean): [number, number] =>
  harmonic ? [HARMONIC.buildUpMm, HARMONIC.buildUpRefMm] : [0, 0];

/** Acumulación del armónico para la pasada B (las dos miradas): gemelo de `harmonicNearGain`. */
export const HARMONIC_GLSL = /* glsl */ `
uniform vec2 uHarmonicNear; // acumulación del armónico (decisión 77): L y profundidad de referencia (mm); x = 0 en fundamental
float harmonicNearGain(float r) {
  if (uHarmonicNear.x <= 0.0 || r >= uHarmonicNear.y) return 1.0;
  return (1.0 - exp(-max(r, 0.0) / uHarmonicNear.x)) / (1.0 - exp(-uHarmonicNear.y / uHarmonicNear.x));
}
`;
