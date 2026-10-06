import { registerAbdominalVessels } from './abdominalVessels';
import { SeededRandom } from '../core/random';
import { add, cross, dist, normalize, rotateAxis, scale, sub, type Vec3 } from '../core/vec3';
import { VESSEL_META, type CaliberLaw, type VesselId } from '../physiology/vessels';
import { BERTIN_COLUMNS_U, kidneyWorld, type Kidney } from './organs/kidney';
import { tubeShapeMaxFactor, type Tube, type TubeShapeClass } from './primitives';
import { Tissue } from './tissues';

/**
 * Vasos que llevan las puertas PW del protocolo en la cadena del alumno (`examChain.test.ts`): la suprahepática derecha
 * desde la intercostal y el tronco portal desde la ventana portal (las interlobares no llevan forma). Conservan su sección
 * circular y su radio lineal (decisión 90): la lectura de una captura depende de la realización del moteado espectral y la
 * de la puerta, así que cualquier cambio de su luz junto a la puerta cambiaría lo que el alumno mide.
 */
export const PW_GATE_VESSELS: readonly VesselId[] = ['hvRight', 'pvTrunk'];

/**
 * Clase de la forma orgánica de un vaso (decisión 90) según su sistema: las suprahepáticas y la porta con sus ramas, los
 * vasos del parénquima hepático que el juez ciego veía como círculos y conos, salvo los de las puertas PW del protocolo
 * (`PW_GATE_VESSELS`). Sin forma: la VCI (su sección es la elipse de la fisiología y su calibre va en sus nodos), las
 * arterias (redondas por la presión), las venas renales (la izquierda cruza la pinza aortomesentérica con holguras de
 * milímetros) y los vasos interlobares (1–2 mm, bajo la resolución, con la puerta PW de la cadena renal junto a la arteria).
 * Los conductos biliares tampoco la llevan.
 */
export function tubeShapeClassOf(id: VesselId): TubeShapeClass | null {
  if (PW_GATE_VESSELS.includes(id)) return null;
  const system = VESSEL_META[id].system;
  return system === 'hepaticVein' ? 'vein' : system === 'portal' ? 'portal' : null;
}

export interface VesselDef {
  id: VesselId;
  tube: Tube;
  /** Radio de referencia en el sitio de muestreo (mm): define el área de VesselAreas. */
  refRadius: number;
  /** Exponente del perfil de velocidad (2 parabólico; mayor = más plano). */
  profileN: number;
  /** Tejido de pared y su espesor (mm). */
  wallTissue: Tissue;
  wallMm: number;
  /**
   * Ramas procedurales: velocidad relativa a la del vaso `id` del que dependen
   * (una rama de 3.º orden lleva ~0,85 de la velocidad media de su madre). 1 si se omite.
   */
  flowFactor?: number;
}

/**
 * Origen de la vena renal en el seno (decisión 87): la vena se forma en el hilio con 2–3 segmentarias de 4–6 mm; un solo
 * tubo que nace en el borde medial del seno (v, mm, marco del riñón) con `RENAL_VEIN_SINUS_R` y se ensancha hasta el hilio
 * las resume [EXTRAPOLACIÓN PROPIA]. En el seno solo queda su grasa, sin sistema colector ni columna negra.
 */
export const RENAL_VEIN_SINUS_V = 15;
export const RENAL_VEIN_SINUS_R = 2;

/** Conducto biliar: tubo sin flujo, luz anecoica y pared ecogénica. */
export interface DuctDef {
  id: 'cbd' | 'rightHepaticDuct' | 'leftHepaticDuct' | 'cysticDuct';
  tube: Tube;
  wallMm: number;
}

/**
 * Árbol vascular y vía biliar del avatar de referencia (base B.1–B.6 para los
 * calibres de tronco portal, suprahepática derecha y VCI; el resto es
 * [EXTRAPOLACIÓN PROPIA]). Coordenadas materiales en mm (marco levógiro,
 * decisión 22). Los vasos renales e interlobares se construyen en el marco local
 * del riñón (`kidneyWorld`) para que sigan a la primitiva si esta cambia.
 */
export function buildVesselTree(
  kidneyRight: Kidney,
  kidneyLeft: Kidney,
  registeredAbdomen = false,
): { vessels: VesselDef[]; ducts: DuctDef[] } {
  const tube = (nodes: Array<[Vec3, number]>, apScale = 1): Tube => ({
    kind: 'tube',
    nodes: nodes.map(([p, r]) => ({ p, r })),
    apScale,
  });
  const thin = (id: VesselId, nodes: Array<[Vec3, number]>, refRadius: number, wallMm = 0.5): VesselDef => ({
    id,
    tube: tube(nodes),
    refRadius,
    profileN: 3,
    wallTissue: Tissue.VesselWallThin,
    wallMm,
  });
  const portal = (id: VesselId, nodes: Array<[Vec3, number]>, refRadius: number, wallMm = 1.0): VesselDef => ({
    id,
    tube: tube(nodes),
    refRadius,
    profileN: 4,
    wallTissue: Tissue.VesselWallPortal,
    wallMm,
  });
  const artery = (id: VesselId, nodes: Array<[Vec3, number]>, refRadius: number, wallMm = 0.6): VesselDef => ({
    id,
    tube: tube(nodes),
    refRadius,
    profileN: 2,
    wallTissue: Tissue.ArteryWall,
    wallMm,
  });
  // Puntos del riñón derecho en coordenadas del mundo (seno, hilio, columnas de Bertin)
  const kR = kidneyRight;
  const kL = kidneyLeft;
  const kw = (k: Kidney, q: Vec3): Vec3 => kidneyWorld(q, k);
  // En el hilio, de delante atrás: vena, arteria (y pelvis). Ejes a 9 mm (radios 4,5 + 2,4 más las
  // paredes): antes compartían el nodo y la puerta PW sobre la arteria hiliar leía la vena.
  const hilumVeinR = kw(kR, [0, kR.radii[1] - 2, 5]);
  const hilumArteryR = kw(kR, [0, kR.radii[1] - 2, -4]);
  // la base del riñón izquierdo es especular: su w apunta hacia atrás
  const hilumVeinL = kw(kL, [0, kL.radii[1] - 2, -5]);
  const hilumArteryL = kw(kL, [0, kL.radii[1] - 2, 4]);
  // Interlobares en las columnas de Bertin: nacen en el seno y se abren en abanico
  // (u × 1,15 hacia la corteza) entre las pirámides; arteria y vena adyacentes
  // Interlobares (decisión 68): por la columna de Bertin desde el seno hasta la base de las pirámides (unión
  // corticomedular, donde se hacen arcuatas), con una leve curva propia y hondura distinta en cada columna; antes
  // llegaban a 3 mm de la cápsula y eran tres rayas rectas, paralelas y equidistantes
  // (decisión 87) se afilan hacia la unión, donde se hacen arcuatas de 1–1,5 mm [EXTRAPOLACIÓN PROPIA: los radios]: el tramo
  // de la columna ya no es una hendidura negra de 2,6 mm hasta la base de las pirámides; la puerta PW de la cadena del
  // alumno queda junto al seno, donde miden lo mismo que antes (el `refRadius`, que da el área y la velocidad, no cambia)
  const interlobarVein = (id: VesselId, u: number, bow: number, outer: number): VesselDef =>
    thin(
      id,
      [
        [kw(kR, [u * 1.12 + 0.4 * bow, outer, 1.8]), 0.7],
        [kw(kR, [u * 1.05 + bow, (outer - 6) / 2, 1.8]), 1.4],
        [kw(kR, [u, -6, 1.8]), 1.95],
      ],
      1.7,
      0.4,
    );
  const interlobarArtery = (id: VesselId, u: number, bow: number, outer: number): VesselDef =>
    artery(
      id,
      [
        [kw(kR, [u, -6, -1.8]), 1.35],
        [kw(kR, [u * 1.05 + bow, (outer - 6) / 2, -1.8]), 1.0],
        [kw(kR, [u * 1.12 + 0.4 * bow, outer, -1.8]), 0.5],
      ],
      1.15,
      0.4,
    );

  const vessels: VesselDef[] = [
    {
      // Decisión 69: «S» sagital suave (Li 2021; Joshi 2009): desde la AD baja y se aleja de la pared ~13–15 mm hasta
      // el nivel renal, con la lordosis por delante en L3; por encima del hígado queda 13–26 mm por delante de la aorta.
      // Antes era un único tramo recto de 320 mm (z −300…20) que solo se curvaba en sus últimos 40 mm.
      // Decisión 90: el tramo que ven el flanco y el extremo caudal de la subxifoidea (z −64…−14) deja de ser una banda de
      // paredes paralelas y calibre constante (el juez ciego, ronda 4: «un tubo recto de paredes paralelas de borde a borde,
      // la geometría de un maniquí»). La VCI sube por la derecha de la columna, detrás del hígado, y se inclina hacia delante
      // y hacia dentro hasta la aurícula (Gray; Insights Imaging 2021, PMC8405820): en el plano coronal el tramo
      // retrohepático se curva 1 mm hacia la derecha del paciente antes de volver hacia la línea media, y el calibre se
      // estrecha un 7 % a z −40, donde la porta le pasa por delante, y vuelve a su radio de referencia a z −14, smoothstep
      // entre nodos (sin quiebros en las paredes: `smoothRadius`) (la TC de 200 adultos sanos no halla diferencias entre el
      // nivel renal y 2 cm bajo la AD, AP 16,3 frente a 16,9 mm: PMC9789330) [EXTRAPOLACIÓN PROPIA: la curva y la
      // cintura]. De z −14 a 35 el radio es el de referencia (10 mm): la VCI que puede medir el alumno, desde 1–2 cm bajo la
      // confluencia de las suprahepáticas hasta la línea M «más perpendicular» de la e2e (z ≈ 0), da en la imagen el
      // diámetro de la fisiología (±2 %; una ondulación del +5 % a z −6 lo inflaba un 6 %: la revisión adversarial). Se
      // conservan el eje sagital de la decisión 69 (a ≤ 0,6 mm), la unión con la supradiafragmática y el nivel renal (9,75 mm:
      // la arteria renal derecha pasa por detrás y la porta por delante, y la VCI dilatada de la congestión grave ya las
      // tocaba: ninguna holgura empeora).
      id: 'ivcInfra',
      tube: {
        ...tube(
          [
            [[-14, -16, -300], 9.5],
            [[-21, -12, -115], 9.5],
            [[-22, -17, -64], 9.75],
            [[-22.8, -16.5, -40], 9.3],
            [[-21.5, -14.9, -14], 10],
            [[-21, -11, 15], 10],
            [[-20, -8, 35], 10],
          ],
          0.8,
        ),
        smoothRadius: true,
      },
      refRadius: 10,
      profileN: 5,
      wallTissue: Tissue.VesselWallThin,
      wallMm: 0.8,
    },
    {
      // la confluencia de las suprahepáticas, el estrechamiento en el hiato de la cava del diafragma (z 53, cintura del 10 %
      // [ESTIMADO]) y el embudo que se abre en el suelo de la AD (decisión 85; antes, un embudo que se ensanchaba sin cintura y
      // seguía 20 mm dentro de una aurícula que no apoyaba en el diafragma)
      id: 'ivcSupra',
      tube: tube(
        [
          [[-20, -8, 35], 10],
          [[-19, -5, 47], 10.2],
          [[-18.1, -3.2, 53], 9.2],
          [[-17.4, -1.8, 58], 12],
          [[-16.9, -0.6, 64], 12.5],
        ],
        0.8,
      ),
      refRadius: 10,
      profileN: 5,
      wallTissue: Tissue.VesselWallThin,
      wallMm: 0.8,
    },
    // Suprahepáticas: calibres BASALES de un adulto sano (curso medio 5–8 mm de diámetro,
    // desembocadura 8–10 mm; B.2); la congestión los dilata vía `hvRadiusScale` hasta
    // ~1,6× (≈ 15 mm de diámetro a 19 mmHg), como en la plétora real.
    // Derecha: plano intersegmentario del lóbulo derecho, entra en la cava por su cara
    // posterolateral derecha 1 cm por debajo del tronco común.
    thin(
      'hvRight',
      [
        [[-135, 12, -65], 2.4],
        [[-105, -4, -28], 3.6],
        [[-68, -18, 10], 4.8],
        [[-38, -11, 32], 5.6],
        [[-27, -9, 39], 6.0],
      ],
      5.6,
    ),
    thin(
      'hvRightAnterior',
      [
        [[-118, 42, -40], 2.0],
        [[-95, 16, -15], 2.8],
        [[-83, -12, -5], 3.2],
      ],
      2.8,
    ),
    thin(
      'hvRightPosterior',
      [
        [[-125, -45, -48], 2.0],
        [[-100, -30, -18], 2.8],
        [[-83, -12, -5], 3.2],
      ],
      2.8,
    ),
    // Media: cisura lobar principal (línea de Cantlie), desde el parénquima de IVb/V por encima de la fosa
    // vesicular (decisión 67: antes nacía en la fosa y su primer tramo cruzaba la luz de la vesícula)
    // Decisión 90: su tramo más largo (43 mm, antes recto con el radio lineal: «un cono recto», juez ciego, ronda 4) se curva
    // 3 mm en el plano de la subcostal y es más tubular (3,2 → 3,8 → 4,0 mm), y se abre en embudo en el tronco común (4,4 →
    // 5,2) [EXTRAPOLACIÓN PROPIA: la curva y el perfil]; mismo `refRadius`
    thin(
      'hvMiddle',
      [
        [[-57, 31, -38], 2.0],
        [[-40, 24, -25], 3.2],
        [[-33.8, 17.1, -5.8], 3.8],
        [[-30, 5, 12], 4.0],
        [[-25, 5, 34], 4.4],
        [[-22, 3, 43], 5.2],
      ],
      4.5,
    ),
    thin(
      'hvMiddleTributary',
      [
        [[-75, 30, -20], 2.0],
        [[-50, 20, -8], 2.4],
        // desemboca en el eje de la media (decisión 90: la curva desplazó 3 mm su eje a z 1)
        [[-32.3, 12.5, 1], 2.8],
      ],
      2.4,
    ),
    // Izquierda: cisura intersegmentaria izquierda, dentro de la cuña del segmento lateral (decisión 72: su cara visceral
    // sube hacia atrás a 35°; antes el extremo quedaba a 30 mm bajo ella)
    thin(
      'hvLeft',
      [
        [[55, 54, -8], 2.0],
        [[30, 46, 2], 2.8],
        [[0, 6, 26], 3.6],
        [[-15, 6, 39], 4.0],
        [[-22, 3, 43], 4.0],
      ],
      4.2,
    ),
    thin(
      'hvLeftTributary',
      [
        [[28, 66, -26], 1.6],
        [[18, 56, -10], 2.0],
        // Confluencia sobre el segmento [30,46,2] → [0,6,26] de hvLeft (t=1/2).
        // El extremo previo [10,14,14] fallaba la guarda de unión con calibres fisiológicos.
        // Es una restricción de continuidad del modelo, no una coordenada clínica calibrada.
        [[15, 26, 14], 2.4],
      ],
      2.0,
    ),
    // Tronco común media + izquierda (≈ 1 cm) hasta la cara anterior izquierda de la VCI
    thin(
      'hvCommonTrunk',
      [
        [[-22, 3, 43], 6.0],
        [[-20, -1, 50], 6.4],
      ],
      6,
      0.6,
    ),
    // Porta: tronco (11 mm) oblicuo hacia el hilio, bifurcación en la porta hepatis
    // Decisión 69: nace en la confluencia esplenoportal detrás del cuello del páncreas, por delante de la AMS, y sube
    // oblicua a la derecha por delante de la VCI (con el hiato de Winslow entre ambas). Antes nacía dentro de la aorta.
    portal(
      'pvTrunk',
      [
        [[-3, 6, -100], 5.5],
        [[-14, 4, -75], 5.5],
        [[-26, 2, -56], 5.5],
        [[-34, 0, -45], 5.5],
      ],
      5.5,
      1.2,
    ),
    portal(
      'pvRight',
      [
        [[-34, 0, -45], 4.5],
        [[-58, 2, -37], 4.3],
        [[-80, 4, -31], 4],
      ],
      4.2,
    ),
    portal(
      'pvRightAnterior',
      [
        [[-80, 4, -31], 3],
        [[-100, 30, -19], 2.6],
        [[-115, 48, -5], 2],
      ],
      2.5,
      0.8,
    ),
    portal(
      'pvRightPosterior',
      [
        [[-80, 4, -31], 3],
        [[-105, -22, -27], 2.6],
        [[-125, -38, -17], 2],
      ],
      2.5,
      0.8,
    ),
    // Izquierda: porción transversa y porción umbilical, que gira hacia delante y abajo y
    // termina en el receso de Rex, justo por detrás del suelo de la fisura umbilical (x 15,
    // z < −30; decisión 40) donde se continúa con el ligamento redondo. De ahí salen las
    // ramas laterales (II–III) y mediales (IV).
    portal(
      'pvLeft',
      [
        [[-34, 0, -45], 3.8],
        [[-12, 10, -40], 3.6],
        [[8, 30, -38], 3.4],
      ],
      3.5,
    ),
    portal(
      'pvLeftLateral',
      [
        [[8, 30, -38], 2.8],
        [[16, 62, -18], 2.5],
        [[30, 66, -16], 2.2],
        [[58, 58, -4], 1.8],
      ],
      2.4,
      0.8,
    ),
    portal(
      'pvLeftMedial',
      [
        [[8, 30, -38], 2.4],
        [[-16, 40, -26], 2],
        [[-38, 46, -10], 1.6],
      ],
      2,
      0.8,
    ),
    // Decisión 69: hepática común desde el tronco celíaco (T12) hacia la derecha y propia por delante y a la izquierda
    // de la porta hasta el hilio; antes salía de la aorta 40 mm por debajo de las arterias renales. Sube a la izquierda
    // del colédoco y cruza el hilio por delante de la confluencia de los hepáticos y por encima del cístico (revisión:
    // cruzaba el cístico, −0,8 mm entre luces, y el colédoco, −2,8; y corría pegada al hepático derecho)
    artery(
      'hepaticArtery',
      [
        [[13, -3, -32], 2.6],
        [[-6, -1, -38], 2.5],
        [[-18, 8, -49], 2.4],
        [[-24.5, 14.5, -45], 2.3],
        [[-33, 14.5, -38], 2.1],
        [[-70, 16, -27], 1.7],
      ],
      2.4,
    ),
    // tronco celíaco: desde la cara anterior de la aorta hasta su bifurcación («gaviota»), por delante de ella
    artery(
      'celiacTrunk',
      [
        [[15.5, -14, -30], 3.3],
        [[14.5, -7.5, -31], 3.2],
        [[13, -3, -32], 3.0],
      ],
      3.2,
    ),
    artery(
      'splenicArtery',
      [
        [[13, -3, -32], 2.5],
        [[24, -5, -29], 2.4],
        [[42, -9, -26], 2.3],
        [[66, -15, -24], 2.2],
      ],
      2.4,
    ),
    // arteria mesentérica superior: ~12 mm por debajo del celíaco, baja por delante de la aorta; la vena renal
    // izquierda pasa entre ambas (pinza aortomesentérica, a 13,5 mm entre luces; normal 10–28; antes 8 y la vena
    // dentro de la aorta)
    artery(
      'sma',
      [
        [[15.5, -17, -42], 3.3],
        [[15, -6, -48], 3.2],
        [[15, 4, -62], 3.0],
        [[14.5, 4.5, -70], 2.9],
        [[13, 4, -110], 2.6],
        [[10, 3, -170], 2.2],
      ],
      3.0,
    ),
    // aorta: apoyada en la cara anterior izquierda del cuerpo vertebral, sin hundirse en él (revisión: su luz entraba
    // hasta 4,8 mm en la vértebra, que se clasifica antes que los tubos)
    {
      id: 'aorta',
      tube: tube([
        [[17.5, -21.5, 100], 11.5],
        [[17, -22, 20], 11],
        [[16.5, -22.5, -60], 10.2],
        [[14.5, -22, -150], 9.5],
        [[9.5, -20, -300], 9],
      ]),
      refRadius: 10,
      profileN: 5,
      wallTissue: Tissue.ArteryWall,
      wallMm: 1.2,
    },
    // Renales: la arteria derecha pasa por detrás de la VCI; la vena izquierda cruza
    // por delante de la aorta (larga) hacia la VCI.
    artery(
      'renalArteryRight',
      [
        [[12, -26, -62], 2.6],
        [[-12, -29, -67], 2.5],
        [hilumArteryR, 2.4],
        [kw(kR, [0, 6, -4]), 2.2],
      ],
      2.5,
    ),
    // la vena renal se forma en el hilio con las segmentarias: nace en el borde medial del seno con 4 mm de diámetro y se
    // ensancha hasta el hilio (decisión 87; antes, 8 mm desde el centro del seno: una columna negra que cruzaba el contorno)
    thin(
      'renalVeinRight',
      [
        [kw(kR, [0, RENAL_VEIN_SINUS_V, 5]), RENAL_VEIN_SINUS_R],
        [hilumVeinR, 4.5],
        [[-40, -20, -70], 4.5],
        [[-22, -16, -66], 4.5],
      ],
      4.5,
      0.6,
    ),
    artery(
      'renalArteryLeft',
      [
        [[12, -26, -60], 2.6],
        [[40, -32, -64], 2.5],
        [hilumArteryL, 2.4],
        [kw(kL, [0, 6, 4]), 2.2],
      ],
      2.5,
    ),
    thin(
      'renalVeinLeft',
      [
        [kw(kL, [0, RENAL_VEIN_SINUS_V, -5]), RENAL_VEIN_SINUS_R],
        [hilumVeinL, 4.5],
        // por delante de la aorta y estrechada en la pinza aortomesentérica (r 3), sin tocar la aorta ni la AMS
        [[40, -17, -63], 4.5],
        [[27, -7, -63.5], 3.5],
        [[15, -5.5, -64], 3],
        [[3, -7.5, -64], 3.5],
        [[-22, -14, -64], 5],
      ],
      5,
      0.6,
    ),
    // Interlobares del riñón derecho en las columnas de Bertin (entre pirámides),
    // arteria y vena adyacentes en el plano coronal lateral
    interlobarArtery('interlobarArtery1', BERTIN_COLUMNS_U[0], 1.5, -20),
    interlobarArtery('interlobarArtery2', BERTIN_COLUMNS_U[1], -1.2, -21.5),
    interlobarArtery('interlobarArtery3', BERTIN_COLUMNS_U[2], 0.8, -19),
    interlobarVein('interlobarVein1', BERTIN_COLUMNS_U[0], 1.5, -20),
    interlobarVein('interlobarVein2', BERTIN_COLUMNS_U[1], -1.2, -21.5),
    interlobarVein('interlobarVein3', BERTIN_COLUMNS_U[2], 0.8, -19),
  ];
  // Vía biliar: colédoco anterolateral a la porta en el ligamento hepatoduodenal,
  // hepáticos derecho e izquierdo por delante de las ramas portales, cístico al cuello.
  const ducts: DuctDef[] = [
    // colédoco: a la derecha y por delante de la porta; sube medial al cuello de la vesícula (revisión: su luz quedaba a
    // 1 mm de la bilis, entrando 1,4 mm en la pared del cuello) hasta la confluencia de los hepáticos
    {
      id: 'cbd',
      tube: tube([
        [[-24, 2, -112], 2.8],
        [[-26, 12, -69], 2.8],
        [[-28.5, 11.5, -50], 2.6],
        [[-36, 8, -39], 2.4],
      ]),
      wallMm: 0.7,
    },
    {
      id: 'rightHepaticDuct',
      tube: tube([
        [[-36, 8, -39], 1.6],
        [[-62, 10, -31], 1.4],
        [[-82, 12, -25], 1.2],
      ]),
      wallMm: 0.6,
    },
    {
      id: 'leftHepaticDuct',
      tube: tube([
        [[-36, 8, -39], 1.5],
        [[-10, 16, -27], 1.3],
        [[12, 30, -17], 1.1],
      ]),
      wallMm: 0.6,
    },
    // cístico: sale de la punta del cuello de la vesícula y baja hacia dentro hasta el colédoco (decisión 67:
    // antes acababa a 40 mm del cuello, en la vesícula de la decisión 41)
    {
      id: 'cysticDuct',
      tube: tube([
        [[-36.2, 12.6, -45.5], 1.4],
        [[-31, 10, -46.5], 1.3],
        [[-28, 9, -51], 1.3],
        [[-28, 11, -57], 1.3],
      ]),
      wallMm: 0.6,
    },
  ];
  if (registeredAbdomen) registerAbdominalVessels(vessels, ducts);
  return { vessels, ducts };
}

/**
 * Espesor de pared en un punto del tubo (mm). La pared periportal (vaina de Glisson:
 * porta + arteria + conducto + tejido fibroso) es proporcional al calibre local:
 * 1,3 mm en el tronco (r 5,5) y 0,5 mm en las ramas periféricas (r ≤ 2), de modo que
 * el «doble contorno» ecogénico se desvanece hacia la periferia como en la imagen real.
 * Misma fórmula en GLSL (`portalWallMm`).
 */
export function wallThicknessMm(def: Pick<VesselDef, 'wallTissue' | 'wallMm'>, localRadiusMm: number): number {
  if (def.wallTissue !== Tissue.VesselWallPortal) return def.wallMm;
  return Math.min(1.4, Math.max(0.5, 0.24 * localRadiusMm));
}

/**
 * Escala de radio máxima que la fisiología puede dar a una rama según la ley de calibre de su
 * madre (medido en 20 s de los tres casos: suprahepáticas 1,71 en la congestión grave, porta
 * 1,15). Las ramas se generan una vez para todos los casos, así que su contención se comprueba
 * con el calibre más dilatado, con margen.
 */
export const BRANCH_MAX_RADIUS_SCALE: Record<CaliberLaw, number> = { hepaticVein: 1.8, portal: 1.2, ivc: 1, fixed: 1 };

/**
 * Mayor saliente de la luz de una rama de `parent` sobre su radio lineal con la escala de radio `sMax` (decisión 90): el de
 * la forma orgánica de su clase (`tubeShapeMaxFactor`), que la contención de las ramas cuenta; 1 sin forma (la VCI).
 */
export function branchShapeMax(parent: Pick<VesselDef, 'id'>, sMax: number): number {
  const cls = tubeShapeClassOf(parent.id);
  return cls ? tubeShapeMaxFactor(cls, sMax) : 1;
}

/**
 * Radio (mm) del extremo de una rama terminal (decisión 87): la luz se afila por debajo de la resolución (0,3 mm frente a
 * una PSF de 1–3 mm y una rodaja de 3–5 mm) y la rama se apaga en la imagen, como una vena real hacia la periferia
 * [EXTRAPOLACIÓN PROPIA: el radio y el afilado lineal]. Antes todas acababan con 0,9 mm y una tapa esférica: una vena recta
 * que termina en un círculo («piruleta», juez ciego, ronda 3).
 */
export const BRANCH_TIP_RADIUS_MM = 0.3;

/**
 * Ramas hepáticas de 3.º y 4.º orden, procedurales y deterministas (semilla fija:
 * el avatar es el mismo para todos los casos). Cada rama de 2.º orden (portal o
 * suprahepática) emite dos hijas por bifurcación con ángulo 30–45° alrededor de un
 * eje aleatorio perpendicular, longitud 0,7× la del segmento madre (22–40 mm) y
 * radio 0,62×; las hijas vuelven a bifurcarse una vez. Cada rama se acorta hasta que
 * su extremo queda a ≥ 3 mm dentro del hígado (`liverSdf`) y su recorrido entero cabe con
 * el calibre más dilatado (`BRANCH_MAX_RADIUS_SCALE`) y su pared lejos de la cápsula y de
 * las fisuras (`clearance`), así el árbol nunca sale del parénquima aunque el hígado cambie
 * de tamaño o las venas se dilaten. Las ramas heredan el `id`
 * fisiológico de su madre (misma velocidad × `flowFactor`) y su tejido de pared:
 * manguito periportal ecogénico en la porta, pared fina en las suprahepáticas
 * (B.1–B.3; densidad de ramas [EXTRAPOLACIÓN PROPIA] de un hígado adulto).
 *
 * Ningún extremo periférico acaba en una bola mayor que lo que lo continúa (decisión 87): las ramas sin hijas se afilan
 * hasta `BRANCH_TIP_RADIUS_MM`, y la madre también, hasta el radio de sus hijas o, si no caben (junto a la cápsula), hasta
 * ese mismo radio: `parents` es `vessels` con las madres afiladas en su último tramo, con el mismo `refRadius` (las áreas
 * y las velocidades no cambian).
 */
export function buildHepaticBranches(
  vessels: readonly VesselDef[],
  liverSdf: (m: Vec3) => number,
  seed = 7,
  /** Holgura para la pared de la rama (mm, positiva dentro): por defecto −liverSdf; la escena añade las fisuras. */
  clearance: (m: Vec3) => number = (m) => -liverSdf(m),
): { branches: VesselDef[]; parents: VesselDef[] } {
  const rng = new SeededRandom(seed);
  const out: VesselDef[] = [];
  const tapered = new Map<VesselDef, VesselDef>();
  /** Ramas madre: [id, ¿extremo periférico es el PRIMER nodo? (suprahepáticas: sí)] */
  const parents: Array<[VesselId, boolean]> = [
    ['pvRightAnterior', false],
    ['pvRightPosterior', false],
    ['pvLeftLateral', false],
    ['pvLeftMedial', false],
    ['hvRightAnterior', true],
    ['hvRightPosterior', true],
    ['hvMiddleTributary', true],
    ['hvLeftTributary', true],
    ['hvRight', true],
    ['hvMiddle', true],
    ['hvLeft', true],
  ];
  /**
   * ¿Cabe la rama entera con el calibre más dilatado? Se recorre cada 0,5 mm desde que sale de la luz
   * de la madre: la luz (r·S_máx, con el mayor saliente de su forma orgánica, decisión 90) más la pared debe quedar
   * dentro del parénquima y fuera de las fisuras. Antes solo se miraban los extremos y una rama del caso grave cruzaba la
   * fisura umbilical.
   */
  const segmentFits = (
    origin: Vec3,
    end: Vec3,
    r0: number,
    rEnd: number,
    wall: Pick<VesselDef, 'wallTissue' | 'wallMm'>,
    sMax: number,
    shapeMax: number,
  ): boolean => {
    const len = dist(origin, end);
    const n = Math.max(1, Math.ceil(2 * len));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (t * len < r0 * sMax) continue;
      const r = (r0 + (rEnd - r0) * t) * sMax * shapeMax;
      if (clearance(add(origin, scale(sub(end, origin), t))) < r + wallThicknessMm(wall, r)) return false;
    }
    return true;
  };
  /** Punto a distancia `len` de `origin` en `dir`, acortado hasta quedar ≥ 3 mm dentro del hígado y con la rama entera dentro. */
  const fitInside = (origin: Vec3, dir: Vec3, len0: number, fits: (end: Vec3) => boolean): { end: Vec3; len: number } | null => {
    let len = len0;
    for (let i = 0; i < 8; i++) {
      const end = add(origin, scale(dir, len));
      if (liverSdf(end) <= -3 && fits(end)) return { end, len };
      len *= 0.75;
    }
    return null;
  };
  const grow = (
    parent: VesselDef,
    origin: Vec3,
    dir: Vec3,
    r0: number,
    segLen: number,
    factor: number,
    depth: number,
    peripheralFirst: boolean,
  ): void => {
    if (depth > 2 || liverSdf(origin) > -2) return; // el origen también debe estar en el parénquima
    for (let k = 0; k < 2; k++) {
      // eje perpendicular aleatorio; ángulo de bifurcación alterno, y si esa dirección
      // sale del hígado se prueba la simétrica (el árbol real se acomoda a la cápsula)
      const rnd: Vec3 = normalize([rng.float() - 0.5, rng.float() - 0.5, rng.float() - 0.5]);
      const axis = normalize(cross(dir, rnd));
      const angle = ((k === 0 ? 1 : -1) * ((30 + 15 * rng.float()) * Math.PI)) / 180;
      const len0 = Math.min(40, Math.max(22, 0.7 * segLen)) * (0.9 + 0.2 * rng.float());
      // la rama de 4.º orden (y la lateral) no tiene hijas: su extremo se afila hasta apagarse
      const rEnd = depth >= 2 ? BRANCH_TIP_RADIUS_MM : Math.max(0.9, r0 * 0.6);
      const wall = { wallTissue: parent.wallTissue, wallMm: Math.max(0.4, parent.wallMm * 0.7) };
      const sMax = BRANCH_MAX_RADIUS_SCALE[VESSEL_META[parent.id].caliber];
      const fits = (end: Vec3) => segmentFits(origin, end, r0, rEnd, wall, sMax, branchShapeMax(parent, sMax));
      let d2 = normalize(rotateAxis(dir, axis, angle));
      let fit = fitInside(origin, d2, len0, fits);
      if (!fit || fit.len < 12) {
        d2 = normalize(rotateAxis(dir, axis, -angle * 1.6));
        fit = fitInside(origin, d2, len0, fits);
      }
      if (!fit || fit.len < 12) continue;
      const nodes = peripheralFirst
        ? [
            { p: fit.end, r: rEnd },
            { p: origin, r: r0 },
          ]
        : [
            { p: origin, r: r0 },
            { p: fit.end, r: rEnd },
          ];
      out.push({
        id: parent.id,
        tube: { kind: 'tube', nodes, apScale: 1 },
        refRadius: r0,
        profileN: parent.profileN,
        ...wall,
        flowFactor: factor,
      });
      const before = out.length;
      grow(parent, fit.end, d2, rEnd, fit.len, factor * 0.85, depth + 1, peripheralFirst);
      // sin hijas que quepan también es terminal: su extremo se afila (más fina, sigue cabiendo)
      if (out.length === before) nodes[peripheralFirst ? 0 : 1].r = BRANCH_TIP_RADIUS_MM;
    }
  };
  for (const [id, peripheralFirst] of parents) {
    const parent = vessels.find((v) => v.id === id);
    if (!parent) continue;
    const nodes = parent.tube.nodes;
    const tip = peripheralFirst ? nodes[0] : nodes[nodes.length - 1];
    const prev = peripheralFirst ? nodes[1] : nodes[nodes.length - 2];
    const dir = normalize(sub(tip.p, prev.p));
    const before = out.length;
    grow(parent, tip.p, dir, tip.r * 0.62, dist(tip.p, prev.p), 0.85, 1, peripheralFirst);
    // el extremo de la madre no acaba en una bola mayor que lo que la continúa (decisión 87): con hijas, su último tramo se
    // afila hasta el radio con que nacen (0,62·r, la unión en «Y»); sin ellas (junto a la cápsula), hasta
    // BRANCH_TIP_RADIUS_MM, en vez de acabar en una tapa de 1,6–2,4 mm
    const tipR = out.length > before ? tip.r * 0.62 : BRANCH_TIP_RADIUS_MM;
    const n2 = nodes.map((n) => ({ ...n }));
    n2[peripheralFirst ? 0 : n2.length - 1].r = tipR;
    tapered.set(parent, { ...parent, tube: { ...parent.tube, nodes: n2 } });
    // y ramas laterales a lo largo del último segmento (a 1/3 y 2/3), como las que nacen a lo largo de un vaso real; cada
    // una vuelve a bifurcarse una vez. No nacen más gruesas que la madre en ese punto (≤ 0,8 de su radio, afilado)
    for (const f of [0.35, 0.7]) {
      const at: Vec3 = add(prev.p, scale(sub(tip.p, prev.p), f));
      const rAt = prev.r + (tipR - prev.r) * f;
      grow(parent, at, dir, Math.min(Math.max(0.9, rAt * 0.5), 0.8 * rAt), dist(tip.p, prev.p) * 0.6, 0.85, 2, peripheralFirst);
    }
  }
  return { branches: out, parents: vessels.map((v) => tapered.get(v) ?? v) };
}
