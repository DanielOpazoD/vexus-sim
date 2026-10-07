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
 *  - cápsula hepática: la cápsula, salvo junto al diafragma (cara del diafragma), a la grasa perirrenal o a
 *    una lámina de una grasa fina (cara de Morison, de la grasa) o a la pared vesicular (decisión 67);
 *  - cara hepática del diafragma: la mitad abdominal del diafragma (la pleural la dibuja el espejo
 *    exacto de la pasada A);
 *  - cápsula renal externa: la cápsula renal y la mitad interna de la grasa perirrenal (dos lados);
 *  - cara externa de la grasa perirrenal (Morison): la mitad externa de la grasa, donde es fina o donde apoya
 *    el hígado (decisión 68);
 *  - pleura parietal bajo la pared (decisión 61): no sale de `classify`; la dibuja la pasada B desde el
 *    cruce exacto de A0, del lado de la pared (su dueña), con la serie de reverberaciones;
 *  - capas de la pared (decisión 62, `organs/wall.ts`): cada muestra de piel, grasa, músculo o grasa
 *    preperitoneal dibuja la cara de su capa más cercana (dermis/grasa, Scarpa, fascia profunda, los dos
 *    planos intermusculares, transversalis: dos lados; peritoneo parietal: la grasa preperitoneal, un lado);
 *  - cortical costal: el tejido blando adyacente a la costilla ósea, incluso cuando queda más profunda que la pared estimada (un lado: el hueso atenúa su
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
  /** Pericardio junto al epicardio (decisión 85): lo dibuja la capa del pericardio (un lado). */
  Pericardium = 22,
  BowelLumen = 23,
  BowelSerosa = 24,
  VertebralCortex = 25,
  PancreasCapsule = 26,
  SpleenCapsule = 27,
  BladderLumen = 28,
}

export const INTERFACE_COUNT = 29;
/** Banda material conservadora para la cortical; el perfil efectivo mide menos de 1 mm. */
export const VERTEBRAL_FIELD_REACH_MM = 5;
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

/** Cortical ósea: misma iluminación exterior y ventana angular en costilla y vértebra. */
export function isBoneCortex(i: Interface): boolean {
  return i === Interface.RibCortex || i === Interface.VertebralCortex;
}

/**
 * Caras con coherencia de curvatura (decisión 57): las de tubo y, desde la decisión 62, las de costilla (un
 * cilindro de sección elíptica, con la curvatura de su sección, `ribCurvature`).
 */
export function isBowelInterface(i: Interface): boolean {
  return i === Interface.BowelLumen || i === Interface.BowelSerosa;
}
export function hasCurvatureCoherence(i: Interface): boolean {
  return (i !== Interface.None && i <= LAST_TUBE_INTERFACE) || isRibInterface(i) || isBowelInterface(i) || i === Interface.VertebralCortex;
}
/**
 * Cápsula hepática y grasa perirrenal a ≤ esto (mm) son la misma cara (Morison): la dibuja la grasa,
 * que es su única dueña. La cápsula toca la grasa en la impresión renal (distancia mediana 0,003 mm); en el redondeo
 * de la impresión con la cara visceral en cuña (decisión 72) quedan láminas de «intestino» de hasta ~0,6 mm contra
 * grasa gruesa, que con 0,2 mm daban dos líneas paralelas.
 */
export const MORISON_CONTACT_MM = 0.8;
/**
 * La cápsula hepática a ≤ esto (mm) de una grasa perirrenal fina (≤ `PERIRENAL.faceMaxMm`) tampoco dibuja la suya
 * (revisión de la decisión 68): entre ambas solo queda una lámina (el receso de Morison, de 1,2–3 mm en el borde de la
 * impresión renal, grasa retroperitoneal desde la decisión 81) y serían dos líneas paralelas (el 11–14 % de los pasos
 * hígado–grasa de los rayos desde el riñón). La línea de Morison es entonces la de la grasa fina, que desde la decisión 81
 * es la de la cápsula renal. Contra la grasa gruesa, que solo dibuja su cara en contacto, la cápsula hepática sí.
 */
export const MORISON_SLIVER_MM = 3.5;
/**
 * La cápsula hepática que toca la pared de la vesícula (en su fosa) no dibuja su cara: la pared vesicular es una
 * sola línea ecogénica (decisión 67). Holgura sobre la cara externa de la pared, por el redondeo del borde de la fosa.
 */
export const GALLBLADDER_CONTACT_MM = 1.0;
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
  [Interface.Pericardium]: 'IF_PERICARDIUM',
  [Interface.BowelLumen]: 'IF_BOWEL_LUMEN',
  [Interface.BowelSerosa]: 'IF_BOWEL_SEROSA',
  [Interface.VertebralCortex]: 'IF_VERTEBRAL_CORTEX',
  [Interface.PancreasCapsule]: 'IF_PANCREAS_CAPSULE',
  [Interface.SpleenCapsule]: 'IF_SPLEEN_CAPSULE',
  [Interface.BladderLumen]: 'IF_BLADDER_LUMEN',
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
}

/** Tabla de caras, en el orden del enum (la del plan de la decisión 57). */
export const INTERFACES: Readonly<Record<Interface, InterfaceProps>> = {
  [Interface.PancreasCapsule]: {
    name: 'envolvente pancreática',
    sides: [Tissue.Pancreas, Tissue.MesentericFat],
    floor: 0.008,
    roughnessMm: 0.06,
    slopeRms: 0.25,
    twoSided: false,
  },
  [Interface.SpleenCapsule]: {
    name: 'cápsula esplénica',
    sides: [Tissue.Spleen, Tissue.SoftCapsule],
    floor: 0.02,
    roughnessMm: 0.04,
    slopeRms: 0.22,
    twoSided: false,
  },
  [Interface.BladderLumen]: {
    name: 'urotelio / orina',
    sides: [Tissue.BladderWall, Tissue.Fluid],
    floor: 0.015,
    roughnessMm: 0.04,
    slopeRms: 0.22,
    twoSided: true,
  },
  [Interface.None]: {
    name: 'ninguna',
    sides: [Tissue.Air, Tissue.Air],
    floor: 0,
    roughnessMm: 0,
    slopeRms: 1,
    twoSided: true,
  },
  [Interface.VeinLumen]: {
    name: 'luz venosa (pared fina)',
    sides: [Tissue.VesselWallThin, Tissue.Blood],
    floor: 0.025,
    roughnessMm: 0.02,
    slopeRms: 0.14,
    twoSided: true,
  },
  [Interface.IvcLumen]: {
    name: 'luz de la VCI',
    sides: [Tissue.VesselWallThin, Tissue.Blood],
    floor: 0.025,
    roughnessMm: 0.02,
    slopeRms: 0.18,
    twoSided: true,
  },
  [Interface.PortalLumen]: {
    name: 'luz portal (vaina de Glisson)',
    sides: [Tissue.VesselWallPortal, Tissue.Blood],
    // Wider angular response, not a thicker wall (Wachsberg et al., PMID 9401994).
    // Estimated contrast: normal ensemble amplitude rises 5.46 dB, without widening the wall.
    floor: 0.15,
    roughnessMm: 0.03,
    slopeRms: 0.4,
    twoSided: true,
  },
  [Interface.ArteryLumen]: {
    name: 'luz arterial',
    sides: [Tissue.ArteryWall, Tissue.Blood],
    floor: 0.04,
    roughnessMm: 0.02,
    slopeRms: 0.21,
    twoSided: true,
  },
  [Interface.DuctLumen]: {
    name: 'luz biliar',
    sides: [Tissue.BileDuctWall, Tissue.Fluid],
    floor: 0,
    roughnessMm: 0.02,
    slopeRms: 0.21,
    twoSided: true,
  },
  [Interface.GallbladderLumen]: {
    name: 'luz vesicular',
    sides: [Tissue.BileDuctWall, Tissue.Fluid],
    floor: 0,
    roughnessMm: 0.03,
    slopeRms: 0.21,
    twoSided: true,
  },
  [Interface.LiverCapsule]: {
    name: 'cápsula hepática',
    sides: [Tissue.LiverCapsule, Tissue.Muscle],
    floor: 0.03,
    roughnessMm: 0.03,
    slopeRms: 0.2,
    twoSided: false,
  },
  [Interface.DiaphragmLiver]: {
    name: 'cara hepática del diafragma',
    sides: [Tissue.LiverCapsule, Tissue.Diaphragm],
    floor: 0.02,
    roughnessMm: 0.03,
    slopeRms: 0.21,
    twoSided: false,
  },
  [Interface.Pleura]: {
    name: 'pleura (diafragma / pulmón)',
    sides: [Tissue.Diaphragm, Tissue.Lung],
    floor: 0,
    roughnessMm: 0.09,
    slopeRms: 0.21,
    twoSided: true,
  },
  [Interface.RenalCapsule]: {
    name: 'cápsula renal',
    sides: [Tissue.PerirenalFat, Tissue.RenalCapsule],
    floor: 0,
    roughnessMm: 0.06,
    slopeRms: 0.2,
    twoSided: true,
  },
  [Interface.PerirenalFat]: {
    name: 'grasa perirrenal (Morison)',
    sides: [Tissue.Liver, Tissue.PerirenalFat],
    floor: 0,
    roughnessMm: 0.06,
    slopeRms: 0.2,
    twoSided: false,
  },
  [Interface.PleuraWall]: {
    name: 'pleura parietal (pared / pulmón de la cortina)',
    sides: [Tissue.Muscle, Tissue.Lung],
    floor: 0,
    roughnessMm: 0.05,
    slopeRms: 0.15,
    twoSided: false,
  },
  [Interface.SkinFat]: {
    name: 'dermis / grasa subcutánea',
    sides: [Tissue.Skin, Tissue.Fat],
    floor: 0,
    roughnessMm: 0.075,
    slopeRms: 0.35,
    twoSided: true,
  },
  [Interface.Scarpa]: {
    name: 'fascia de Scarpa (capa membranosa)',
    sides: [Tissue.Fat, Tissue.Fat],
    floor: 0.07,
    roughnessMm: 0.075,
    slopeRms: 0.3,
    twoSided: true,
  },
  [Interface.DeepFascia]: {
    name: 'fascia profunda (vaina anterior del recto, aponeurosis del oblicuo externo)',
    sides: [Tissue.Fat, Tissue.Muscle],
    floor: 0,
    roughnessMm: 0.075,
    slopeRms: 0.3,
    twoSided: true,
  },
  [Interface.ObliquePlane]: {
    name: 'plano entre los oblicuos externo e interno',
    sides: [Tissue.Muscle, Tissue.Muscle],
    floor: 0.08,
    roughnessMm: 0.075,
    slopeRms: 0.3,
    twoSided: true,
  },
  [Interface.TransversusPlane]: {
    name: 'plano entre el oblicuo interno y el transverso',
    sides: [Tissue.Muscle, Tissue.Muscle],
    floor: 0.08,
    roughnessMm: 0.075,
    slopeRms: 0.3,
    twoSided: true,
  },
  [Interface.Transversalis]: {
    name: 'fascia transversalis (músculo / grasa preperitoneal)',
    sides: [Tissue.Muscle, Tissue.Fat],
    floor: 0,
    roughnessMm: 0.075,
    slopeRms: 0.3,
    twoSided: true,
  },
  [Interface.Peritoneum]: {
    name: 'peritoneo parietal (grasa preperitoneal / víscera)',
    sides: [Tissue.Fat, Tissue.Liver],
    floor: 0,
    roughnessMm: 0.08,
    slopeRms: 0.4,
    twoSided: false,
  },
  [Interface.RibCortex]: {
    name: 'cortical costal',
    sides: [Tissue.Muscle, Tissue.Bone],
    floor: 0,
    roughnessMm: 0.045,
    slopeRms: 0.15,
    twoSided: false,
  },
  [Interface.VertebralCortex]: {
    name: 'cortical vertebral',
    sides: [Tissue.Muscle, Tissue.Vertebra],
    floor: 0,
    roughnessMm: 0.045,
    slopeRms: 0.15,
    twoSided: false,
  },
  [Interface.Perichondrium]: {
    name: 'pericondrio',
    sides: [Tissue.Cartilage, Tissue.Muscle],
    floor: 0.025,
    roughnessMm: 0.06,
    slopeRms: 0.3,
    twoSided: false,
  },
  [Interface.Pericardium]: {
    name: 'pericardio',
    sides: [Tissue.Mediastinum, Tissue.Myocardium],
    floor: 0.15,
    roughnessMm: 0.06,
    slopeRms: 0.2,
    twoSided: false,
  },
  // Interfaces intestinales: Fresnel, rugosidad y pendiente estimadas para revisión visual.
  [Interface.BowelLumen]: {
    name: 'interfaz mucosa-luz intestinal',
    sides: [Tissue.Bowel, Tissue.Fluid],
    floor: 0,
    roughnessMm: 0.035,
    slopeRms: 0.28,
    twoSided: true,
  },
  [Interface.BowelSerosa]: {
    name: 'serosa-grasa mesentérica',
    sides: [Tissue.Bowel, Tissue.MesentericFat],
    floor: 0,
    roughnessMm: 0.06,
    slopeRms: 0.28,
    twoSided: true,
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
