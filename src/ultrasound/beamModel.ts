/**
 * Modelo del haz de un convexo de 3,5 MHz con foco de transmisión único y
 * enfoque dinámico en recepción (apertura creciente con la profundidad, número F
 * mínimo), compartido por la imagen (PSF lateral, pasada D), la puerta del PW y
 * el ensanchamiento espectral. Todo en mm y radianes.
 *
 *   FWHM_tx(r) = s·√((k_tx·λ_tx(r)·F/D_tx)² + (c·D_tx·|r − F| / F)²)  difracción en el foco + cono fuera de él
 *   FWHM_rx(r) = k·λ(r)·r / min(D_rx,max, r / F#_rx,min)                 enfoque dinámico
 *   FWHM_2v(r) = 1 / √(1/FWHM_tx² + 1/FWHM_rx²)                          dos vías (EchoTwin, decisión 19)
 *
 * En fundamental λ_tx = λ y s = 1. En armónica (decisión 77, `harmonic.ts`) la emisión va a f1 = f/2 y la
 * fuente del armónico es ∝ p1²: λ_tx = 2λ y s = 1/√2.
 *
 * Aperturas (decisión 38, contrastadas en la 84): D_rx,max 26 mm y F#_rx,min 2,5 son la cuerda útil de un convexo
 * con la directividad del elemento a −3 dB (criterio de Perrot et al. 2021, Ultrasonics 111:106309; para un C5-2
 * de R 49,6 mm da 18 / 27 / 29 mm a 4 / 10 / 14 cm, F# 2,3 / 3,8 / 4,9) [DERIVADO]. Recepción k = 1,3 (−6 dB de
 * una vía entre la apertura uniforme, 1,21·λF#, y una apodización suave). La PSF resultante da 1,5–2,2 mm a 6–10 cm
 * y 3,4–3,8 mm a 15 cm con la bajada de la frecuencia (abajo), dentro de la resolución característica de 78
 * convexos abdominales (1,6–3,0 mm; Pye y Ellis 2011, J Phys Conf Ser 279:012009) y del peor lateral de 23
 * convexos en maniquí (2,71 mm; Cilia y Camilleri 2023, Med Phys Int 11:304).
 *
 * Emisión de la imagen B (decisión 84): la apertura de 26 mm con apodización de Hann, `kTx` 2,0 (el ancho a −6 dB
 * de una ventana de Hann, 2,0 bins: Harris 1978, Proc IEEE 66:51; ~50 % más que la uniforme) y cono de fracción
 * `txConeFraction` 0,5 (fuera del foco el perfil es la propia ventana proyectada, de FWHM la mitad de su ancho)
 * [EXTRAPOLACIÓN PROPIA: la apodización de emisión de un equipo clínico no está publicada]. El Doppler conserva la
 * emisión uniforme de la decisión 38.
 *
 * Bajada de la frecuencia central con la profundidad (decisión 84): la atenuación crece con la frecuencia y se come
 * la parte alta del espectro del eco. Con un espectro gaussiano de ida y vuelta de σ_f (amplitud) la pendiente es
 * df/dr = −2·β·σ_f², β la atenuación en Np/(mm·MHz) (Samimi y Varghese 2015, IEEE TUFFC 62:871; con la atenuación
 * lineal en f la banda no cambia, Narayana y Ophir 1983). El modelo usa la forma de ancho de banda fraccional
 * constante, f(r) = f0 / (1 + κ·r), κ = 2·β·σ_f²/f0 (la misma pendiente en la cara, sin pasar por cero): la del
 * filtro de seguimiento del equipo, que baja la frecuencia central, la banda y el corte alto con la profundidad al
 * ritmo del eco (patentes US 4 016 750, 1977, y US 6 516 667, 2003, también en armónica). λ(r) = λ·(1 + κ·r) en
 * la PSF lateral y el pulso axial se alarga en la misma proporción (`axialSigmaMm`). `downshiftRxPerMm` es κ del
 * eco; `downshiftTxPerMm`, la del pulso emitido a esa profundidad (en fundamental la misma: el espectro de una vía
 * es √2 más ancho y recorre la mitad del camino; en armónica, la de f1, la mitad). El Doppler (color y PW) es de
 * banda estrecha y conserva el haz sin bajada (`CONVEX_BEAM`).
 */
export interface BeamParams {
  /** λ de recepción (mm). */
  lambdaMm: number;
  /** λ de emisión (mm): la de recepción en fundamental, el doble en armónica. */
  lambdaTxMm: number;
  /** Escala del haz de emisión: 1 en fundamental; 1/√2 en armónica (la fuente va como p1²). */
  txScale: number;
  /** Apertura de emisión máxima (mm). */
  apertureTxMm: number;
  /**
   * Número F mínimo de la emisión: la apertura de emisión es min(D_tx, F/F#_tx), como la de recepción, por la
   * directividad del elemento. 0: sin límite (la apertura máxima a cualquier foco, el Doppler de la decisión 38).
   */
  fNumberTxMin: number;
  apertureRxMaxMm: number;
  fNumberRxMin: number;
  /** Factor de apodización de recepción sobre λ·F# (1 = apertura uniforme). */
  k: number;
  /** σ axial (mm) del pulso de dos vías en la cara (`axialSigmaMm`). */
  axialSigma0Mm: number;
  /** Ídem de la emisión en su foco (la FWHM es kTx·λ_tx·F/D_tx). */
  kTx: number;
  /** FWHM del cono de emisión fuera del foco como fracción de la apertura (1 uniforme, ½ Hann). */
  txConeFraction: number;
  /** Bajada de la frecuencia central del eco con la profundidad (1/mm): f0/f(r) = 1 + κ·r. 0: sin bajada. */
  downshiftRxPerMm: number;
  /** Ídem del pulso emitido a la profundidad r. */
  downshiftTxPerMm: number;
  /**
   * Foco (mm) con que el preajuste deja el hígado a media escala (decisión 53): la referencia fija de la ganancia focal,
   * el foco por defecto del equipo (`DEFAULT_BMODE.focusMm`).
   */
  focalReferenceMm: number;
  /**
   * Exponente n de la emisión en la ganancia focal fuera del foco, donde el haz de emisión es mucho más ancho que el de
   * recepción: la amplitud del eco va como FWHM_tx^(−n), ½ en fundamental (la raíz de la intensidad de la emisión en
   * el eje) y 1 en armónica (el armónico nace como p1², así que su amplitud va como la intensidad). `focalGain`.
   */
  focalExponent: number;
}

export const CONVEX_BEAM: BeamParams = {
  lambdaMm: 1540 / 3.5e3, // 0,44 mm a 3,5 MHz
  lambdaTxMm: 1540 / 3.5e3,
  txScale: 1,
  apertureTxMm: 26,
  fNumberTxMin: 0,
  apertureRxMaxMm: 26,
  fNumberRxMin: 2.5,
  k: 1.3,
  axialSigma0Mm: 0.26,
  kTx: 1.3,
  txConeFraction: 1,
  downshiftRxPerMm: 0,
  downshiftTxPerMm: 0,
  focalReferenceMm: 90,
  focalExponent: 0.5,
};

/**
 * σ axial (mm) del pulso de dos vías de la pasada C en la cara en fundamental (≈ 2 ciclos a 3,5 MHz; FWHM 0,61 mm,
 * dentro del ≤ 0,9 mm de la AAPM para sondas de < 4 MHz y del ≤ 1,19 mm de 23 convexos en maniquí, Cilia y Camilleri
 * 2023): la gaussiana de `FRAG_AXIAL` tiene σ = max(0,6; axialSigmaMm(r)/dr) muestras. La comparten el renderizador,
 * los gemelos B→C→D y la anchura del perfil de la cápsula difusa (decisión 64).
 */
export const AXIAL_SIGMA_MM = CONVEX_BEAM.axialSigma0Mm;

/** Velocidad del sonido de reconstrucción en mm/µs (la σ espectral en MHz da la temporal en µs). */
const C_MM_US = 1.54;

/**
 * σ axial en la cara (mm) de un eco de ancho de banda fraccional `bandwidth` a través del filtro de recepción de la
 * imagen (decisión 84): el pulso de dos vías es el espectro del eco por el del filtro, 1/σ² = 1/σ_eco² + 1/σ_filtro²
 * (gaussianas), y σ_z = c/(4π·σ). El filtro sale de calibrar el fundamental: su eco de `fundamentalBandwidth` da
 * `AXIAL_SIGMA_MM`. En armónica el eco es más estrecho y el pulso, más largo (van Wijk y Thijssen 2002).
 */
export function pulseSigmaMm(bandwidth: number, fundamentalBandwidth: number, f0MHz: number): number {
  const sigmaOf = (bw: number): number => (bw * f0MHz) / 2.3548;
  const pulse = C_MM_US / (4 * Math.PI * AXIAL_SIGMA_MM);
  const invFilter2 = 1 / (pulse * pulse) - 1 / sigmaOf(fundamentalBandwidth) ** 2;
  const eff = 1 / Math.sqrt(1 / sigmaOf(bandwidth) ** 2 + invFilter2);
  return C_MM_US / (4 * Math.PI * eff);
}

/** Np por dB de amplitud (1 Np = 20/ln 10 dB). */
const NP_PER_DB = Math.LN10 / 20;

/**
 * κ de la bajada de la frecuencia central (1/mm) para un eco de ida y vuelta de ancho de banda fraccional
 * `bandwidth` (a −6 dB) centrado en `f0MHz`, en un tejido de atenuación `alphaDbPerCmMHz` (lineal en f):
 * κ = 2·β·σ_f²/f0, con σ_f = bandwidth·f0/2,355 y β en Np/(mm·MHz).
 */
export function downshiftPerMm(bandwidth: number, f0MHz: number, alphaDbPerCmMHz: number): number {
  const sigma = (bandwidth * f0MHz) / 2.3548;
  const beta = (alphaDbPerCmMHz / 10) * NP_PER_DB;
  return (2 * beta * sigma * sigma) / f0MHz;
}

/** f(r)/f0 del eco a la profundidad r (mm): 1/(1 + κ·r). */
export function frequencyRatio(rMm: number, p: BeamParams = CONVEX_BEAM): number {
  return 1 / (1 + p.downshiftRxPerMm * Math.max(0, rMm));
}

/**
 * σ axial (mm) a la profundidad r: la del pulso en la cara estirada por la bajada, porque el filtro de seguimiento
 * conserva el ancho de banda fraccional y la banda absoluta se estrecha con la frecuencia central.
 */
export function axialSigmaMm(rMm: number, p: BeamParams = CONVEX_BEAM): number {
  return p.axialSigma0Mm * (1 + p.downshiftRxPerMm * Math.max(0, rMm));
}

/** Apertura de emisión (mm) con el foco F: la máxima, o F/F#_tx,min si esa es menor (`fNumberTxMin`). */
export function txApertureMm(focusMm: number, p: BeamParams = CONVEX_BEAM): number {
  const F = Math.max(10, focusMm);
  return p.fNumberTxMin > 0 ? Math.min(p.apertureTxMm, F / p.fNumberTxMin) : p.apertureTxMm;
}

/** FWHM (mm) de los haces de emisión y de recepción de una vía a la profundidad r. */
export function beamFwhmMm(rMm: number, focusMm: number, p: BeamParams = CONVEX_BEAM): { tx: number; rx: number } {
  const r = Math.max(1, rMm);
  const F = Math.max(10, focusMm);
  const lambdaTx = p.lambdaTxMm * (1 + p.downshiftTxPerMm * r);
  const D = txApertureMm(F, p);
  const tx = p.txScale * Math.hypot((p.kTx * lambdaTx * F) / D, (p.txConeFraction * D * Math.abs(r - F)) / F);
  const dRx = Math.min(p.apertureRxMaxMm, r / p.fNumberRxMin);
  const rx = (p.k * p.lambdaMm * (1 + p.downshiftRxPerMm * r) * r) / Math.max(1, dRx);
  return { tx, rx };
}

export function lateralFwhmMm(rMm: number, focusMm: number, p: BeamParams = CONVEX_BEAM): number {
  const { tx, rx } = beamFwhmMm(rMm, focusMm, p);
  return 1 / Math.sqrt(1 / (tx * tx) + 1 / (rx * rx));
}

/** σ lateral (mm) de la PSF de dos vías (gaussiana equivalente: FWHM / 2,355). */
export function lateralSigmaMm(rMm: number, focusMm: number, p: BeamParams = CONVEX_BEAM): number {
  return lateralFwhmMm(rMm, focusMm, p) / 2.3548;
}

/**
 * Ganancia focal (amplitud, decisión 84): cómo cambia con la profundidad el eco de un medio difuso por la concentración
 * de la emisión en el foco. Con haces gaussianos y la potencia fija, la intensidad en el eje va como 1/FWHM
 * (conservación de la energía a través del haz), en la emisión y, por reciprocidad, en la sensibilidad de la
 * recepción; el eco de un medio difuso es ∫|h_tx|²·|h_rx|² a lo ancho del haz, ∝ 1/√(FWHM_tx² + FWHM_rx²), y su
 * amplitud, (FWHM_tx² + FWHM_rx²)^(−¼). En armónica la fuente del armónico es p1²: su intensidad va como la de la
 * emisión al cuadrado, ∝ 1/FWHM_tx² (con la FWHM del haz efectivo, ya /√2 en `txScale`), y la amplitud, como
 * FWHM_tx^(−½)·(FWHM_tx² + FWHM_rx²)^(−¼). Las dos: (FWHM_tx,ref/FWHM_tx)^(n − ½)·√(|FWHM_ref|/|FWHM|), con n
 * (`focalExponent`) ½ y 1 y |FWHM| = √(FWHM_tx² + FWHM_rx²); fuera del foco, donde la emisión es mucho más ancha
 * que la recepción, va como FWHM_tx^(−n) [DERIVADO de haces gaussianos]. La referencia es fija, los haces en el foco
 * con el foco del preajuste (`focalReferenceMm`, el foco por defecto): con él vale 1 en el foco, así que el hígado
 * sigue a media escala en el foco por defecto (decisión 53), y menos por encima y por debajo, la banda algo más clara
 * del foco (Oosterveld, Thijssen y Verhoef 1985, Ultrason Imaging 7:142: la amplitud media del eco culmina en el
 * foco). Con otro foco la banda se mueve con él y su pico cambia con su cintura: más claro con el foco somero y
 * estrecho, más apagado con el hondo y ancho, como la potencia emitida repartida en otra anchura; con un foco hondo el
 * pico se adelanta (a 122 mm con el foco a 140: pasada la apertura máxima la recepción se ensancha con r), con la cima
 * plana (≤ 0,2 dB sobre el valor en el foco). Con la emisión de Hann de la imagen B a F/3,5 da −4,1 dB a 20 mm y −3,9 dB a 150 mm en fundamental, y −5,0 / −4,7 dB en armónica:
 * la emisión a f1 enfoca menos, pero la fuente p1² dobla los dB de la emisión. Contraste: Bottenus 2018 (IEEE TUFFC
 * 65:30) mide 8,2 y 9,6 dB de señal entre la emisión enfocada a 40 mm y la enfocada en cada profundidad, a 10 y 95 mm
 * (sectorial de 19,2 mm a 2,98 MHz); con ese montaje y emisión uniforme el modelo da 10–13 y 7,5 dB (con la de Hann,
 * 7–9 y 3,5 dB). Solo el eco de la imagen B, no el ruido del receptor, el transitorio ni el Doppler.
 */
export function focalGain(rMm: number, focusMm: number, p: BeamParams = CONVEX_BEAM): number {
  const ref = focalReferenceFwhmMm(p);
  const w = beamFwhmMm(rMm, focusMm, p);
  return Math.pow(ref.tx / w.tx, p.focalExponent - 0.5) * Math.sqrt(Math.hypot(ref.tx, ref.rx) / Math.hypot(w.tx, w.rx));
}

/**
 * FWHM de la emisión y de la recepción en el foco con el foco del preajuste: la referencia de `focalGain` (uniforms
 * `uFocus.y`, la de la emisión, y `uFocus.w`, √(FWHM_tx² + FWHM_rx²)).
 */
export function focalReferenceFwhmMm(p: BeamParams = CONVEX_BEAM): { tx: number; rx: number } {
  return beamFwhmMm(p.focalReferenceMm, p.focalReferenceMm, p);
}

/**
 * Dispersión angular (σ, rad) con que la apertura «ve» un dispersor a la
 * profundidad r: cada elemento recibe con un ángulo distinto respecto al eje del
 * haz, lo que ensancha el espectro Doppler (ensanchamiento intrínseco,
 * Δf/f ≈ tan θ · D / 2r). Se usa la apertura de recepción efectiva.
 */
export function apertureAngleSigmaRad(rMm: number, p: BeamParams = CONVEX_BEAM): number {
  const r = Math.max(10, rMm);
  const dRx = Math.min(p.apertureRxMaxMm, r / p.fNumberRxMin);
  return dRx / (4 * r);
}
