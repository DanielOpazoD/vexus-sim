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
  RenalFascia = 29,
}

export const INTERFACE_COUNT = 30;
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
  [Interface.RenalFascia]: 'IF_RENAL_FASCIA',
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

/** Compact rows retain named properties at runtime; avoids repeated keys in shipped tables. */
const face = (
  name: string,
  sides: readonly [Tissue, Tissue],
  floor: number,
  roughnessMm: number,
  slopeRms: number,
  twoSided: boolean,
): InterfaceProps => ({ name, sides, floor, roughnessMm, slopeRms, twoSided });

/** Tabla de caras, en el orden del enum (la del plan de la decisión 57). */
export const INTERFACES: Readonly<Record<Interface, InterfaceProps>> = {
  [Interface.RenalFascia]: face('fascia renal', [Tissue.SoftCapsule, Tissue.PerirenalFat], 0, 0.075, 0.3, false),
  [Interface.PancreasCapsule]: face('envolvente pancreática', [Tissue.Pancreas, Tissue.MesentericFat], 0.008, 0.06, 0.25, false),
  [Interface.SpleenCapsule]: face('cápsula esplénica', [Tissue.Spleen, Tissue.SoftCapsule], 0.02, 0.04, 0.22, false),
  [Interface.BladderLumen]: face('urotelio / orina', [Tissue.BladderWall, Tissue.Fluid], 0.015, 0.04, 0.22, true),
  [Interface.None]: face('ninguna', [Tissue.Air, Tissue.Air], 0, 0, 1, true),
  [Interface.VeinLumen]: face('luz venosa (pared fina)', [Tissue.VesselWallThin, Tissue.Blood], 0.025, 0.02, 0.14, true),
  [Interface.IvcLumen]: face('luz de la VCI', [Tissue.VesselWallThin, Tissue.Blood], 0.025, 0.02, 0.18, true),
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
  [Interface.ArteryLumen]: face('luz arterial', [Tissue.ArteryWall, Tissue.Blood], 0.04, 0.02, 0.21, true),
  [Interface.DuctLumen]: face('luz biliar', [Tissue.BileDuctWall, Tissue.Fluid], 0, 0.02, 0.21, true),
  [Interface.GallbladderLumen]: face('luz vesicular', [Tissue.BileDuctWall, Tissue.Fluid], 0, 0.03, 0.21, true),
  [Interface.LiverCapsule]: face('cápsula hepática', [Tissue.LiverCapsule, Tissue.Muscle], 0.03, 0.03, 0.2, false),
  [Interface.DiaphragmLiver]: face('cara hepática del diafragma', [Tissue.LiverCapsule, Tissue.Diaphragm], 0.02, 0.03, 0.21, false),
  [Interface.Pleura]: face('pleura (diafragma / pulmón)', [Tissue.Diaphragm, Tissue.Lung], 0, 0.09, 0.21, true),
  [Interface.RenalCapsule]: face('cápsula renal', [Tissue.PerirenalFat, Tissue.RenalCapsule], 0, 0.06, 0.2, true),
  [Interface.PerirenalFat]: face('grasa perirrenal (Morison)', [Tissue.Liver, Tissue.PerirenalFat], 0, 0.06, 0.2, false),
  [Interface.PleuraWall]: face('pleura parietal (pared / pulmón de la cortina)', [Tissue.Muscle, Tissue.Lung], 0, 0.05, 0.15, false),
  [Interface.SkinFat]: face('dermis / grasa subcutánea', [Tissue.Skin, Tissue.Fat], 0, 0.075, 0.35, true),
  [Interface.Scarpa]: face('fascia de Scarpa (capa membranosa)', [Tissue.Fat, Tissue.Fat], 0.07, 0.075, 0.3, true),
  [Interface.DeepFascia]: face(
    'fascia profunda (vaina anterior del recto, aponeurosis del oblicuo externo)',
    [Tissue.Fat, Tissue.Muscle],
    0,
    0.075,
    0.3,
    true,
  ),
  [Interface.ObliquePlane]: face('plano entre los oblicuos externo e interno', [Tissue.Muscle, Tissue.Muscle], 0.08, 0.075, 0.3, true),
  [Interface.TransversusPlane]: face(
    'plano entre el oblicuo interno y el transverso',
    [Tissue.Muscle, Tissue.Muscle],
    0.08,
    0.075,
    0.3,
    true,
  ),
  [Interface.Transversalis]: face('fascia transversalis (músculo / grasa preperitoneal)', [Tissue.Muscle, Tissue.Fat], 0, 0.075, 0.3, true),
  [Interface.Peritoneum]: face('peritoneo parietal (grasa preperitoneal / víscera)', [Tissue.Fat, Tissue.Liver], 0, 0.08, 0.4, false),
  [Interface.RibCortex]: face('cortical costal', [Tissue.Muscle, Tissue.Bone], 0, 0.045, 0.15, false),
  [Interface.VertebralCortex]: face('cortical vertebral', [Tissue.Muscle, Tissue.Vertebra], 0, 0.045, 0.15, false),
  [Interface.Perichondrium]: face('pericondrio', [Tissue.Cartilage, Tissue.Muscle], 0.025, 0.06, 0.3, false),
  [Interface.Pericardium]: face('pericardio', [Tissue.Mediastinum, Tissue.Myocardium], 0.15, 0.06, 0.2, false),
  // Interfaces intestinales: Fresnel, rugosidad y pendiente estimadas para revisión visual.
  [Interface.BowelLumen]: face('interfaz mucosa-luz intestinal', [Tissue.Bowel, Tissue.Fluid], 0, 0.035, 0.28, true),
  [Interface.BowelSerosa]: face('serosa-grasa mesentérica', [Tissue.Bowel, Tissue.MesentericFat], 0, 0.06, 0.28, true),
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
