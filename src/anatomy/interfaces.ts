import { Tissue, reflectionCoefficient } from './tissues';
import { VESSEL_META, type VesselId } from '../physiology/vessels';

/**
 * Caras especulares que dibuja la pasada B (decisión 57): una por estructura, sin signo. `classify`
 * (TS y GLSL) dice en cada muestra qué cara dibuja (`Classification.interface`, `Cls.iface`) y el valor
 * de la distancia de esa cara en ella (`interfaceDistance`, `Cls.ifd`); el eco lo pasa a distancia por la
 * normal con la norma del gradiente de la cara (`faceGradient`) y lo calcula
 * `ultrasound/interfaceEcho.ts`. El número se comparte con GLSL (`#define IF_*`).
 *
 * Dueños de cada cara (las muestras que la conocen):
 *  - luz de un vaso o conducto y de la vesícula: la pared y la luz (dos lados, la misma consulta), salvo
 *    dentro de la aurícula derecha, donde la VCI entra y no hay pared que dibujar;
 *  - cápsula hepática: la cápsula, salvo junto al diafragma (cara del diafragma) o a la grasa
 *    perirrenal (cara de Morison, de la grasa);
 *  - cara hepática del diafragma: la mitad abdominal del diafragma (la pleural la dibuja el espejo
 *    exacto de la pasada A);
 *  - cápsula renal externa: la cápsula renal y la mitad interna de la grasa perirrenal (dos lados);
 *  - cara externa de la grasa perirrenal (Morison): la mitad externa de la grasa;
 *  - pleura parietal bajo la pared (decisión 61): no sale de `classify`; la dibuja la pasada B desde el
 *    cruce exacto de A0, del lado de la pared (su dueña), con la serie de reverberaciones;
 *  - capas de la pared (decisión 62, `organs/wall.ts`): cada muestra de piel, grasa, músculo o grasa
 *    preperitoneal dibuja la cara de su capa más cercana (dermis/grasa, Scarpa, fascia profunda, los dos
 *    planos intermusculares, transversalis: dos lados; peritoneo parietal: la grasa preperitoneal, un lado);
 *  - cortical costal: el tejido blando de la pared junto a la costilla ósea (un lado: el hueso atenúa su
 *    propio interior); pericondrio: el cartílago (un lado, también su cara profunda).
 * No se dibujan la cara pared/hígado (misma impedancia) ni cápsula renal/corteza, ni hay capa fina.
 */
export enum Interface {
  None = 0,
  VeinLumen = 1,
  IvcLumen = 2,
  PortalLumen = 3,
  ArteryLumen = 4,
  DuctLumen = 5,
  GallbladderLumen = 6,
  LiverCapsule = 7,
  DiaphragmLiver = 8,
  /** Cara pleural del diafragma: no sale de `classify`; la dibuja el espejo exacto (pasada A). */
  Pleura = 9,
  RenalCapsule = 10,
  PerirenalFat = 11,
  /**
   * Pleura parietal bajo la pared, sobre el pulmón de la cortina (decisión 61): no sale de `classify`; la
   * dibuja la pasada B en el cruce exacto que da A0, con su serie de reverberaciones.
   */
  PleuraWall = 12,
  /** Capas de la pared (decisión 62): de la piel hacia dentro. */
  SkinFat = 13,
  Scarpa = 14,
  DeepFascia = 15,
  /** Plano entre los oblicuos externo e interno (pared lateral). */
  ObliquePlane = 16,
  /** Plano entre el oblicuo interno y el transverso (pared lateral). */
  TransversusPlane = 17,
  Transversalis = 18,
  Peritoneum = 19,
  /** Cortical de una costilla ósea (la dibuja el tejido blando de fuera). */
  RibCortex = 20,
  /** Pericondrio del cartílago costal (lo dibuja el cartílago). */
  Perichondrium = 21,
}

export const INTERFACE_COUNT = 22;
/** Las caras de tubo van primero (ids ≤ esta): solo ellas llevan coherencia de curvatura. */
export const LAST_TUBE_INTERFACE = Interface.DuctLumen;
/** Caras de las capas de la pared (decisión 62): ids consecutivos de `SkinFat` a `Peritoneum`. */
export const FIRST_WALL_INTERFACE = Interface.SkinFat;
export const LAST_WALL_INTERFACE = Interface.Peritoneum;

/** Cara de una capa de la pared (su distancia es la de `wallFaceSd`, `organs/wall.ts`). */
export function isWallLayerInterface(i: Interface): boolean {
  return i >= FIRST_WALL_INTERFACE && i <= LAST_WALL_INTERFACE;
}

/** Cara de una costilla (cortical o pericondrio): su distancia es la de `ribSd`. */
export function isRibInterface(i: Interface): boolean {
  return i === Interface.RibCortex || i === Interface.Perichondrium;
}

/**
 * Caras con coherencia de curvatura (decisión 57): las de tubo y, desde la decisión 62, las de costilla (un
 * cilindro de sección elíptica, con la curvatura de su sección, `ribCurvature`).
 */
export function hasCurvatureCoherence(i: Interface): boolean {
  return (i !== Interface.None && i <= LAST_TUBE_INTERFACE) || isRibInterface(i);
}
/**
 * Cápsula hepática y grasa perirrenal a ≤ esto (mm) son la misma cara (Morison): la dibuja la grasa,
 * que es su única dueña. La cápsula toca la grasa en la impresión renal (distancia mediana 0,003 mm).
 */
export const MORISON_CONTACT_MM = 0.2;
/**
 * Paso (mm) de las diferencias centrales con que la GPU saca el gradiente (normal y norma) de la cápsula
 * hepática, el contorno renal, el diafragma y la vesícula (`faceGradient`), el mismo que el gradiente de
 * `faceSdf` del banco y de la e2e.
 */
export const FACE_GRADIENT_EPS_MM = 0.02;

/** Nombre GLSL de cada cara (`#define IF_… índice`); una cara nueva sin nombre no compila en TS. */
export const INTERFACE_GLSL_NAME: Record<Interface, string> = {
  [Interface.None]: 'IF_NONE',
  [Interface.VeinLumen]: 'IF_VEIN',
  [Interface.IvcLumen]: 'IF_IVC',
  [Interface.PortalLumen]: 'IF_PORTAL',
  [Interface.ArteryLumen]: 'IF_ARTERY',
  [Interface.DuctLumen]: 'IF_DUCT',
  [Interface.GallbladderLumen]: 'IF_GALLBLADDER',
  [Interface.LiverCapsule]: 'IF_LIVER_CAPSULE',
  [Interface.DiaphragmLiver]: 'IF_DIAPHRAGM_LIVER',
  [Interface.Pleura]: 'IF_PLEURA',
  [Interface.RenalCapsule]: 'IF_RENAL_CAPSULE',
  [Interface.PerirenalFat]: 'IF_PERIRENAL',
  [Interface.PleuraWall]: 'IF_PLEURA_WALL',
  [Interface.SkinFat]: 'IF_SKIN_FAT',
  [Interface.Scarpa]: 'IF_SCARPA',
  [Interface.DeepFascia]: 'IF_DEEP_FASCIA',
  [Interface.ObliquePlane]: 'IF_OBLIQUE_PLANE',
  [Interface.TransversusPlane]: 'IF_TRANSVERSUS_PLANE',
  [Interface.Transversalis]: 'IF_TRANSVERSALIS',
  [Interface.Peritoneum]: 'IF_PERITONEUM',
  [Interface.RibCortex]: 'IF_RIB',
  [Interface.Perichondrium]: 'IF_PERICHONDRIUM',
};

/** Propiedades de una cara lisa (tabla de la decisión 57). */
export interface InterfaceProps {
  name: string;
  /** Tejidos a cada lado: dan el coeficiente de Fresnel de incidencia normal. */
  sides: readonly [Tissue, Tissue];
  /**
   * Suelo de la reflectividad efectiva: la capa de colágeno sub-resolución (pared vascular, vaina de
   * Glisson, cápsula, fascia) refleja más que el salto de impedancia de los tejidos que separa.
   */
  floor: number;
  /** Rugosidad rms de pequeña escala σz (mm): coherencia de Ament, exp(−2(k0·σz·cosθ)²). */
  roughnessMm: number;
  /** Pendiente rms de gran escala s: anchura del lóbulo de Kirchhoff en incidencia. */
  slopeRms: number;
  /**
   * Las muestras de los dos lados conocen la cara (perfil centrado en el cruce); si no, el perfil se
   * desplaza 2,5σh dentro del dueño para no perder la mitad que cae fuera.
   */
  twoSided: boolean;
  /** Etiqueta de la fuente de los números. */
  source: string;
}

/** Lámina de colágeno dentro de la grasa (fascias de la pared, decisión 62). */
const FASCIA_IN_FAT = 'capa fina de colágeno en grasa: 2Γ·sen(kt), Γ colágeno (Z ≈ 1,85, Duck 1990) / grasa ≈ 0,17';
/** Nivel de las caras de la pared (decisión 62): la rugosidad efectiva deja su parte coherente en el de las referencias. */
const WALL_ROUGH =
  'rugosidad efectiva σz 0,075 mm y s 0,3 de una fascia ondulada a la escala del haz (volumen parcial en la rodaja): en la imagen sus líneas quedan a +6–14 dB sobre el hígado (mediana por vista a incidencia normal, gemelo 6,4–13,7 dB y ≤ 0,2 % de píxeles saturados), gris-blancas, bajo la pleura y la cortical, como las de las referencias; con σz 0,05, +15–29 dB y cinco líneas saturadas cruzando el flanco (capturas con GPU, 25-09-2026); con 0,10, al nivel del hígado; lisa (0,03), +30–40 dB y su falda llenaba el músculo [ESTIMADO]';
/** Plano intermuscular de la pared lateral (decisión 62). */
const INTERMUSCULAR = 'fascia con grasa entre dos músculos: 2Γ·sen(kt) con Γ grasa/músculo 0,14 y t ≈ 0,03 mm ≈ 0,08 [ESTIMADO]';
const WALL = 'Z de TISSUES (IT’IS); suelo por la pared vascular (IT’IS «blood vessel wall», |R| ≈ 0,024) [LITERATURA aprox.]';
/** Tabla de caras, en el orden del enum (la del plan de la decisión 57). */
export const INTERFACES: Readonly<Record<Interface, InterfaceProps>> = {
  [Interface.None]: {
    name: 'ninguna',
    sides: [Tissue.Air, Tissue.Air],
    floor: 0,
    roughnessMm: 0,
    slopeRms: 1,
    twoSided: true,
    source: '—',
  },
  [Interface.VeinLumen]: {
    name: 'luz venosa (pared fina)',
    sides: [Tissue.VesselWallThin, Tissue.Blood],
    floor: 0.025,
    roughnessMm: 0.02,
    slopeRms: 0.14,
    twoSided: true,
    source: `${WALL}; s de la VSH, brillante solo a ±12° [ESTIMADO]`,
  },
  [Interface.IvcLumen]: {
    name: 'luz de la VCI',
    sides: [Tissue.VesselWallThin, Tissue.Blood],
    floor: 0.025,
    roughnessMm: 0.02,
    slopeRms: 0.18,
    twoSided: true,
    source: `${WALL}; pared más gruesa y ondulada [ESTIMADO]`,
  },
  [Interface.PortalLumen]: {
    name: 'luz portal (vaina de Glisson)',
    sides: [Tissue.VesselWallPortal, Tissue.Blood],
    floor: 0.05,
    roughnessMm: 0.03,
    slopeRms: 0.25,
    twoSided: true,
    source: 'colágeno de tipo tendón con grasa, Z ≈ 1,85 (Duck 1990) [LITERATURA aprox.]; visible hasta ~25° [ESTIMADO]',
  },
  [Interface.ArteryLumen]: {
    name: 'luz arterial',
    sides: [Tissue.ArteryWall, Tissue.Blood],
    floor: 0.04,
    roughnessMm: 0.02,
    slopeRms: 0.21,
    twoSided: true,
    source: 'pared arterial con elastina y colágeno [ESTIMADO]',
  },
  [Interface.DuctLumen]: {
    name: 'luz biliar',
    sides: [Tissue.BileDuctWall, Tissue.Fluid],
    floor: 0,
    roughnessMm: 0.02,
    slopeRms: 0.21,
    twoSided: true,
    source: 'Fresnel pared biliar / bilis (TISSUES)',
  },
  [Interface.GallbladderLumen]: {
    name: 'luz vesicular',
    sides: [Tissue.BileDuctWall, Tissue.Fluid],
    floor: 0,
    roughnessMm: 0.03,
    slopeRms: 0.21,
    twoSided: true,
    source: 'Fresnel pared vesicular / bilis (TISSUES)',
  },
  [Interface.LiverCapsule]: {
    name: 'cápsula hepática',
    sides: [Tissue.LiverCapsule, Tissue.Muscle],
    floor: 0.03,
    roughnessMm: 0.03,
    slopeRms: 0.25,
    twoSided: false,
    source: 'capa de colágeno sub-resolución, 2Γ₁·sen(kt) ≈ 0,02–0,045 [ESTIMADO]; continua hasta el borde del sector',
  },
  [Interface.DiaphragmLiver]: {
    name: 'cara hepática del diafragma',
    sides: [Tissue.LiverCapsule, Tissue.Diaphragm],
    floor: 0.02,
    roughnessMm: 0.03,
    slopeRms: 0.21,
    twoSided: false,
    source: 'fascia diafragmática [ESTIMADO]',
  },
  [Interface.Pleura]: {
    name: 'pleura (diafragma / pulmón)',
    sides: [Tissue.Diaphragm, Tissue.Lung],
    floor: 0,
    roughnessMm: 0.09,
    slopeRms: 0.21,
    twoSided: true,
    source: 'Fresnel tejido / gas; σz es el mando de nivel de su parte coherente, en [0,085; 0,095] [ESTIMADO]',
  },
  [Interface.RenalCapsule]: {
    name: 'cápsula renal',
    sides: [Tissue.PerirenalFat, Tissue.RenalCapsule],
    floor: 0,
    roughnessMm: 0.05,
    slopeRms: 0.25,
    twoSided: true,
    source:
      'Fresnel grasa perirrenal / cápsula renal (TISSUES); s 0,25 (antes 0,21) para dejar Morison en [1,6; 2,2]: es la cara que da su pico (riesgo 4 del plan) [ESTIMADO]',
  },
  [Interface.PerirenalFat]: {
    name: 'grasa perirrenal (Morison)',
    sides: [Tissue.Liver, Tissue.PerirenalFat],
    floor: 0,
    roughnessMm: 0.05,
    slopeRms: 0.3,
    twoSided: false,
    source: 'Fresnel hígado / grasa (TISSUES); s ancha [ESTIMADO] (no mueve el pico de Morison, que es la cápsula renal, 4 dB más fuerte)',
  },
  [Interface.PleuraWall]: {
    name: 'pleura parietal (pared / pulmón de la cortina)',
    sides: [Tissue.Muscle, Tissue.Lung],
    floor: 0,
    roughnessMm: 0.05,
    slopeRms: 0.15,
    twoSided: false,
    source:
      'Fresnel músculo / gas (TISSUES), |R| ≈ 0,9995; s 0,15 [ESTIMADO 0,10–0,15]: la línea pleural es la más brillante cerca de la normal y se apaga en los bordes del sector (Lee 2017, J Med Ultrasound 25:101, fig. 5B; PMC10132878 fig. 2A); σz 0,05 mm [ESTIMADO, calibrable 0,04–0,07]: su parte coherente (−8,9 dB a 0°) la satura 1,2–1,3 mm a 0–15° con K = 55 dB (gemelo) y es la reflexión coherente de cada rebote de la serie bajo la pleura; de un lado: la dibuja el músculo (la pared es su dueña, decisión 61)',
  },
  [Interface.SkinFat]: {
    name: 'dermis / grasa subcutánea',
    sides: [Tissue.Skin, Tissue.Fat],
    floor: 0,
    roughnessMm: 0.075,
    slopeRms: 0.35,
    twoSided: true,
    source: 'Fresnel piel / grasa 0,146 (TISSUES); cara ondulada (papilas, folículos): s 0,35 y σz 0,075 [ESTIMADO]',
  },
  [Interface.Scarpa]: {
    name: 'fascia de Scarpa (capa membranosa)',
    sides: [Tissue.Fat, Tissue.Fat],
    floor: 0.07,
    roughnessMm: 0.075,
    slopeRms: 0.3,
    twoSided: true,
    source: `${FASCIA_IN_FAT}; t 0,05–0,1 mm daría 0,2–0,3, 0,07 por su irregularidad y ${WALL_ROUGH} (PMC7441131)`,
  },
  [Interface.DeepFascia]: {
    name: 'fascia profunda (vaina anterior del recto, aponeurosis del oblicuo externo)',
    sides: [Tissue.Fat, Tissue.Muscle],
    floor: 0,
    roughnessMm: 0.075,
    slopeRms: 0.3,
    twoSided: true,
    source: `Fresnel grasa / músculo 0,138 (TISSUES); ${WALL_ROUGH}`,
  },
  [Interface.ObliquePlane]: {
    name: 'plano entre los oblicuos externo e interno',
    sides: [Tissue.Muscle, Tissue.Muscle],
    floor: 0.08,
    roughnessMm: 0.075,
    slopeRms: 0.3,
    twoSided: true,
    source: `${INTERMUSCULAR}; ${WALL_ROUGH}`,
  },
  [Interface.TransversusPlane]: {
    name: 'plano entre el oblicuo interno y el transverso',
    sides: [Tissue.Muscle, Tissue.Muscle],
    floor: 0.08,
    roughnessMm: 0.075,
    slopeRms: 0.3,
    twoSided: true,
    source: `${INTERMUSCULAR}; ${WALL_ROUGH}`,
  },
  [Interface.Transversalis]: {
    name: 'fascia transversalis (músculo / grasa preperitoneal)',
    sides: [Tissue.Muscle, Tissue.Fat],
    floor: 0,
    roughnessMm: 0.075,
    slopeRms: 0.3,
    twoSided: true,
    source: `Fresnel músculo / grasa 0,138 (TISSUES); ${WALL_ROUGH}`,
  },
  [Interface.Peritoneum]: {
    name: 'peritoneo parietal (grasa preperitoneal / víscera)',
    sides: [Tissue.Fat, Tissue.Liver],
    floor: 0,
    roughnessMm: 0.08,
    slopeRms: 0.4,
    twoSided: false,
    source:
      'Fresnel grasa / hígado 0,132 (TISSUES); cara irregular por los lóbulos de la grasa preperitoneal (σz 0,08, s 0,4) [ESTIMADO]: junto al hígado su eco y el de la cápsula quedan a 0,7 mm y se ven como una línea, calibrada en el rango de la cápsula de la decisión 57 (gemelo 1,82–1,83 a 0–20°; con σz 0,06, 1,88–1,97; con σz 0,04 y s 0,3, 2,24–2,40)',
  },
  [Interface.RibCortex]: {
    name: 'cortical costal',
    sides: [Tissue.Muscle, Tissue.Bone],
    floor: 0,
    roughnessMm: 0.045,
    slopeRms: 0.15,
    twoSided: false,
    source:
      'Fresnel músculo / hueso 0,59 (TISSUES, IT’IS); s 0,15 y σz 0,045 (periostio y cortical algo irregulares a 3,5 MHz) [ESTIMADO]: su parte coherente queda bajo la de la pleura parietal (σz 0,05, |R| ≈ 1), la cara más brillante de la tabla (decisión 61); coherencia de curvatura de su sección',
  },
  [Interface.Perichondrium]: {
    name: 'pericondrio',
    sides: [Tissue.Cartilage, Tissue.Muscle],
    floor: 0.025,
    roughnessMm: 0.06,
    slopeRms: 0.3,
    twoSided: false,
    source:
      'Fresnel cartílago / músculo 0,021 (TISSUES); lámina densa de colágeno: suelo 0,025, σz 0,06 y s 0,3 como las fascias [ESTIMADO]: su eco especular (K·|R|·Λ·χ a 2,5 MHz) queda en 9,8 dB a 0° y 5,9 a 30°; con el suelo 0,06, σz 0,03 y s 0,2 (25,8 y 10,6), en la subxifoidea los cortes de los cartílagos del reborde eran una cadena de rizos blancos (capturas con GPU, 25-09-2026)',
  },
};

/** Reflectividad efectiva de incidencia normal: max(|R_Fresnel|, suelo); 0 sin cara. */
export function interfaceReflectivity(i: Interface): number {
  if (i === Interface.None) return 0;
  const p = INTERFACES[i];
  return Math.max(Math.abs(reflectionCoefficient(p.sides[0], p.sides[1])), p.floor);
}

/** Cara de la luz de un vaso: la VCI y la porta tienen la suya; el resto, arteria o vena. */
export function interfaceOfVessel(id: VesselId, wallTissue: Tissue): Interface {
  if (VESSEL_META[id].system === 'ivc') return Interface.IvcLumen;
  if (wallTissue === Tissue.VesselWallPortal) return Interface.PortalLumen;
  return VESSEL_META[id].kind === 'artery' ? Interface.ArteryLumen : Interface.VeinLumen;
}
