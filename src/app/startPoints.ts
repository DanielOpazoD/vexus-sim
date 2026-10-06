import type { Torso } from '../anatomy/primitives';
/**
 * «Puntos de partida» (decisión 17): posiciones cutáneas con los ángulos de partida de cada
 * ventana, hacia las que la sonda se DESLIZA; la ventana diagnóstica hay que afinarla (en la
 * subcostal de la decisión 83 el margen es estrecho: moverla 1 cm, o girarla o abanicarla 5°,
 * pierde la VSH media en eje largo). Los consumen el carril (tarjetas, decisión 75) y el
 * navegador 3D (anillos sobre la piel). φ en el marco anatómico (0 = izquierda del paciente,
 * π/2 = anterior), z en mm.
 */
export interface StartPoint {
  id: 'subxiphoid' | 'epigastric' | 'intercostal' | 'subcostal' | 'flank' | 'portal' | 'portalTrunk' | 'renal' | 'hepatorenal';
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
    label: 'Subcostal · VCI longitudinal',
    // Paramediana derecha (x ≈ −32 mm en la piel): la normal cutánea de la elipse
    // converge hacia la línea media, así el plano sagital cruza la VCI (x −22) en
    // profundidad. El haz se bascula hacia la cabeza (rock), no se abanica.
    phi: Math.PI / 2 + 0.2,
    z: -20,
    yaw: 0,
    rock: 0.45,
    hint: 'Subxifoidea, marcador craneal: VCI por el hígado hasta la AD. Bascula hacia la cabeza y afina hacia la derecha.',
  },
  {
    id: 'epigastric',
    color: '#ff9470',
    label: 'Epigástrico',
    // Transversa epigástrica (decisión 83): línea media 2 cm bajo la punta del xifoides, marcador a la derecha del
    // paciente (a la izquierda de la pantalla) y haz perpendicular. La VCI retrohepática oval a la izquierda con el
    // hígado (caudado y ligamento venoso) delante, la aorta redonda a la derecha del centro apoyada en la vértebra y el
    // cuerpo vertebral centrado en la base con su sombra; el cartílago del reborde costal derecho asoma en la esquina
    // del campo cercano. Deslizando hacia los pies salen de la cara anterior de la aorta el celíaco (1 cm) y la AMS
    // (2,4 cm); abanicando el haz 26° hacia la cabeza la derecha y la media llegan a la VCI y la izquierda se acerca,
    // cortadas de través (el «conejo» entero pide más de los 40° que bascula la sonda: `probe-angle-40deg`).
    phi: Math.PI / 2,
    z: -20,
    yaw: -Math.PI / 2,
    hint: 'Transversa en el epigastrio, bajo el xifoides en la línea media, marcador a la derecha del paciente: vértebra con su sombra al fondo, aorta redonda justo delante y VCI oval a su lado con hígado delante; deslizar hacia los pies para el celíaco y la AMS y abanicar hacia la cabeza para ver llegar las suprahepáticas a la VCI.',
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
    id: 'subcostal',
    color: '#b4e36a',
    label: 'Subcostal · VSH',
    // Suprahepática subxifoidea en su variante sagital (la VCI con la VSH media), desde debajo del reborde costal derecho
    // (decisión 83): 5,5 cm bajo el xifoides y 1,7 cm a la derecha de la línea media; marcador craneal girado 23° hacia
    // la izquierda del paciente, basculado 14° y abanicado 23° hacia la derecha: el haz va 21° hacia la cabeza y 13°
    // hacia la derecha. La VSH media recorre el plano ~5 cm hasta el tronco común y la VCI; la derecha desemboca a su lado
    // en un tramo corto; más allá, la VCI entera y la aurícula derecha, que apoya en la cúpula (decisión 85: antes quedaban
    // tras el pulmón que había sobre ella). A 1–2 cm de la VCI la VSH media queda a 32° del haz en espiración (47° en la
    // inspiración tranquila; 40° y 47° antes de que se curvara en este plano, decisión 90): la puerta PW del protocolo, que la
    // cadena del alumno mide en examChain.test.ts. Desde la punta del xifoides el haz no llega a la dirección de la VSH media
    // con la basculación máxima (40°): la corta de través, con las suprahepáticas junto a la VCI (el «conejo»
    // incompleto que se ve abanicando la epigástrica hacia la cabeza).
    phi: 1.68,
    z: -55,
    yaw: 0.4,
    rock: 0.25,
    tilt: -0.398,
    hint: 'Suprahepática media por debajo del reborde costal derecho, 5 cm bajo el xifoides: marcador craneal algo girado hacia la izquierda del paciente, haz basculado hacia la cabeza y abanicado hacia la derecha del paciente; la VSH media baja hasta el tronco común y la VCI, con la derecha desembocando a su lado; puerta PW en la VSH media a 1–2 cm de la VCI.',
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
    label: 'Porta · intrahepática',
    // Decisión 168: rama derecha e hilio rodeados de hígado. No prolongar el tronco extrahepático
    // en esta adquisición ni confundir la rama con el sitio de medición VExUS. Poses estimadas por rayos.
    phi: 3.5,
    z: -90,
    yaw: 0.7,
    rock: 0.2,
    tilt: -0.4,
    hint: 'Rama portal derecha dentro del hígado desde lateral. Seleccionarla aplica ajuste abdominal: 15 cm, foco 10 cm, color ±35 cm/s y ganancia 12 dB; afina caja y controles. Para medir VExUS, busca el tronco principal.',
  },
  {
    id: 'portalTrunk',
    color: '#b49ad9',
    label: 'Porta · tronco PW',
    // Tronco principal para la puerta del protocolo, lejos de la bifurcación; geometría conservada.
    phi: 3.466,
    z: -66,
    yaw: 0.08,
    rock: -0.3,
    tilt: -0.2,
    hint: 'Tronco principal para VExUS. Ajusta ángulo y escala; puerta PW lejos de la bifurcación y la arteria.',
  },
  {
    id: 'renal',
    color: '#f28cb1',
    label: 'Renal',
    // Línea axilar posterior, plano coronal-oblicuo que contiene el eje largo del riñón
    // (barrido de poses: ≈ 10 cm de riñón en el plano con seno y pirámides).
    // Decisión 166: 5 mm caudal al punto previo, que ahora queda bajo la 11.ª costilla.
    // Se ajusta la adquisición; el riñón, los vasos y el esqueleto conservan su posición.
    phi: Math.PI * 1.18,
    z: -90,
    yaw: -0.3,
    tilt: -0.4,
    hint: 'Riñón derecho en eje largo por el flanco (línea axilar posterior): hígado como ventana, cápsula, corteza, pirámides y seno ecogénico (la pelvis, colapsada; la vena renal sale por el hilio); puerta PW en un vaso interlobar.',
  },
  {
    id: 'hepatorenal',
    label: 'Hepatorrenal',
    color: '#e8bf79',
    phi: 3.2,
    z: -80,
    yaw: -0.1,
    tilt: -0.4,
    rock: 0.1,
    hint: 'Hígado y riñón derecho en eje largo: compara parénquima hepático y corteza renal a igual profundidad, sin incluir vasos, pirámides ni seno. Afina el espacio intercostal para despejar sombras.',
  },
];

/** Offline landmark/ray calibration of the shared BodyParts3D-derived torso; see REFERENCE_TORSO.md. */
const REFERENCE_POSES = {
  hepatorenal: { phi: 3.2, z: -80, yaw: 0, tilt: -0.4, rock: -0.2 },
  subxiphoid: {
    phi: 1.65,
    z: -15,
    yaw: 0.02476,
    rock: 0.591491,
    tilt: -0.055956,
  },
  epigastric: {
    phi: 1.55,
    z: -35,
    yaw: -1.606158,
    rock: 0.198376,
    tilt: 0.266738,
  },
  intercostal: {
    phi: 3.0,
    z: -50,
    yaw: 0.991606,
    rock: 0.326097,
    tilt: -0.445188,
  },
  subcostal: {
    phi: 1.65,
    z: -60,
    yaw: 0.697698,
    rock: 0.323154,
    tilt: -0.502037,
  },
  flank: {
    phi: 3.0,
    z: -20,
    yaw: -0.041424,
    rock: 0.142559,
    tilt: 0.166586,
  },
  portal: {
    phi: 3.5,
    z: -60,
    yaw: 1.1,
    rock: -0.2,
    tilt: 0.2,
  },
  portalTrunk: {
    phi: 3.3,
    z: -55,
    yaw: 0.107927,
    rock: -0.309003,
    tilt: 0.133669,
  },
  renal: {
    // Registered renal axis (177): aim through the real flank, not the former anterior kidney.
    phi: 3.35,
    z: -75,
    yaw: -0.175994,
    rock: -0.218131,
    tilt: -0.41084,
  },
} satisfies Record<StartPoint['id'], Pick<StartPoint, 'phi' | 'z' | 'yaw' | 'rock' | 'tilt'>>;
const REFERENCE_POINTS: readonly StartPoint[] = START_POINTS.map((sp) => ({
  ...sp,
  ...REFERENCE_POSES[sp.id],
  hint:
    sp.id === 'intercostal'
      ? 'Ventana intercostal derecha del adulto de referencia: marcador oblicuo hacia la axila; afinar entre las superficies costales para ver la VSH derecha.'
      : sp.id === 'renal'
        ? 'Ventana renal derecha del adulto de referencia: desde el flanco, afinar el eje largo y colocar la puerta en una vena interlobar visible.'
        : sp.hint,
}));
/** Scene-specific presets; legacy tests/torso retain their own poses. */
export function startPointsFor(torso: Pick<Torso, 'a' | 'b' | 'profile'>): readonly StartPoint[] {
  return torso.profile ? REFERENCE_POINTS : START_POINTS;
}
