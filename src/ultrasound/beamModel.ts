/**
 * Modelo del haz de un convexo de 3,5 MHz con foco de transmisión único y
 * enfoque dinámico en recepción (apertura creciente con la profundidad, número F
 * mínimo), compartido por la imagen (PSF lateral, pasada D), la puerta del PW y
 * el ensanchamiento espectral. Todo en mm y radianes.
 *
 *   FWHM_tx(r) = s·√((k·λ_tx·F/D_tx)² + (D_tx·|r − F| / F)²)  difracción en el foco + geometría fuera de él
 *   FWHM_rx(r) = k·λ·r / min(D_rx,max, r / F#_rx,min)            enfoque dinámico
 *   FWHM_2v(r) = 1 / √(1/FWHM_tx² + 1/FWHM_rx²)                   dos vías (EchoTwin, decisión 19)
 *
 * En fundamental λ_tx = λ y s = 1. En armónica (decisión 77, `harmonic.ts`) la emisión va a f1 = f/2 y la
 * fuente del armónico es ∝ p1²: λ_tx = 2λ y s = 1/√2.
 *
 * k = 1,3 (apertura apodizada). D efectivas de 26 mm: la directividad de los
 * elementos limita la apertura útil de un convexo a bastante menos que su huella
 * (62 mm) [EXTRAPOLACIÓN PROPIA / NEEDS_CALIBRATION contra la PSF de un equipo].
 */
export interface BeamParams {
  /** λ de recepción (mm). */
  lambdaMm: number;
  /** λ de emisión (mm): la de recepción en fundamental, el doble en armónica. */
  lambdaTxMm: number;
  /** Escala del haz de emisión: 1 en fundamental; 1/√2 en armónica (la fuente va como p1²). */
  txScale: number;
  apertureTxMm: number;
  apertureRxMaxMm: number;
  fNumberRxMin: number;
  /** Factor de apodización sobre λ·F# (1 = apertura uniforme). */
  k: number;
}

export const CONVEX_BEAM: BeamParams = {
  lambdaMm: 1540 / 3.5e3, // 0,44 mm a 3,5 MHz
  lambdaTxMm: 1540 / 3.5e3,
  txScale: 1,
  apertureTxMm: 26,
  apertureRxMaxMm: 26,
  fNumberRxMin: 2.5,
  k: 1.3,
};

/**
 * σ axial (mm) del pulso de dos vías de la pasada C (≈ 2 ciclos a 3,5 MHz): la gaussiana de
 * `FRAG_AXIAL` tiene σ = max(0,6; AXIAL_SIGMA_MM/dr) muestras. La comparten el renderizador, el gemelo
 * B→C→D de los ecos de interfaz y la anchura del perfil de la cápsula difusa (decisión 64).
 */
export const AXIAL_SIGMA_MM = 0.26;

export function lateralFwhmMm(rMm: number, focusMm: number, p: BeamParams = CONVEX_BEAM): number {
  const r = Math.max(1, rMm);
  const F = Math.max(10, focusMm);
  const tx = p.txScale * Math.hypot((p.k * p.lambdaTxMm * F) / p.apertureTxMm, (p.apertureTxMm * Math.abs(r - F)) / F);
  const dRx = Math.min(p.apertureRxMaxMm, r / p.fNumberRxMin);
  const rx = (p.k * p.lambdaMm * r) / Math.max(1, dRx);
  return 1 / Math.sqrt(1 / (tx * tx) + 1 / (rx * rx));
}

/** σ lateral (mm) de la PSF de dos vías (gaussiana equivalente: FWHM / 2,355). */
export function lateralSigmaMm(rMm: number, focusMm: number, p: BeamParams = CONVEX_BEAM): number {
  return lateralFwhmMm(rMm, focusMm, p) / 2.3548;
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
