import type { ObservedHepatic, ObservedPortal, ObservedRenal } from '../doppler/spectralMeasure';
import type { MeasurementQuality } from '../doppler/measureQuality';

type SummaryObservation = {
  quality: Pick<MeasurementQuality, 'issue'>;
  beats: number;
  anterogradeSign: number;
} & (
  | Pick<ObservedHepatic, 'kind' | 'sPeak' | 'dPeak' | 'aPeak'>
  | Pick<ObservedPortal, 'kind' | 'vMax' | 'vMin'>
  | Pick<ObservedRenal, 'kind' | 'sPeak' | 'dPeak' | 'vMin'>
);

/** Observed beat medians, with the same screen sign as the spectral marks.
 * No values are published from an acquisition rejected by its quality gate.
 */
export function observedVelocitySummary(m: SummaryObservation | null, invert = false): string {
  if (!m || m.quality.issue !== null || m.beats < 1 || Math.abs(m.anterogradeSign) !== 1) return '';
  const value = (v: number): string => {
    if (!Number.isFinite(v)) return '—';
    const rounded = Number((v * m.anterogradeSign * (invert ? -1 : 1)).toFixed(1));
    return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
  };
  const waves =
    m.kind === 'hepatic'
      ? `S ${value(m.sPeak)} · D ${value(m.dPeak)} · A ${value(m.aPeak)}`
      : m.kind === 'portal'
        ? `Vmáx ${value(m.vMax)} · Vmín ${value(m.vMin)}`
        : `máx. sist. ${value(m.sPeak)} · diást. ${value(m.dPeak)} · mín ${value(m.vMin)}`;
  return `${waves} cm/s · mediana ${m.beats} lat.`;
}
