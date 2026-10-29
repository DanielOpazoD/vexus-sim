import { REFRACTION_BENCH, type RefractionBenchCase } from './refractionBench';

/**
 * El banco de ondas de `refractionBench.ts` con la bilis a temperatura corporal (decisión 293). TISSUES da a la bilis
 * la c del agua a 20 °C (1482 m/s); el agua pura a 37 °C transmite a 1523,7 m/s (ecuación de Marczak 1997, la de la
 * guía del NPL) y los líquidos del cuerpo medidos a esa temperatura, algo más por sus solutos (líquido amniótico
 * 1541,1 m/s y orina 1551,3 m/s; Verma, Humphrey y Duck 2005, Ultrasound Med Biol 31:1375). Sin medida directa de la
 * bilis, 1524 y 1541 m/s son dos escenarios de sensibilidad [EXTRAPOLACIÓN PROPIA], no un intervalo fisiológico; con
 * 1551 m/s el modelo no cumple (decisión 293). Mismos casos, haz y métrica; los vasos no cambian (sus perfiles,
 * los de `REFRACTION_BENCH`, salen idénticos). Generados con
 * `npx tsx tools/fidelity/refraction-wave.ts --bile-c 1524` (y `--bile-c 1541`), redondeados a 0,1 dB.
 */
const BILE_37C: Record<1524 | 1541, Record<string, number[]>> = {
  1524: {
    A: [
      0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -0.1, -0.4, -0.7, -1.0, -1.5, -2.1, -3.0, -4.2, -5.8, -7.1, -7.6, -6.3, -4.3, -2.8, -1.5,
      -0.7, -0.3, -0.1, 0.0, 0.0, 0.0, 0.0, 0.0,
    ],
    B: [
      -0.8, -0.8, -0.8, -0.8, -0.9, -1.1, -1.2, -1.4, -1.6, -1.9, -2.2, -2.6, -3.1, -3.6, -4.3, -5.1, -6.1, -7.3, -7.7, -6.4, -4.6, -3.2,
      -2.2, -1.4, -0.9, -0.5, -0.2, -0.1, 0.0, 0.0, 0.0,
    ],
    F: [
      0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.0, -0.1, -0.3, -0.3, -1.8, -4.6, -8.4, -4.9, -1.7, -1.1, -1.0, -0.4,
      -0.2, -0.1, 0.0, 0.0, 0.0, 0.0, 0.0,
    ],
    G: [
      0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.0, 1.1, 1.1, 1.1, 1.1, 0.9, 0.3, -0.7, -2.2, -4.0, -5.7, -6.1, -6.6, -5.9, -4.1, -2.5, -1.1, -0.3,
      0.0, 0.0, -0.1, 0.0, 0.0, 0.0, 0.0,
    ],
    I: [
      -1.2, -1.2, -1.3, -1.4, -1.5, -1.6, -1.8, -1.9, -2.2, -2.4, -2.8, -3.1, -3.5, -4.0, -4.6, -5.2, -6.0, -7.0, -7.3, -6.1, -4.6, -3.2,
      -2.4, -1.7, -1.1, -0.7, -0.4, -0.2, -0.1, 0.0, 0.0,
    ],
  },
  1541: {
    A: [
      0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.0, -0.2, -0.5, -0.9, -1.6, -2.5, -3.6, -4.7, -5.3, -6.1, -5.4, -4.3, -3.0, -1.7, -0.8,
      -0.3, -0.1, 0.0, 0.0, 0.0, 0.0, 0.0,
    ],
    B: [
      -0.4, -0.4, -0.4, -0.5, -0.5, -0.5, -0.6, -0.8, -1.0, -1.3, -1.6, -2.0, -2.4, -3.0, -3.7, -4.5, -5.3, -6.5, -6.6, -5.4, -4.2, -3.3,
      -2.4, -1.5, -0.9, -0.5, -0.2, -0.1, 0.0, 0.0, 0.0,
    ],
    F: [
      0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.0, -0.1, -0.2, -0.1, -0.5, -2.7, -7.1, -4.4, -1.6, -1.0, -0.9, -0.4,
      -0.2, -0.1, 0.0, 0.0, 0.0, 0.0, 0.0,
    ],
    G: [
      0.7, 0.7, 0.7, 0.7, 0.7, 0.8, 0.8, 0.9, 0.9, 1.0, 1.1, 1.1, 0.9, 0.1, -1.2, -2.5, -3.5, -4.2, -5.8, -5.3, -3.9, -2.7, -1.3, -0.3, 0.0,
      0.0, -0.1, 0.0, 0.0, 0.0, 0.0,
    ],
    I: [
      -0.8, -0.8, -0.8, -0.8, -0.9, -1.0, -1.2, -1.3, -1.6, -1.8, -2.1, -2.5, -2.8, -3.2, -3.7, -4.2, -5.2, -6.4, -6.4, -5.2, -4.0, -3.1,
      -2.5, -1.8, -1.2, -0.8, -0.4, -0.2, -0.1, 0.0, 0.0,
    ],
  },
};

export const BILE_37C_SPEEDS = [1524, 1541] as const;

/** Los nueve casos del banco con la bilis a `bileC` m/s. */
export function refractionBench37(bileC: (typeof BILE_37C_SPEEDS)[number]): RefractionBenchCase[] {
  return REFRACTION_BENCH.map((c) => (c.tissue === 'bile' ? { ...c, db: BILE_37C[bileC][c.id] } : c));
}
