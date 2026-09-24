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
 *  - cara externa de la grasa perirrenal (Morison): la mitad externa de la grasa.
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
}

export const INTERFACE_COUNT = 12;
/** Las caras de tubo van primero (ids ≤ esta): solo ellas llevan coherencia de curvatura. */
export const LAST_TUBE_INTERFACE = Interface.DuctLumen;
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
