import type { MeasurementQuality } from './measureQuality';
import { wrongVesselText } from './vesselIdentity';

export const CAPTURE_BEATS = 4;
const RENAL_IDENTITY_REASON = 'domina la arteria y no se identifica la vena con seguridad (ajuste la puerta)';

/** Texto para el alumno: qué pasó y cómo corregirlo. */
export function qualityText(q: Pick<MeasurementQuality, 'issue' | 'wrongVessel' | 'renalArterialDominance'>): string {
  if (!q.renalArterialDominance || q.issue === 'renal-identity') return primaryQualityText(q);
  // An empty inferred venous side does not mean this arterial gate has no flow.
  if (q.issue === null || q.issue === 'no-signal') return primaryQualityText({ issue: 'renal-identity' });
  return `${primaryQualityText(q)}; además, ${RENAL_IDENTITY_REASON}`;
}

function primaryQualityText(q: Pick<MeasurementQuality, 'issue' | 'wrongVessel'>): string {
  switch (q.issue) {
    case null:
      return 'medible';
    case 'wrong-vessel':
      return q.wrongVessel ? wrongVesselText(q.wrongVessel.kind, q.wrongVessel.found) : 'no medible: vaso equivocado (recoloque la puerta)';
    case 'renal-identity':
      return `no medible automáticamente: ${RENAL_IDENTITY_REASON}`;
    case 'no-signal':
      return 'no medible: no hay flujo en la puerta (¿está sobre el vaso? ¿hay sombra o poco contacto? si respira, pida apnea)';
    case 'intermittent':
      return 'no medible: el flujo no se repite de un latido a otro (el vaso entra y sale de la puerta: pida apnea o agrande la puerta)';
    case 'inconsistent':
      return 'no medible: la onda cambia entre latidos (revise la puerta; si respira, pida apnea)';
    case 'aliasing':
      return 'no medible: aliasing (suba la escala y vuelva a capturar)';
    case 'wall-filter':
      return 'no medible: el valle de la onda cae en la banda del filtro de pared (baje el filtro de pared)';
    case 'few-beats':
      return 'no medible: pocos latidos (espere 4 latidos completos con la puerta quieta)';
  }
}
