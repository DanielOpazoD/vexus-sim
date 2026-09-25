/**
 * «Puntos de partida» (decisión 17): posiciones cutáneas con ángulos casi neutros hacia
 * las que la sonda se DESLIZA; la ventana diagnóstica hay que afinarla. Los consumen la
 * consola (botones) y el navegador 3D (anillos sobre la piel), que antes los duplicaban.
 * φ en el marco anatómico (0 = izquierda del paciente, π/2 = anterior), z en mm.
 */
export interface StartPoint {
  id: 'subxiphoid' | 'intercostal' | 'flank' | 'portal' | 'renal';
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
    // 8.º espacio intercostal (entre la 8.ª y la 9.ª costillas) en la línea axilar media, con la sonda a lo largo
    // del espacio (las costillas suben hacia atrás), el marcador hacia la axila y sin basculación: ninguna
    // costilla entra en el sector en toda su profundidad (quedan a ~14 mm a cada lado del plano; girar la sonda
    // 2° mete la 9.ª en un borde) y la vértebra asoma al fondo. Las suprahepáticas derecha y media y la VCI se ven
    // por el hígado; la cortina pulmonar entra por el lado craneal (4 de 61 líneas en espiración, 13 en el máximo
    // de la respiración tranquila y 39 en inspiración profunda). Con la sonda que solo empuja (decisión 63) apoyan
    // las líneas de ±21° (122 de 192, con la presión máxima sobre costillas, 16 mm): en la sección la pared
    // lateral del tórax tiene 69 mm de radio y la pared de los bordes no queda paralela a la cara ni hundiendo la
    // sonda 50 mm. La alternativa coronal (marcador craneal) entre dos costillas en la axilar media apoya entera
    // pero cruza 3–5 costillas (a 17–22 mm en z, el sector abarca ±47 mm a su profundidad; una casi en el centro),
    // deja 44–59 líneas de hígado frente a 122 y solo abanicada hacia atrás (la del flanco, algo más alta) da un
    // ángulo Doppler ≤ 50° (decisión 63). Con las costillas óseas (decisión 62) la pose de antes (φ 0,88π, z 8,
    // yaw 0,35, casi craneocaudal) cruzaba seis costillas y dejaba seis sombras; a lo largo del 7.º espacio
    // (φ 0,94π, z 19) la cortina tapaba en espiración medio sector, las suprahepáticas incluidas (decisión 61).
    phi: Math.PI,
    z: 0,
    yaw: -1.15,
    hint: 'Suprahepáticas y VCI por el 8.º espacio intercostal en la línea axilar media: la sonda a lo largo del espacio, marcador hacia la axila, sin costillas en el sector (los bordes, sobre el tórax curvo, no apoyan); la cortina pulmonar entra por el lado craneal y baja con la inspiración.',
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
    id: 'portal',
    color: '#c08cff',
    label: 'Porta · lateral',
    // Ventana preferida de la porta en VExUS (Beaubien-Souligny 2018; Koratala 2024): lateral derecha, entre la axilar
    // media y la posterior, más caudal que la de las suprahepáticas; plano coronal oblicuo con el haz algo hacia atrás y
    // abajo. La porta principal queda en el centro del sector a < 60° del haz (48 de 48 muestras en la búsqueda de poses)
    // y corre craneocaudal, así que la respiración la desliza por su eje; la VCI por detrás (decisión 69: el tronco
    // portal pasa por delante de la VCI y el plano del flanco, que va a la VCI, ya no lo corta). Pendiente: con el hígado
    // de 12,3 cm craneocaudales del modelo (normal 14 ± 1,7) el lóbulo derecho no llega a este nivel y el campo cercano es
    // el «resto» en lugar de hígado; al corregir su tamaño la ventana será transhepática.
    phi: 3.466,
    z: -66,
    yaw: 0.08,
    rock: -0.3,
    tilt: -0.2,
    hint: 'Porta principal por la línea axilar media–posterior, más caudal que la ventana de las suprahepáticas: marcador craneal, haz algo hacia atrás; la porta roja de paredes brillantes en el centro con la VCI por detrás; puerta PW en la porta principal.',
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
