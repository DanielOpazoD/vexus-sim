import type { ProbeCompression } from '../anatomy/compression';
import type { AnatomyQuery } from '../anatomy/query';
import type { Tissue } from '../anatomy/tissues';
import type { PhysiologySample } from '../physiology/engine';
import { contactCoupling } from '../probe/contact';
import { pointOnLine, type ProbeFrame, type Transducer } from '../probe/probe';
import { rayTransmission } from '../ultrasound/transmission';

/** Paso de la marcha CPU gruesa hasta la puerta (mm). */
const STEP_MM = 2.5;

/**
 * Transmisión de amplitud de ida y vuelta hasta la puerta PW (0–1): marcha CPU gruesa a la
 * frecuencia Doppler por los tejidos de la línea, multiplicada por el acoplamiento de ESA línea
 * con la piel (el contacto del cuadro, `probe/contact.ts`, decisión 63), igual que el modo B
 * (`T = transmisión · acoplamiento` en la pasada B). Sin el
 * acoplamiento, con la sonda levantada la imagen se apagaba pero el espectro y el audio seguían
 * (antipatrón §23 de la guía: vasos que aparecen con la sonda mal situada).
 */
export function gateTransmission(
  anatomy: AnatomyQuery,
  frame: ProbeFrame,
  transducer: Transducer,
  contact: ProbeCompression,
  theta: number,
  rEndMm: number,
  sample: PhysiologySample,
  dopplerMHz: number,
): number {
  const n = Math.ceil(rEndMm / STEP_MM);
  const tissues: Tissue[] = [];
  for (let i = 0; i < n; i++)
    tissues.push(anatomy.classifyWorld(pointOnLine(frame, transducer, theta, (i + 0.5) * STEP_MM), sample).tissue);
  return rayTransmission(tissues, STEP_MM, dopplerMHz) * contactCoupling(contact, theta);
}

/**
 * Transmisión de ida y vuelta (× acoplamiento) acumulada a lo largo de una línea, por pasos de
 * STEP_MM: `perfil[i]` es la transmisión hasta (i + 1)·STEP_MM. Una sola marcha por línea sirve a
 * todos los candidatos de esa línea (colocación de la puerta con ventana acústica).
 */
export function lineTransmissionProfile(
  anatomy: AnatomyQuery,
  frame: ProbeFrame,
  transducer: Transducer,
  contact: ProbeCompression,
  theta: number,
  maxDepthMm: number,
  sample: PhysiologySample,
  dopplerMHz: number,
): { stepMm: number; profile: number[] } {
  const coupling = contactCoupling(contact, theta);
  const tissues: Tissue[] = [];
  const profile: number[] = [];
  for (let i = 0; (i + 0.5) * STEP_MM <= maxDepthMm + STEP_MM; i++) {
    tissues.push(anatomy.classifyWorld(pointOnLine(frame, transducer, theta, (i + 0.5) * STEP_MM), sample).tissue);
    profile.push(rayTransmission(tissues, STEP_MM, dopplerMHz) * coupling);
  }
  return { stepMm: STEP_MM, profile };
}

/**
 * Peso de ventana acústica para `bestGateOnVessel`: la transmisión real (con acoplamiento) hasta
 * cada candidato, como busca el operador un punto sin sombras. Una marcha por línea (memorizada).
 */
export function acousticWindowWeight(
  anatomy: AnatomyQuery,
  frame: ProbeFrame,
  transducer: Transducer,
  contact: ProbeCompression,
  sample: PhysiologySample,
  maxDepthMm: number,
  dopplerMHz: number,
): (theta: number, r: number) => number {
  const lines = new Map<number, { stepMm: number; profile: number[] }>();
  return (theta, r) => {
    let line = lines.get(theta);
    if (!line) {
      line = lineTransmissionProfile(anatomy, frame, transducer, contact, theta, maxDepthMm, sample, dopplerMHz);
      lines.set(theta, line);
    }
    return line.profile[Math.min(line.profile.length - 1, Math.floor(r / line.stepMm))];
  };
}
