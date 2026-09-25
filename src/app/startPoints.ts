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
  /** Basculación dentro del plano (talón-punta), + = haz hacia la cabeza. */
  rock?: number;
  /** Inclinación fuera del plano (abanicar). */
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
    // Paramediana derecha (x ≈ −32 mm en la piel): la normal cutánea de la elipse
    // converge hacia la línea media, así el plano sagital cruza la VCI (x −22) en
    // profundidad. El haz se bascula hacia la cabeza (rock), no se abanica.
    phi: Math.PI / 2 + 0.2,
    z: -20,
    yaw: 0,
    rock: 0.45,
    hint: 'Bajo el xifoides, paramediano derecho, haz basculado hacia la cabeza: VCI en eje largo hasta la aurícula derecha a 10–14 cm; abanicar suavemente hacia la derecha del paciente.',
  },
  {
    id: 'intercostal',
    color: '#ffc857',
    label: 'Intercostal dcho',
    // 8.º espacio intercostal en la línea axilar media, con la sonda a lo largo del espacio (las costillas suben
    // hacia atrás), el marcador hacia la axila y 11° de basculación talón-punta: una costilla asoma en un borde
    // con su cortical y su sombra, y el resto del sector es hígado con las suprahepáticas derecha y media y
    // la VCI, despejadas de la cortina pulmonar con la respiración tranquila (que baja hasta ellas en inspiración
    // profunda). Con las costillas óseas (decisión 62) la pose de antes (φ 0,88π, z 8, yaw 0,35, casi
    // craneocaudal) cruzaba seis costillas y dejaba seis sombras; a lo largo del 7.º espacio (φ 0,94π, z 19) la
    // cortina tapaba en espiración medio sector, las suprahepáticas incluidas (decisión 61).
    phi: Math.PI * 0.98,
    z: 3,
    yaw: -1.25,
    rock: 0.2,
    hint: 'Suprahepáticas y VCI por el 8.º espacio intercostal en la línea axilar media: la sonda a lo largo del espacio, marcador hacia la axila; una costilla asoma en el borde con su sombra y la cortina pulmonar baja con la inspiración.',
  },
  {
    id: 'flank',
    color: '#5cc8ff',
    label: 'Flanco · VCI',
    // Línea axilar media; el haz se abanica un poco hacia atrás (tilt −0,2) para
    // que el plano coronal pase por la VCI (y −16) y no delante de ella.
    phi: Math.PI * 1.04,
    z: -20,
    yaw: 0,
    tilt: -0.2,
    hint: 'VCI transhepática coronal por la línea axilar media: marcador craneal, abanicar hacia atrás hasta la VCI con las suprahepáticas desembocando en ella.',
  },
  {
    id: 'renal',
    color: '#f28cb1',
    label: 'Renal',
    // Línea axilar posterior, plano coronal-oblicuo que contiene el eje largo del riñón
    // (barrido de poses: ≈ 10 cm de riñón en el plano con seno y pirámides)
    phi: Math.PI * 1.18,
    z: -85,
    yaw: -0.3,
    tilt: -0.4,
    hint: 'Riñón derecho en eje largo por el flanco (línea axilar posterior): hígado como ventana, cápsula, corteza, pirámides y seno con la pelvis; puerta PW en un vaso interlobar.',
  },
];
