import type { QualityIssue } from './measureQuality';

/** Latidos completos de una captura; compartido sin cargar el algoritmo de medición PW. */
export const CAPTURE_BEATS = 4;

/** Texto para el alumno: qué pasó y cómo corregirlo. Separado del análisis de la señal para cargarlo al armar PW. */
export function qualityText(issue: QualityIssue): string {
  switch (issue) {
    case 'no-signal':
      return 'no medible: no hay flujo en la puerta (¿está sobre el vaso? ¿hay sombra o poco contacto?)';
    case 'intermittent':
      return 'no medible: el flujo no se repite de un latido a otro (el vaso entra y sale de la puerta: pida apnea o agrande la puerta)';
    case 'inconsistent':
      return 'no medible: la onda cambia de un latido a otro (otro vaso entra a ratos en la puerta: recoloque la puerta; si respira, pida apnea)';
    case 'aliasing':
      return 'no medible: aliasing (suba la escala o baje la línea de base)';
    case 'few-beats':
      return 'no medible: pocos latidos (espere 4 latidos completos con la puerta quieta)';
  }
}
