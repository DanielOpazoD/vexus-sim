import { TISSUES, Tissue } from '../anatomy/tissues';
import { CONVEX_C35, type Transducer } from '../probe/probe';
import { CONVEX_BEAM, downshiftPerMm, pulseSigmaMm, type BeamParams } from './beamModel';
import { COMPOUND, type CompoundParams } from './compound';
import { HARMONIC, harmonicBeam } from './harmonic';

/**
 * Perfil completo de un transductor (Fase 1): geometría de la sonda, modelo del haz y las
 * frecuencias efectivas de penetración, en UN solo objeto. Antes estaban repartidos entre
 * `probe.ts`, `beamModel.ts`, dos constantes 2,5 MHz (renderer y simulador), la densidad de
 * líneas de color y un literal «3,5 MHz» en el HUD. Añadir una sonda (lineal, sectorial) es
 * añadir un perfil.
 */
export interface TransducerProfile {
  id: string;
  label: string;
  geometry: Transducer;
  beam: BeamParams;
  /**
   * Imagen B (decisión 84): ancho de banda fraccional a −6 dB del eco de ida y vuelta (el del transductor en
   * fundamental y el del segundo armónico en armónica), que fija cuánto baja la frecuencia central con la
   * profundidad, y la apodización de la emisión (`kTx`, `txConeFraction` de `BeamParams`).
   */
  bmode: { echoBandwidth: { fundamental: number; harmonic: number }; kTx: number; txConeFraction: number };
  /** Frecuencia efectiva a la que se atenúa la imagen B (la banda baja por atenuación), MHz. */
  bEffectiveMHz: number;
  /** Frecuencia efectiva a la que se atenúa la puerta PW, MHz. */
  dopplerEffectiveMHz: number;
  /** Separación angular entre líneas de color (rad). */
  colorLineSpacingRad: number;
  /** Composición espacial (decisión 58): ángulo y orden de las miradas y rampa de cobertura. */
  compound: CompoundParams;
}

export const CONVEX_C35_PROFILE: TransducerProfile = {
  id: 'convex-c35',
  label: 'Convexo 3,5 MHz',
  geometry: CONVEX_C35,
  beam: CONVEX_BEAM,
  bmode: {
    // fundamental: un C5-2 medido centrado en 3,1 MHz con el borde bajo a −6 dB en 2,4 MHz, ±0,7 MHz → 45 % (Deng et
    // al. 2017, IEEE TUFFC 64:164); armónica: el segundo armónico de una emisión en el borde bajo de la banda, que se
    // recibe en su borde alto, más estrecho (el modo armónico pierde resolución axial en maniquí: van Wijk y Thijssen
    // 2002, Ultrasonics 40:585) [EXTRAPOLACIÓN PROPIA]
    echoBandwidth: { fundamental: 0.45, harmonic: 0.35 },
    // apodización de Hann de la emisión (beamModel.ts) [EXTRAPOLACIÓN PROPIA]
    kTx: 2.0,
    txConeFraction: 0.5,
  },
  // Frecuencia efectiva de penetración de un convexo «3,5 MHz» (banda 2–5 MHz, desplazamiento
  // a bajas por atenuación) [EXTRAPOLACIÓN PROPIA]
  bEffectiveMHz: 2.5,
  dopplerEffectiveMHz: 2.5,
  colorLineSpacingRad: (1.0 * Math.PI) / 180,
  compound: COMPOUND,
};

/**
 * Haz de la imagen B con los ajustes del equipo: el del perfil con la emisión apodizada y la bajada de la frecuencia
 * central con la profundidad (decisión 84) en el hígado, el tejido que compensa la TGC nominal; en armónica (decisión
 * 77), el armónico (`harmonicBeam`), cuyo eco baja con su propia banda (y su emisión, a f1, la mitad) y cuyo pulso,
 * de banda más estrecha, es más largo (`pulseSigmaMm`). El Doppler (color y PW) usa siempre `profile.beam`, sin
 * bajada: es de banda estrecha.
 */
export function bmodeBeam(profile: TransducerProfile, bmode: { harmonic: boolean }): BeamParams {
  const { echoBandwidth: bw, kTx, txConeFraction } = profile.bmode;
  const alpha = TISSUES[Tissue.Liver].alpha1;
  if (!bmode.harmonic) {
    const k = downshiftPerMm(bw.fundamental, profile.geometry.f0B / 1e6, alpha);
    return { ...profile.beam, kTx, txConeFraction, downshiftRxPerMm: k, downshiftTxPerMm: k };
  }
  const k = downshiftPerMm(bw.harmonic, HARMONIC.rxMHz, alpha);
  const axialSigma0Mm = pulseSigmaMm(bw.harmonic, bw.fundamental, HARMONIC.rxMHz);
  return { ...harmonicBeam(profile.beam), axialSigma0Mm, kTx, txConeFraction, downshiftRxPerMm: k, downshiftTxPerMm: k / 2 };
}
