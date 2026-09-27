/**
 * Referencias del banco de ondas de la refracción en las luces (decisión 86): el eco de moteado de la imagen B (∫I_tx·I_rx,
 * dB frente a sin la luz) tras una luz circular de radio `a` centrada a `z0` mm, en la muestra a `behind` mm bajo su
 * pared honda, en función de la distancia lateral `x` (mm) a su eje. Óptica de ondas 2D en geometría plana, 3,5 MHz,
 * emisión de 26 mm con ventana de Hann y foco `focus`, recepción uniforme de min(26, r/2,5) mm con foco dinámico; la bilis
 * y la sangre con la c de TISSUES. Generadas con `npx tsx tools/fidelity/refraction-wave.ts` (redondeadas a 0,1 dB).
 */
export interface RefractionBenchCase {
  id: string;
  tissue: 'bile' | 'blood';
  a: number;
  z0: number;
  behind: number;
  focus: number;
  /** Paso de 0,8 mm desde el eje. */
  db: number[];
}

export const REFRACTION_BENCH: RefractionBenchCase[] = [
  {
    id: 'A',
    tissue: 'bile',
    a: 14.5,
    z0: 60,
    behind: 20,
    focus: 90,
    db: [
      -0.6, -0.6, -0.6, -0.6, -0.7, -0.8, -0.9, -1.1, -1.4, -1.7, -2.1, -2.5, -3.1, -3.8, -4.7, -5.9, -7.2, -8.3, -8.4, -6.4, -4.4, -2.7,
      -1.5, -0.7, -0.3, -0.1, 0.0, 0.0, 0.0, 0.0, 0.0,
    ],
  },
  {
    id: 'B',
    tissue: 'bile',
    a: 14.5,
    z0: 60,
    behind: 40,
    focus: 90,
    db: [
      -2.0, -2.0, -2.1, -2.2, -2.3, -2.5, -2.6, -2.8, -3.1, -3.4, -3.8, -4.2, -4.7, -5.4, -6.2, -7.1, -8.3, -9.2, -8.7, -6.7, -4.8, -3.3,
      -2.3, -1.4, -0.9, -0.5, -0.2, -0.1, 0.0, 0.0, 0.0,
    ],
  },
  {
    id: 'C',
    tissue: 'blood',
    a: 10,
    z0: 90,
    behind: 20,
    focus: 90,
    db: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.0, -0.3, -0.5, -0.5, -0.3, -0.1, -0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  },
  {
    id: 'D',
    tissue: 'blood',
    a: 10,
    z0: 90,
    behind: 40,
    focus: 90,
    db: [
      0.0, 0.0, 0.1, 0.1, 0.1, 0.1, 0.1, 0.0, 0.0, 0.0, 0.0, -0.1, -0.3, -0.4, -0.4, -0.2, -0.1, -0.1, -0.1, -0.1, 0.0, 0.0, 0.0, 0.0, 0.0,
    ],
  },
  {
    id: 'E',
    tissue: 'blood',
    a: 5,
    z0: 70,
    behind: 20,
    focus: 90,
    db: [0.2, 0.2, 0.2, 0.1, 0.1, -0.1, -0.2, -0.2, -0.3, -0.2, -0.1, -0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  },
  {
    id: 'F',
    tissue: 'bile',
    a: 14.5,
    z0: 60,
    behind: 20,
    focus: 50,
    db: [
      0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.0, -0.1, -0.2, -0.4, -0.5, -1.3, -3.2, -6.5, -8.7, -4.9, -1.8, -1.2, -1.0, -0.4,
      -0.2, -0.1, 0.0, 0.0, 0.0, 0.0, 0.0,
    ],
  },
  {
    id: 'G',
    tissue: 'bile',
    a: 14.5,
    z0: 60,
    behind: 20,
    focus: 150,
    db: [
      1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.9, 0.8, 0.6, 0.3, -0.2, -0.9, -1.8, -2.8, -4.0, -5.2, -6.1, -6.8, -7.2, -5.7, -4.1, -2.5, -1.1, -0.2,
      0.0, 0.0, -0.1, 0.0, 0.0, 0.0, 0.0,
    ],
  },
  {
    id: 'H',
    tissue: 'blood',
    a: 15,
    z0: 80,
    behind: 30,
    focus: 90,
    db: [
      0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.1, 0.1, 0.0, 0.0, -0.1, -0.2, -0.2, -0.3, -0.4, -0.4, -0.3, -0.2, -0.2, -0.2,
      -0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    ],
  },
  {
    id: 'I',
    tissue: 'bile',
    a: 14.5,
    z0: 60,
    behind: 60,
    focus: 90,
    db: [
      -2.6, -2.6, -2.6, -2.7, -2.8, -3.0, -3.1, -3.4, -3.6, -3.9, -4.3, -4.7, -5.2, -5.8, -6.6, -7.5, -8.4, -9.2, -8.4, -6.7, -4.8, -3.4,
      -2.4, -1.7, -1.1, -0.7, -0.4, -0.2, -0.1, 0.0, 0.0,
    ],
  },
];
