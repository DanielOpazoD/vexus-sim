import { VESSEL_META, type VesselId, type VesselSystem } from '../physiology/vessels';
import type { GateComposition } from './sampleVolume';

/**
 * Identidad del vaso de la puerta (decisión 94). La fila del protocolo dice qué vaso se mide y la medición lee su onda
 * con las reglas de ESE vaso (S/D de la suprahepática, PF de la porta, continuidad de la interlobar): medida sobre otro
 * vaso, una porta daba «leve (S<D)» en la fila de la suprahepática, una suprahepática «PF 117 %, grave» en la de la
 * porta y «bifásico» en la renal, todo con el visto bueno de la calidad. Un equipo no sabe qué vaso hay bajo la
 * puerta; el simulador sí (la sangre del volumen de muestra, la misma que forma el espectro) y lo usa como lo haría el
 * supervisor junto al alumno: la captura se rechaza con un mensaje formativo y no entra en el grado.
 */
export type ProtocolVessel = 'hepatic' | 'portal' | 'renal';

/** Sistemas que valen para cada fila: la interlobar comparte la puerta con su arteria (la medición elige la vena). */
const EXPECTED: Record<ProtocolVessel, readonly VesselSystem[]> = {
  hepatic: ['hepaticVein'],
  portal: ['portal'],
  renal: ['interlobarVein', 'interlobarArtery'],
};

/** Nombre del sistema para el alumno, con su artículo. */
export const VESSEL_SYSTEM_TEXT: Record<VesselSystem, string> = {
  ivc: 'la VCI',
  hepaticVein: 'una suprahepática',
  portal: 'la porta',
  hepaticArtery: 'la arteria hepática',
  aorta: 'la aorta',
  visceralArtery: 'una rama visceral de la aorta',
  renalArtery: 'la arteria renal',
  renalVein: 'la vena renal',
  interlobarArtery: 'una arteria interlobar',
  interlobarVein: 'una vena interlobar',
};

/** Una muestra de la composición del volumen de muestra: peso de sangre de cada vaso (fracción del peso del haz). */
export interface GateVesselSample {
  t: number;
  vessels: GateComposition['vessels'];
}

/**
 * Peso de sangre acumulado por debajo del cual la puerta no ve ningún vaso (media < 1 % del peso del haz): eso lo
 * juzga la calidad («no hay flujo»), no la identidad.
 */
const MIN_MEAN_BLOOD = 0.01;

/**
 * Sistema vascular que domina la sangre de la puerta en [t0, t1] (suma de los pesos de sangre de cada muestra), o
 * null si la puerta apenas ve sangre.
 */
export function dominantGateSystem(track: readonly GateVesselSample[], t0: number, t1: number): VesselSystem | null {
  const bySystem = new Map<VesselSystem, number>();
  let n = 0;
  let total = 0;
  for (const s of track) {
    if (s.t < t0 || s.t > t1) continue;
    n++;
    for (const [id, w] of Object.entries(s.vessels) as [VesselId, number][]) {
      const sys = VESSEL_META[id].system;
      bySystem.set(sys, (bySystem.get(sys) ?? 0) + w);
      total += w;
    }
  }
  if (n === 0 || total / n < MIN_MEAN_BLOOD) return null;
  let best: VesselSystem | null = null;
  for (const [sys, w] of bySystem) if (best === null || w > bySystem.get(best)!) best = sys;
  return best;
}

/**
 * Vaso equivocado: el sistema que domina la puerta durante la captura si no es el de la fila; null si es el correcto
 * o si la puerta no ve sangre (la calidad dirá por qué).
 */
export function wrongGateVessel(kind: ProtocolVessel, track: readonly GateVesselSample[], t0: number, t1: number): VesselSystem | null {
  const found = dominantGateSystem(track, t0, t1);
  return found !== null && !EXPECTED[kind].includes(found) ? found : null;
}

/** Texto para el alumno: dónde está la puerta y qué mide la fila. */
export function wrongVesselText(kind: ProtocolVessel, found: VesselSystem): string {
  // El primer sistema es el vaso venoso del protocolo; los siguientes son
  // acompañantes admitidos en la puerta. Compartir esta definición evita que
  // el mensaje y la validación discrepen al modificar el protocolo.
  return `no medible: vaso equivocado, la puerta está en ${VESSEL_SYSTEM_TEXT[found]} (esta fila mide ${VESSEL_SYSTEM_TEXT[EXPECTED[kind][0]]}: recoloque la puerta)`;
}
