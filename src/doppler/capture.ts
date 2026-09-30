export { qualityText } from './qualityMessages';
import type { Beat } from '../physiology/rhythm';
import { CAPTURE_BEATS } from './measureQuality';
import type { SpectralColumn } from './spectral';
import {
  measureObservedHepatic,
  measureObservedPortal,
  measureObservedRenal,
  type MeasureOptions,
  type ObservedHepatic,
  type ObservedPortal,
  type ObservedRenal,
} from './spectralMeasure';
import { wrongGateVessel, type GateVesselSample, type ProtocolVessel } from './vesselIdentity';

/** Segundos de espectro que toma una captura (los que guarda el equipo a la vista). */
const CAPTURE_SECONDS = 7;
/**
 * Tras un cambio de escala (PRF) el filtro de pared cambia de coeficientes con el clutter del tejido 40–60 dB sobre la
 * sangre dentro: su transitorio es una línea vertical de banda ancha. La captura descarta esta cola (≈ 5 constantes de
 * tiempo del filtro a 25 Hz), como el equipo que borra el espectro al cambiar la escala.
 */
export const WALL_SETTLE_S = 0.1;

/**
 * Columnas de la captura: las de los últimos CAPTURE_SECONDS con la PRF actual, sin el transitorio del filtro de pared
 * tras el cambio (decisión 94). Con columnas de dos escalas la banda, el suelo y el aliasing se juzgaban mezclados.
 */
export function captureColumns(spectrum: readonly SpectralColumn[], t0: number): SpectralColumn[] {
  if (!spectrum.length) return [];
  const prf = spectrum[spectrum.length - 1].prfHz;
  let first = spectrum.length - 1;
  while (first > 0 && spectrum[first - 1].prfHz === prf) first--;
  const tStart = Math.max(t0, first > 0 ? spectrum[first].t + WALL_SETTLE_S : -Infinity);
  return spectrum.slice(first).filter((c) => c.t > tStart);
}

export interface CaptureResult {
  hepatic: ObservedHepatic;
  portal: ObservedPortal;
  renal: ObservedRenal;
}

/**
 * «Capturar» de la pestaña Medir (decisión 94): la ÚNICA ruta de una captura, la de la aplicación y la de la cadena del
 * alumno en las pruebas. Toma los últimos CAPTURE_BEATS latidos completos de los últimos CAPTURE_SECONDS de espectro,
 * mide con las reglas del vaso de la fila y, si la sangre de la puerta era de otro vaso durante la captura, la
 * rechaza como «vaso equivocado» (antes que cualquier otro motivo: su onda no dice nada del vaso de la fila).
 */
export function captureProtocolVessel<K extends ProtocolVessel>(
  kind: K,
  spectrum: readonly SpectralColumn[],
  rhythm: { beatsBetween(t0: number, t1: number): Beat[] },
  tNow: number,
  opts: MeasureOptions,
  gateTrack: readonly GateVesselSample[],
): CaptureResult[K] | null {
  const t0 = tNow - CAPTURE_SECONDS;
  const beats = rhythm.beatsBetween(t0, tNow).slice(-CAPTURE_BEATS);
  const columns = captureColumns(spectrum, t0);
  const measure = kind === 'hepatic' ? measureObservedHepatic : kind === 'portal' ? measureObservedPortal : measureObservedRenal;
  const m = measure(columns, beats, opts) as CaptureResult[K] | null;
  if (!m) return null;
  // la identidad se juzga en los latidos medidos, no en los 7 s: la puerta pudo estar antes en otro vaso
  const last = beats[beats.length - 1];
  const found = beats.length
    ? wrongGateVessel(kind, gateTrack, beats[0].tR, last.tR + last.rr)
    : wrongGateVessel(kind, gateTrack, t0, tNow);
  if (found === null) return m;
  return { ...m, quality: { ...m.quality, issue: 'wrong-vessel', wrongVessel: { kind, found } } };
}
