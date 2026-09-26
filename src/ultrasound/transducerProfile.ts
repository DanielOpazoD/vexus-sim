import { CONVEX_C35, type Transducer } from '../probe/probe';
import { CONVEX_BEAM, type BeamParams } from './beamModel';
import { COMPOUND, type CompoundParams } from './compound';
import { harmonicBeam } from './harmonic';

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
  // Frecuencia efectiva de penetración de un convexo «3,5 MHz» (banda 2–5 MHz, desplazamiento
  // a bajas por atenuación) [EXTRAPOLACIÓN PROPIA]
  bEffectiveMHz: 2.5,
  dopplerEffectiveMHz: 2.5,
  colorLineSpacingRad: (1.0 * Math.PI) / 180,
  compound: COMPOUND,
};

/**
 * Haz de la imagen B con los ajustes del equipo: el del perfil en fundamental; en armónica (decisión 77), el
 * armónico (`harmonicBeam`). El Doppler (color y PW) usa siempre `profile.beam`.
 */
export function bmodeBeam(profile: TransducerProfile, bmode: { harmonic: boolean }): BeamParams {
  return bmode.harmonic ? harmonicBeam(profile.beam) : profile.beam;
}
