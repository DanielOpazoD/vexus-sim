/**
 * «Puntos de partida» (decisión 17): posiciones cutáneas con ángulos casi neutros hacia
 * las que la sonda se DESLIZA; la ventana diagnóstica hay que afinarla. Los consumen la
 * consola (botones) y el navegador 3D (anillos sobre la piel), que antes los duplicaban.
 * φ en el marco anatómico (0 = izquierda del paciente, π/2 = anterior), z en mm.
 */
export interface StartPoint {
  id: 'subxiphoid' | 'intercostal' | 'flank' | 'renal';
  label: string;
  phi: number;
  z: number;
  yaw: number;
  tilt?: number;
  /** Color del anillo en el navegador 3D. */
  color: string;
  hint: string;
}

export const START_POINTS: readonly StartPoint[] = [
  {
    id: 'subxiphoid',
    color: '#7ce8a0',
    label: 'Subxifoideo',
    phi: Math.PI / 2,
    z: -20,
    yaw: 0,
    tilt: 0.45,
    hint: 'Bajo el xifoides, haz inclinado hacia la cabeza: VCI en eje largo y confluencia de suprahepáticas a 15–19 cm; rotar y abanicar hacia la derecha del paciente.',
  },
  {
    id: 'intercostal',
    color: '#ffc857',
    label: 'Intercostal dcho',
    phi: Math.PI * 0.88,
    z: 8,
    yaw: 0.35,
    hint: 'Suprahepáticas y porta: marcador hacia la axila, deslizar por el espacio intercostal.',
  },
  {
    id: 'flank',
    color: '#5cc8ff',
    label: 'Flanco · VCI',
    phi: Math.PI * 1.02,
    z: -20,
    yaw: 0,
    hint: 'VCI transhepática coronal: marcador craneal, abanicar medialmente.',
  },
  {
    id: 'renal',
    color: '#f28cb1',
    label: 'Renal',
    phi: Math.PI * 1.12,
    z: -80,
    yaw: 0,
    tilt: -0.5,
    hint: 'Riñón derecho por el flanco (línea axilar posterior): hígado como ventana, seno ecogénico y pirámides; puerta PW en un vaso interlobar.',
  },
];
