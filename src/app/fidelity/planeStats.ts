import type { CompoundStats } from './compound';
import type { DepthProfile, DisplayStats } from './display';
import type { EnvelopeTexture, GrainMm } from './envelope';
import type { DiaphragmBin, FaceSample, WallBin, WallSystem } from './faces';
import type { ShadowStats } from './shadow';
import type { WallStats } from './wall';

/**
 * Métricas de un plano: lo que devuelve `fidelityStats` (`../fidelity.ts`) y las bandas de profundidad en que compara el
 * grano con la PSF.
 */

export interface FidelityBand extends EnvelopeTexture {
  r0: number;
  r1: number;
  /** FWHM lateral de la PSF de dos vías a la profundidad media de la banda (`beamModel.ts`). */
  beamFwhmMm: number;
  /** Grano de la envolvente en dB en los mismos parches (`logEnvelopeGrain`). */
  logGrain: GrainMm;
}

export interface FidelityStats {
  /** La envolvente medida: la de la mirada 0 o, con las miradas del anillo (decisión 58), la compuesta. */
  envelope: EnvelopeTexture;
  bands: FidelityBand[];
  /** Con las miradas del anillo (`opts.looks`): la composición espacial por banda y en la costura. */
  compound?: CompoundStats;
  /**
   * Imagen mostrada; `colorOn` avisa de que la caja de color estaba encendida (el gris leído es el
   * canal rojo y los píxeles con color no son modo B).
   */
  display: {
    liver: DisplayStats;
    /**
     * El mismo hígado puro por bandas de profundidad (`DEPTH_BANDS_MM`), con el grano del gris (`displayGrain`) en el
     * hígado despejado de la banda, puro o no.
     */
    liverBands: (DisplayStats & { r0: number; r1: number; grain: GrainMm })[];
    /**
     * El centro de la luz: sangre de VCI, suprahepáticas y porta a ≥ 1,5 mm de su pared en el plano y a ≥ 1,5 mm
     * más la σ elevacional en 3D (toda la rodaja es sangre). La mediana debe quedar casi negra.
     */
    lumen: DisplayStats;
    /** Fracción de los píxeles del diafragma saturados (≥ 250); NaN si no hay diafragma a la vista. */
    diaphragmSaturated: number;
    /** Sombra ósea (costillas, columna): ver `ShadowStats`. */
    shadow: ShadowStats;
    profile: DepthProfile;
    /** Pared anterior de VCI y suprahepáticas juntas (la tabla histórica del banco). */
    walls: WallBin[];
    /** Banco de interfaces por sistema: VCI, suprahepáticas y porta. */
    wallSystems: Record<WallSystem, WallBin[]>;
    /**
     * Cápsula hepática bajo la pared (músculo o grasa → cápsula; referencia, el hígado de debajo), sin la
     * cara interna de la pared en la ventana del pico.
     */
    capsule: WallBin[];
    /**
     * Los mismos registros con el peritoneo parietal en la ventana (decisión 62): la grasa preperitoneal →
     * hígado. Sus ecos (0,35 mm a cada lado del cruce) se funden en una línea, la que se ve en la imagen y
     * la que medía la cápsula de la decisión 57 (referencias 1,3–2,1 a 0–20°).
     */
    peritoneum: WallBin[];
    /** Hígado → diafragma → pulmón: cara hepática, línea pleural, costura y espejo. */
    diaphragm: DiaphragmBin[];
    /** Morison: hígado → grasa perirrenal → cápsula renal. */
    renalCapsule: WallBin[];
    /** Fracción de píxeles saturados (≥ 250) a ≤ 1 mm de cada cara; NaN si no está a la vista. */
    faceSaturated: { diaphragm: number; morison: number; gallbladder: number };
    /** Pared torácica y abdominal (decisión 62): líneas brillantes, capas y cortical costal. */
    wall: WallStats;
    colorOn: boolean;
  } | null;
  /** Con `opts.samples`: un registro por línea y pared medida, para agregar planos con `summarizeFaces`. */
  faceSamples?: FaceSample[];
}

/** Bandas de profundidad (mm) en que se compara el grano lateral con la PSF. */
export const DEPTH_BANDS_MM = [
  [20, 60],
  [60, 100],
  [100, 140],
  [140, 180],
] as const;
