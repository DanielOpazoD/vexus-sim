import type { AnatomyQuery } from '../anatomy/query';
import type { Tissue } from '../anatomy/tissues';
import type { PhysiologySample } from '../physiology/engine';
import { lineCoupling, pointOnLine, type ProbeFrame, type ProbePose, type Transducer } from '../probe/probe';
import { rayTransmission } from '../ultrasound/transmission';

/** Paso de la marcha CPU gruesa hasta la puerta (mm). */
const STEP_MM = 2.5;

/**
 * Transmisión de amplitud de ida y vuelta hasta la puerta PW (0–1): marcha CPU gruesa a la
 * frecuencia Doppler por los tejidos de la línea, multiplicada por el acoplamiento de ESA línea
 * con la piel, igual que el modo B (`T = transmisión · acoplamiento` en la pasada B). Sin el
 * acoplamiento, con la sonda levantada la imagen se apagaba pero el espectro y el audio seguían
 * (antipatrón §23 de la guía: vasos que aparecen con la sonda mal situada).
 */
export function gateTransmission(
  anatomy: AnatomyQuery,
  frame: ProbeFrame,
  transducer: Transducer,
  pose: ProbePose,
  theta: number,
  rEndMm: number,
  sample: PhysiologySample,
  dopplerMHz: number,
): number {
  const n = Math.ceil(rEndMm / STEP_MM);
  const tissues: Tissue[] = [];
  for (let i = 0; i < n; i++)
    tissues.push(anatomy.classifyWorld(pointOnLine(frame, transducer, theta, (i + 0.5) * STEP_MM), sample).tissue);
  return rayTransmission(tissues, STEP_MM, dopplerMHz) * lineCoupling(pose, transducer, theta);
}
