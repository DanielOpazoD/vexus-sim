/**
 * Identidad fisiológica de los vasos (independiente de su geometría y de su
 * apariencia ecográfica, base B). La dirección positiva de cada vaso es su
 * sentido fisiológico (D.1): hacia el corazón en cava, suprahepáticas y venas
 * renales; hacia el hígado en porta; hacia el parénquima en arterias.
 */
export const VESSEL_IDS = [
  'ivcSupra',
  'ivcInfra',
  // Suprahepáticas: tres troncos con tributarias; media e izquierda confluyen en un
  // tronco común corto antes de la cava (variante más frecuente, B.2)
  'hvRight',
  'hvRightAnterior',
  'hvRightPosterior',
  'hvMiddle',
  'hvMiddleTributary',
  'hvLeft',
  'hvLeftTributary',
  'hvCommonTrunk',
  // Porta: tronco, ramas derecha (anterior/posterior) e izquierda (porción
  // umbilical, ramas lateral II–III y medial IV)
  'pvTrunk',
  'pvRight',
  'pvRightAnterior',
  'pvRightPosterior',
  'pvLeft',
  'pvLeftLateral',
  'pvLeftMedial',
  'hepaticArtery',
  'aorta',
  // Riñones: arteria y vena renal de cada lado; interlobares solo en el derecho
  // (sitio de medición del VExUS)
  'renalArteryRight',
  'renalVeinRight',
  'renalArteryLeft',
  'renalVeinLeft',
  'interlobarArtery1',
  'interlobarArtery2',
  'interlobarArtery3',
  'interlobarVein1',
  'interlobarVein2',
  'interlobarVein3',
] as const;

export type VesselId = (typeof VESSEL_IDS)[number];

export type VesselKind = 'vein' | 'artery';

export function vesselKind(id: VesselId): VesselKind {
  return id === 'aorta' || id === 'hepaticArtery' || id.includes('Artery') ? 'artery' : 'vein';
}

export type HepaticVeinId = Extract<VesselId, `hv${string}`>;
export type PortalVeinId = Extract<VesselId, `pv${string}`>;
export type RenalVesselId = Extract<VesselId, `renal${string}` | `interlobar${string}`>;

/** Fracción del caudal suprahepático total que lleva cada tramo (conservación: B/D). */
export const HV_FLOW_SHARE: Record<HepaticVeinId, number> = {
  hvRight: 0.45,
  hvRightAnterior: 0.2,
  hvRightPosterior: 0.2,
  hvMiddle: 0.35,
  hvMiddleTributary: 0.15,
  hvLeft: 0.2,
  hvLeftTributary: 0.1,
  hvCommonTrunk: 0.55,
};

/** Fracción del caudal portal que lleva cada tramo. */
export const PV_FLOW_SHARE: Record<PortalVeinId, number> = {
  pvTrunk: 1,
  pvRight: 0.6,
  pvRightAnterior: 0.3,
  pvRightPosterior: 0.3,
  pvLeft: 0.4,
  pvLeftLateral: 0.2,
  pvLeftMedial: 0.15,
};

/** Fracción del caudal renal (por riñón) que lleva cada vaso interlobar modelado. */
export const INTERLOBAR_FLOW_SHARE = 0.12;

/**
 * Áreas luminales de referencia (mm²) del avatar basal, derivadas de los radios
 * de la escena anatómica en el punto de muestreo habitual. Las provee la
 * anatomía; aquí solo se declara el contrato.
 */
export type VesselAreas = Record<VesselId, number>;
