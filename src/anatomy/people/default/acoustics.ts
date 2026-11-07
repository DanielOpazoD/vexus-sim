import { Interface } from '../../interfaces';
import type { BmodeAcoustics } from '../../person';
import { Tissue } from '../../tissues';

/** NEEDS_CALIBRATION: contraste y pendiente estimados, revisados en las diez ventanas.
 * Conserva el hígado como referencia y la grasa por debajo del seno renal.
 * Sólo current: legacy y s0028 mantienen sus coeficientes anteriores.
 * El lóbulo capsular más ancho redistribuye energía angular; no añade un contorno.
 */
export const DEFAULT_BMODE_ACOUSTICS: BmodeAcoustics = Object.freeze({
  backscatter: Object.freeze({
    [Tissue.PerirenalFat]: 2.6,
    [Tissue.RetroperitonealFat]: 2.6,
    [Tissue.Psoas]: 0.22,
    [Tissue.QuadratusLumborum]: 0.22,
  }),
  interfaceSlopeRms: Object.freeze({ [Interface.LiverCapsule]: 0.3 }),
});
