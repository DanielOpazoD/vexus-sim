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
  // Ramas viscerales de la aorta (decisión 69): tronco celíaco con la esplénica y la mesentérica superior; no son
  // VExUS, pero distinguen la aorta de la VCI (la «gaviota» y la AMS)
  'celiacTrunk',
  'splenicArtery',
  'sma',
  'leftGastricArtery',
  'commonHepaticArtery',
  'ima',
  'iliacArteryRight',
  'iliacArteryLeft',
  'internalIliacArteryRight',
  'internalIliacArteryLeft',
  'externalIliacArteryRight',
  'externalIliacArteryLeft',
  'iliacVeinRight',
  'iliacVeinLeft',
  'internalIliacVeinRight',
  'internalIliacVeinLeft',
  'externalIliacVeinRight',
  'externalIliacVeinLeft',
  'portalSmv',
  'portalSplenic',
] as const;

export type VesselId = (typeof VESSEL_IDS)[number];

export type VesselKind = 'vein' | 'artery';

/** Sistema vascular: decide calibre dinámico, aspecto y lectura; nunca el prefijo del id. */
export type VesselSystem =
  | 'ivc'
  | 'hepaticVein'
  | 'portal'
  | 'hepaticArtery'
  | 'aorta'
  | 'visceralArtery'
  | 'systemicArtery'
  | 'systemicVein'
  | 'renalArtery'
  | 'renalVein'
  | 'interlobarArtery'
  | 'interlobarVein';

/** Qué escala de calibre dicta la fisiología a este vaso (`VesselCaliber.radiusScale`). */
export type CaliberLaw = 'ivc' | 'hepaticVein' | 'portal' | 'fixed';

export interface VesselMeta {
  system: VesselSystem;
  kind: VesselKind;
  caliber: CaliberLaw;
}

const meta = (system: VesselSystem): VesselMeta => ({
  system,
  kind: system === 'aorta' || system.endsWith('Artery') || system === 'hepaticArtery' ? 'artery' : 'vein',
  caliber: system === 'ivc' ? 'ivc' : system === 'hepaticVein' ? 'hepaticVein' : system === 'portal' ? 'portal' : 'fixed',
});

/**
 * Metadatos de cada vaso (Fase 1): una sola tabla tipada sustituye a los `startsWith('ivc')`
 * repartidos por anatomía, renderer, corte y navegador 3D. Añadir un vaso sin su fila no
 * compila (`Record<VesselId, …>`).
 */
export const VESSEL_META: Readonly<Record<VesselId, VesselMeta>> = {
  ivcSupra: meta('ivc'),
  ivcInfra: meta('ivc'),
  hvRight: meta('hepaticVein'),
  hvRightAnterior: meta('hepaticVein'),
  hvRightPosterior: meta('hepaticVein'),
  hvMiddle: meta('hepaticVein'),
  hvMiddleTributary: meta('hepaticVein'),
  hvLeft: meta('hepaticVein'),
  hvLeftTributary: meta('hepaticVein'),
  hvCommonTrunk: meta('hepaticVein'),
  pvTrunk: meta('portal'),
  pvRight: meta('portal'),
  pvRightAnterior: meta('portal'),
  pvRightPosterior: meta('portal'),
  pvLeft: meta('portal'),
  pvLeftLateral: meta('portal'),
  pvLeftMedial: meta('portal'),
  hepaticArtery: meta('hepaticArtery'),
  aorta: meta('aorta'),
  renalArteryRight: meta('renalArtery'),
  renalVeinRight: meta('renalVein'),
  renalArteryLeft: meta('renalArtery'),
  renalVeinLeft: meta('renalVein'),
  interlobarArtery1: meta('interlobarArtery'),
  interlobarArtery2: meta('interlobarArtery'),
  interlobarArtery3: meta('interlobarArtery'),
  interlobarVein1: meta('interlobarVein'),
  interlobarVein2: meta('interlobarVein'),
  interlobarVein3: meta('interlobarVein'),
  celiacTrunk: meta('visceralArtery'),
  splenicArtery: meta('visceralArtery'),
  sma: meta('visceralArtery'),
  leftGastricArtery: meta('visceralArtery'),
  commonHepaticArtery: meta('visceralArtery'),
  ima: meta('visceralArtery'),
  iliacArteryRight: meta('systemicArtery'),
  iliacArteryLeft: meta('systemicArtery'),
  internalIliacArteryRight: meta('systemicArtery'),
  internalIliacArteryLeft: meta('systemicArtery'),
  externalIliacArteryRight: meta('systemicArtery'),
  externalIliacArteryLeft: meta('systemicArtery'),
  iliacVeinRight: meta('systemicVein'),
  iliacVeinLeft: meta('systemicVein'),
  internalIliacVeinRight: meta('systemicVein'),
  internalIliacVeinLeft: meta('systemicVein'),
  externalIliacVeinRight: meta('systemicVein'),
  externalIliacVeinLeft: meta('systemicVein'),
  portalSmv: meta('portal'),
  portalSplenic: meta('portal'),
};

export function vesselKind(id: VesselId): VesselKind {
  return VESSEL_META[id].kind;
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

/**
 * Fracción del caudal de un riñón que lleva cada interlobar representada.
 * Las tres ramas derechas representan 15 %; el 85 % restante sigue en el árbol
 * no representado. No cambia el caudal renal total ni la red presión-volumen.
 * Calibración provisional del territorio/área, no una proporción anatómica medida
 * en humanos (decisión 127; NEEDS_CALIBRATION).
 */
export const INTERLOBAR_FLOW_SHARE = 0.05;

/**
 * Áreas luminales de referencia (mm²) del avatar basal, derivadas de los radios
 * de la escena anatómica en el punto de muestreo habitual. Las provee la
 * anatomía; aquí solo se declara el contrato.
 */
export type VesselAreas = Record<VesselId, number>;

/** Estimated radii of the added main branches; anatomy overrides these from its tube definitions. */
export const ABDOMINAL_VESSEL_RADII = {
  leftGastricArtery: 1.8,
  commonHepaticArtery: 2.4,
  ima: 2.0,
  iliacArteryRight: 5.0,
  iliacArteryLeft: 5.0,
  internalIliacArteryRight: 3.0,
  internalIliacArteryLeft: 3.0,
  externalIliacArteryRight: 4.0,
  externalIliacArteryLeft: 4.0,
  iliacVeinRight: 6.0,
  iliacVeinLeft: 6.0,
  internalIliacVeinRight: 4.0,
  internalIliacVeinLeft: 4.0,
  externalIliacVeinRight: 5.0,
  externalIliacVeinLeft: 5.0,
  portalSmv: 4.5,
  portalSplenic: 3.5,
} as const;
