/**
 * Propiedades acústicas por tejido (base E.2, tabla IT'IS V5.0 redondeada;
 * atenuación α(1 MHz) en dB/cm y exponente b; c en m/s; ρ en kg/m³). Las
 * amplitudes de retrodispersión relativas son [EXTRAPOLACIÓN PROPIA] /
 * NEEDS_CALIBRATION: la base solo aporta BSC de hígado y riñón (E.3); el resto se
 * fijó para revisión visual. Las reflexiones de las caras lisas salen de Z = ρc
 * (`reflectionCoefficient`) y de la tabla de caras (`anatomy/interfaces.ts`, decisión 57).
 *
 * El índice numérico de cada tejido se comparte con el shader (uniform arrays).
 */
export enum Tissue {
  Air = 0,
  Skin = 1,
  Fat = 2,
  Muscle = 3,
  Liver = 4,
  LiverCapsule = 5,
  Blood = 6,
  VesselWallPortal = 7,
  VesselWallThin = 8,
  Diaphragm = 9,
  Lung = 10,
  Bone = 11,
  Bowel = 12,
  BowelGas = 13,
  Fluid = 14,
  ArteryWall = 15,
  Cartilage = 16,
  RenalCortex = 17,
  RenalMedulla = 18,
  RenalSinus = 19,
  PerirenalFat = 20,
  BileDuctWall = 21,
  Vertebra = 22,
  /** Ligamento redondo / falciforme: grasa y fibra en la fisura umbilical (foco ecogénico). */
  LigamentumTeres = 23,
  /** Ligamento venoso: lámina fibrosa entre el caudado y el segmento II (línea ecogénica). */
  LigamentumVenosum = 24,
  /** Cápsula renal: línea ecogénica fina entre la grasa perirrenal y la corteza. */
  RenalCapsule = 25,
  /** Pelvis renal: orina, anecoica, en el centro del seno. */
  RenalPelvis = 26,
}

export const TISSUE_COUNT = 27;

/**
 * Nombre de cada tejido en GLSL (`#define T_… índice`). Se genera desde aquí
 * (`anatomy/gpu/anatomy.glsl.ts`) para que TS y GPU no puedan divergir:
 * un tejido nuevo sin nombre GLSL es un error de compilación de TypeScript.
 */
export const TISSUE_GLSL_NAME: Record<Tissue, string> = {
  [Tissue.Air]: 'T_AIR',
  [Tissue.Skin]: 'T_SKIN',
  [Tissue.Fat]: 'T_FAT',
  [Tissue.Muscle]: 'T_MUSCLE',
  [Tissue.Liver]: 'T_LIVER',
  [Tissue.LiverCapsule]: 'T_CAPSULE',
  [Tissue.Blood]: 'T_BLOOD',
  [Tissue.VesselWallPortal]: 'T_WALL_PORTAL',
  [Tissue.VesselWallThin]: 'T_WALL_THIN',
  [Tissue.Diaphragm]: 'T_DIAPHRAGM',
  [Tissue.Lung]: 'T_LUNG',
  [Tissue.Bone]: 'T_BONE',
  [Tissue.Bowel]: 'T_BOWEL',
  [Tissue.BowelGas]: 'T_BOWELGAS',
  [Tissue.Fluid]: 'T_FLUID',
  [Tissue.ArteryWall]: 'T_ARTERYWALL',
  [Tissue.Cartilage]: 'T_CARTILAGE',
  [Tissue.RenalCortex]: 'T_RENAL_CORTEX',
  [Tissue.RenalMedulla]: 'T_RENAL_MEDULLA',
  [Tissue.RenalSinus]: 'T_RENAL_SINUS',
  [Tissue.PerirenalFat]: 'T_PERIRENAL',
  [Tissue.BileDuctWall]: 'T_BILEWALL',
  [Tissue.Vertebra]: 'T_VERTEBRA',
  [Tissue.LigamentumTeres]: 'T_LIG_TERES',
  [Tissue.LigamentumVenosum]: 'T_LIG_VENOSUM',
  [Tissue.RenalCapsule]: 'T_RENAL_CAPSULE',
  [Tissue.RenalPelvis]: 'T_RENAL_PELVIS',
};

/** Lámina diafragmática bajo la cúpula (mm); la misma en TS, GLSL y el navegador 3D. */
export const DIAPHRAGM_THICKNESS_MM = 2.5;
/** Cápsula hepática (mm) al borde del parénquima. */
export const LIVER_CAPSULE_MM = 0.8;
/** Tope de la distancia a la frontera del intestino (el «resto» de la clasificación), mm. */
export const BOWEL_BD_CAP_MM = 5;

export interface TissueProps {
  name: string;
  /** Velocidad del sonido, m/s (IT'IS). */
  c: number;
  /** Densidad, kg/m³. */
  rho: number;
  /** Atenuación a 1 MHz, dB/cm. */
  alpha1: number;
  /** Exponente de frecuencia. */
  b: number;
  /** Amplitud relativa de retrodispersión difusa (hígado = 1). */
  backscatter: number;
  /** Tejido gaseoso: reflexión casi total y reverberación. */
  gas: boolean;
  /** Hueso: reflexión fuerte y sombra limpia. */
  bone: boolean;
  /**
   * Grumos de dispersores (σ log-uniforme de la potencia en células de 1,2 mm; 0 u omitido = moteado
   * plenamente desarrollado). Pocos dispersores dominantes: grasa del seno y perirrenal (decisión 56).
   */
  speckleClump?: number;
}

export const TISSUES: TissueProps[] = [
  { name: 'aire', c: 343, rho: 1.16, alpha1: 0.0034, b: 2, backscatter: 0, gas: true, bone: false },
  { name: 'piel', c: 1600, rho: 1100, alpha1: 0.9, b: 1.05, backscatter: 1.4, gas: false, bone: false },
  // Pared (decisión 62): la retrodispersión es la del interior del lóbulo de grasa (0,08: con la falda de
  // los septos y la mezcla en elevación, el interior mostrado queda a 0,52–0,58 del gris del hígado) y del
  // músculo entre estrías (0,35), hipoecoicos en las referencias; los septos, las estrías y las fascias los añaden
  // `ultrasound/wallTexture.ts` y las caras de `anatomy/interfaces.ts`. La grasa es la subcutánea y la
  // preperitoneal (la cara interna de la pared).
  { name: 'grasa de la pared', c: 1440, rho: 911, alpha1: 0.379, b: 1.086, backscatter: 0.08, gas: false, bone: false, speckleClump: 0.5 },
  { name: 'músculo', c: 1588, rho: 1090, alpha1: 0.617, b: 1.083, backscatter: 0.35, gas: false, bone: false },
  { name: 'hígado', c: 1586, rho: 1079, alpha1: 0.601, b: 1, backscatter: 1.0, gas: false, bone: false },
  { name: 'cápsula hepática', c: 1586, rho: 1079, alpha1: 0.601, b: 1, backscatter: 1.3, gas: false, bone: false },
  { name: 'sangre', c: 1578, rho: 1050, alpha1: 0.206, b: 1.05, backscatter: 0.008, gas: false, bone: false },
  { name: 'pared portal (periportal)', c: 1586, rho: 1079, alpha1: 0.7, b: 1, backscatter: 2.6, gas: false, bone: false },
  { name: 'pared venosa fina', c: 1586, rho: 1079, alpha1: 0.6, b: 1, backscatter: 0.7, gas: false, bone: false },
  { name: 'diafragma', c: 1588, rho: 1090, alpha1: 0.617, b: 1.083, backscatter: 1.2, gas: false, bone: false },
  { name: 'pulmón (gas)', c: 343, rho: 1.16, alpha1: 0.0034, b: 2, backscatter: 0, gas: true, bone: false },
  // Hueso: c y ρ de IT'IS; la atenuación efectiva de una costilla (cortical + esponjosa, con su
  // dispersión) es la de las tablas clínicas, 13–26 dB/cm a 1 MHz (Bushberg, Essential Physics of
  // Medical Imaging, tabla de atenuaciones): la de IT'IS para cortical pura (4,7) dejaba pasar ~25 dB
  // tras una costilla y el tejido seguía visible dentro de la sombra (decisión 54).
  { name: 'hueso cortical', c: 3515, rho: 1908, alpha1: 20, b: 1, backscatter: 0.9, gas: false, bone: true },
  { name: 'intestino (pared/contenido)', c: 1570, rho: 1050, alpha1: 0.7, b: 1, backscatter: 0.9, gas: false, bone: false },
  { name: 'gas intestinal', c: 343, rho: 1.16, alpha1: 0.0034, b: 2, backscatter: 0, gas: true, bone: false },
  { name: 'líquido (bilis/ascitis)', c: 1482, rho: 994, alpha1: 0.0022, b: 1, backscatter: 0.002, gas: false, bone: false },
  { name: 'pared arterial', c: 1586, rho: 1079, alpha1: 0.7, b: 1, backscatter: 1.8, gas: false, bone: false },
  // cartílago hialino: homogéneo e hipoecoico (≈ 0,15), con el pericondrio como cara (decisión 62)
  { name: 'cartílago costal', c: 1640, rho: 1100, alpha1: 0.9, b: 1, backscatter: 0.15, gas: false, bone: false },
  // Riñón (IT'IS: c 1560, ρ 1066, α 0,7·f^1,0). Corteza iso/ligeramente hipoecoica al hígado;
  // médula (pirámides) hipoecoica; seno = grasa + vasos, marcadamente ecogénico (E.3, B.5).
  { name: 'corteza renal', c: 1560, rho: 1066, alpha1: 0.7, b: 1, backscatter: 0.72, gas: false, bone: false },
  { name: 'médula renal', c: 1560, rho: 1066, alpha1: 0.6, b: 1, backscatter: 0.3, gas: false, bone: false },
  { name: 'seno renal', c: 1480, rho: 950, alpha1: 0.5, b: 1.1, backscatter: 2.3, gas: false, bone: false, speckleClump: 1.0 },
  { name: 'grasa perirrenal', c: 1450, rho: 920, alpha1: 0.45, b: 1.1, backscatter: 1.5, gas: false, bone: false, speckleClump: 0.8 },
  { name: 'pared de vía biliar', c: 1586, rho: 1079, alpha1: 0.7, b: 1, backscatter: 2.4, gas: false, bone: false },
  // Vértebra: mismas propiedades que el hueso cortical; tejido aparte solo para rotular «columna»
  { name: 'vértebra', c: 3515, rho: 1908, alpha1: 20, b: 1, backscatter: 0.9, gas: false, bone: true },
  // Ligamento redondo: grasa + tejido fibroso, marcadamente ecogénico (foco brillante en el
  // corte transversal del lóbulo izquierdo, a veces con sombra) [E.3].
  { name: 'ligamento redondo (grasa)', c: 1470, rho: 950, alpha1: 0.6, b: 1.1, backscatter: 2.2, gas: false, bone: false },
  // Ligamento venoso: lámina fibrosa fina, muy ecogénica (línea brillante delante del caudado)
  { name: 'ligamento venoso', c: 1600, rho: 1100, alpha1: 0.8, b: 1, backscatter: 2.6, gas: false, bone: false },
  // Cápsula renal fibrosa (línea brillante que delimita el riñón) y pelvis con orina (anecoica)
  { name: 'cápsula renal', c: 1600, rho: 1100, alpha1: 0.8, b: 1, backscatter: 2.4, gas: false, bone: false },
  { name: 'pelvis renal (orina)', c: 1482, rho: 994, alpha1: 0.0022, b: 1, backscatter: 0.002, gas: false, bone: false },
];

/** Impedancia acústica Z = ρc en MRayl. */
export function impedanceMRayl(t: Tissue): number {
  const p = TISSUES[t];
  return (p.rho * p.c) / 1e6;
}

/** Atenuación de amplitud (dB/cm) a la frecuencia f (MHz): α(f) = α1·f^b. */
export function attenuationDbPerCm(t: Tissue, fMHz: number): number {
  const p = TISSUES[t];
  return p.alpha1 * Math.pow(fMHz, p.b);
}

/** Coeficiente de reflexión de amplitud para incidencia normal entre dos tejidos. */
export function reflectionCoefficient(a: Tissue, b: Tissue): number {
  const za = impedanceMRayl(a);
  const zb = impedanceMRayl(b);
  return (zb - za) / (zb + za);
}
