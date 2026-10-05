import type { ObservedPortal } from '../doppler/spectralMeasure';
import { PF_MILD, PF_SEVERE } from '../vexus/classification';

/** Sample variability only: no population interval or guarantee about unrecorded beats. */
export function portalBeatSummary(
  m: Pick<ObservedPortal, 'pulsatilityFraction' | 'beats'> & Partial<Pick<ObservedPortal, 'pulsatilityByBeat'>>,
): string {
  const values = m.pulsatilityByBeat;
  if (!values || values.length !== m.beats || m.beats < 2 || !values.every(Number.isFinite) || !Number.isFinite(m.pulsatilityFraction))
    return '';
  const lo = Math.min(...values),
    hi = Math.max(...values);
  const crossing = [PF_MILD, PF_SEVERE].filter((t) => lo < t && hi >= t);
  return `PF ${m.pulsatilityFraction.toFixed(0)} % · rango entre ${m.beats} latidos ${lo.toFixed(0)}–${hi.toFixed(0)} %${crossing.length ? ` · cruza ${crossing.join('/')} %: ampliar registro` : ''}`;
}
