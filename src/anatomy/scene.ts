import { smoothstep, type Vec3 } from '../core/vec3';
import type { PatientState } from '../physiology/patientState';
import { VESSEL_META, type VesselAreas, type VesselId } from '../physiology/vessels';
import {
  diaphragmHeight,
  orthonormalBasis,
  sdSpine,
  sdDiaphragm,
  sdDiaphragmSlope,
  sdRib,
  sdSphere,
  smoothMax,
  torsoDepth,
  tubeFaceGradient,
  tubeQuery,
  type Spine,
  type Diaphragm,
  type Ellipsoid,
  type Rib,
  type Sphere,
  type Torso,
  type Tube,
  type TubeHit,
} from './primitives';
import { GALLBLADDER_WALL_MM, gallbladderBody, gallbladderSdf, type GallbladderShape } from './organs/gallbladder';
import {
  KIDNEY_RADII,
  KIDNEY_SINUS,
  PERIRENAL,
  RENAL_CAPSULE_MM,
  hilumChannelSdf,
  kidneyLocal,
  kidneyOuterSdf,
  kidneyQuery,
  perirenalOuterSdf,
  perirenalThicknessMm,
  type Kidney,
  type KidneyRegion,
} from './organs/kidney';
import { LIVER_BLEND_MM, liverBaseSdf, liverLobes, liverSdf, visceralFaceDistance, type VisceralFace } from './organs/liver';
import { buildHepaticBranches, buildVesselTree, wallThicknessMm, type DuctDef, type VesselDef } from './vesselTree';

export { wallThicknessMm };
import {
  LIGAMENTUM_VENOSUM,
  UMBILICAL_FISSURE,
  ligamentumVenosumPlane,
  ligamentumVenosumSdf,
  umbilicalFissureSdf,
  type LigamentumVenosum,
  type UmbilicalFissure,
} from './organs/liverLigaments';
import { domeFloor, heartFloor, heartOuterSdf, ivcAtrium, thorax } from './organs/heart';
import { inLungCurtain, inLungRecess, lungCurtainDistance, lungCurtainEdgeMm } from './organs/lungCurtain';
import { retroperitoneum } from './organs/retroperitoneum';
import {
  nearestRib,
  preperitonealMm,
  ribCurvature,
  ribSd,
  ribSearchDepth,
  ribTangent,
  wallArc,
  wallDepths,
  wallFace,
  wallFaceSd,
} from './organs/wall';

export type { DuctDef, VesselDef } from './vesselTree';
import { BOWEL_BD_CAP_MM, DIAPHRAGM_THICKNESS_MM, LIVER_CAPSULE_MM, Tissue } from './tissues';
import {
  FACE_GRADIENT_EPS_MM,
  Interface,
  LAST_TUBE_INTERFACE,
  GALLBLADDER_CONTACT_MM,
  MORISON_CONTACT_MM,
  MORISON_SLIVER_MM,
  interfaceOfVessel,
  isRibInterface,
  isWallLayerInterface,
} from './interfaces';

/**
 * Escena anatómica del avatar adulto de referencia (guía §9): pared abdominal
 * en capas, costillas derechas, diafragma, base pulmonar, hígado en cuña con
 * cápsula, fosa vesicular e impresión renal, vesícula, VCI elíptica, tres
 * suprahepáticas con tributarias y tronco común, porta con ramas de segundo
 * orden, arteria hepática, vía biliar (colédoco, hepáticos, cístico), aorta,
 * riñones con seno, pirámides y vasos (renales e interlobares), columna.
 *
 * Todas las coordenadas son del marco MATERIAL (espiración, sin deformación):
 * +x izquierda del paciente, +y anterior, +z craneal (marco levógiro, decisión 22).
 * Las dimensiones se apoyan en B.1–B.6 de la base (tronco portal 11 mm,
 * suprahepática derecha proximal ≈ 9 mm, VCI basal 16 mm AP, riñón 110 × 55 mm,
 * colédoco ≤ 6 mm) y el resto es [EXTRAPOLACIÓN PROPIA] de un adulto de IMC 25;
 * ningún ángulo o longitud se presenta como dato anatómico medido.
 */

export interface Classification {
  tissue: Tissue;
  /** Distancia con signo a la interfaz más cercana relevante (mm). */
  boundaryDistance: number;
  /** Normal aproximada de esa interfaz (apunta hacia fuera del tejido actual). */
  boundaryNormal: Vec3;
  /**
   * Cara de interfaz que dibuja este punto (decisión 57, `anatomy/interfaces.ts`): la misma que la GPU
   * en `Cls.iface`. `Interface.None` si el punto no es dueño de ninguna.
   */
  interface: Interface;
  /**
   * Valor (mm) de la distancia de esa cara en el punto (`Cls.ifd`; |`faceSdf`| de su geometría); 1e3 sin
   * cara. No siempre es euclídea: la distancia por la normal es, a primer orden, este valor dividido por
   * la norma de su gradiente (`faceGradient`; 1/apScale en las paredes AP de la VCI elíptica).
   */
  interfaceDistance: number;
  vessel: VesselId | null;
  vesselHit: TubeHit | null;
  /** Velocidad relativa a la del vaso `vessel` (ramas procedurales < 1). */
  flowFactor: number;
}

/**
 * Cara geométrica cuya distancia con signo da la normal que usa la GPU (`Cls.n`) en esa cara: la
 * miden el banco de fidelidad (incidencia de paredes y órganos) y la e2e de normales.
 *  - `tube`: la luz del vaso o conducto que contiene el punto en su pared o su luz;
 *  - `liverSurface`: el borde del parénquima (cápsula), recortado por pared y diafragma;
 *  - `dome`: la superficie pleural del diafragma (su cara hepática es paralela);
 *  - `kidneyOuter`: el contorno externo del riñón (cápsula renal);
 *  - `perirenalOuter`: la cara externa de la grasa perirrenal (Morison), el contorno menos su grosor local;
 *  - `gallbladder`: la luz vesicular;
 *  - `pericardium`: el epicardio recortado por la cúpula (decisión 85), la cara interna de la capa del pericardio.
 */
export type FaceGeometry = 'tube' | 'liverSurface' | 'dome' | 'kidneyOuter' | 'perirenalOuter' | 'gallbladder' | 'pericardium';
export const FACE_GEOMETRIES: readonly FaceGeometry[] = [
  'tube',
  'liverSurface',
  'dome',
  'kidneyOuter',
  'perirenalOuter',
  'gallbladder',
  'pericardium',
];

/**
 * Geometría cuya distancia (`faceSdf`) da la cara de interfaz `i`, o null sin cara (o las pleuras: la del
 * espejo y la parietal, que no salen de `classify`). Las caras de la pared y de las costillas (decisión 62)
 * tampoco tienen geometría de `faceSdf`: su distancia es la de su capa (`wallFaceSd`) o la de su costilla
 * (`ribSd`), y `faceGradient` las trata aparte.
 */
export function faceGeometryOf(i: Interface): FaceGeometry | null {
  if (i === Interface.None || i === Interface.Pleura || i === Interface.PleuraWall || isWallLayerInterface(i) || isRibInterface(i))
    return null;
  if (i <= LAST_TUBE_INTERFACE) return 'tube';
  if (i === Interface.GallbladderLumen) return 'gallbladder';
  if (i === Interface.LiverCapsule) return 'liverSurface';
  if (i === Interface.DiaphragmLiver) return 'dome';
  if (i === Interface.PerirenalFat) return 'perirenalOuter';
  if (i === Interface.Pericardium) return 'pericardium';
  return 'kidneyOuter';
}

/**
 * Gradiente de la distancia de la cara que dibuja un punto (`AnatomyScene.faceGradient`, gemelo de
 * `faceGradient` en la GLSL; decisión 57).
 */
export interface FaceGradient {
  /** Dirección del gradiente: la normal de la cara que usa el eco. */
  normal: Vec3;
  /**
   * Norma del gradiente: `interfaceDistance` es el valor de la distancia de la cara, y
   * `interfaceDistance / norm` es, a primer orden, la distancia por la normal (la VCI elíptica: 1/apScale
   * en sus paredes AP; las fusiones suaves de la cápsula: < 1).
   */
  norm: number;
  /**
   * Curvatura circunferencial de la cara de un tubo (1/mm, `tubeFaceGradient`) o de la sección de una
   * costilla (`ribCurvature`, decisión 62); 0 en el resto.
   */
  curvature: number;
  /** Eje del cilindro cuya sección da `curvature` (tubo o costilla); ausente en el resto. */
  axis?: Vec3;
}

/** Resultado de la búsqueda de tubos de `classify`, con el tubo y la escala de radio con que se consultó. */
type TubeFound = { hit: TubeHit; tube: Tube; scale: number };
type BestTube = ({ kind: 'vessel'; def: VesselDef } & TubeFound) | ({ kind: 'duct'; def: DuctDef } & TubeFound);

/** Esfera envolvente de un tubo (para descartes rápidos en CPU y GPU). */
export function tubeBoundingSphere(t: Tube, marginMm: number): { center: Vec3; r: number } {
  const c: Vec3 = [0, 0, 0];
  for (const n of t.nodes) {
    c[0] += n.p[0] / t.nodes.length;
    c[1] += n.p[1] / t.nodes.length;
    c[2] += n.p[2] / t.nodes.length;
  }
  let r = 0;
  for (const n of t.nodes) r = Math.max(r, Math.hypot(n.p[0] - c[0], n.p[1] - c[1], n.p[2] - c[2]) + n.r * 1.6);
  return { center: c, r: r + marginMm };
}

/** Ascenso posterior del arco costal (mm) según el número de costilla: 60 mm la 5.ª, +6 mm por costilla. */
export function ribTiltMm(ribNo: number): number {
  return 60 + 6 * (ribNo - 5);
}

export class AnatomyScene {
  readonly torso: Torso;
  readonly ribs: Rib[];
  readonly diaphragm: Diaphragm;
  readonly spine: Spine;
  /** Lóbulo derecho (voluminoso) y lóbulo izquierdo (aplanado); su unión suave es el hígado. */
  readonly liver: Ellipsoid;
  readonly liverLeft: Ellipsoid;
  readonly liverBlendMm = LIVER_BLEND_MM;
  /** Cara visceral en cuña (módulo `organs/liver`, decisión 72). */
  readonly visceralFace: VisceralFace;
  /**
   * Fisura umbilical (ligamento redondo / falciforme): surco sagital en x = 15 mm (izquierda
   * del paciente) sobre la cara anteroinferior del lóbulo izquierdo, entre el segmento IV y
   * los segmentos II–III; 8 mm de ancho, 14 mm de profundidad desde la superficie, relleno de
   * grasa ecogénica. Solo por delante (y > 0) y en el tercio inferior (z < zMax = −30): en el corte transversal es el foco ecogénico entre los segmentos III y IV.
   */
  readonly umbilicalFissure: UmbilicalFissure;
  /**
   * Fisura del ligamento venoso: lámina fibrosa (1,2 mm de semiespesor) en el plano que va de
   * la porta hepatis a la desembocadura de la suprahepática izquierda, entre el caudado
   * (detrás) y el segmento II (delante). Línea ecogénica clásica del corte subxifoideo.
   */
  readonly ligamentumVenosum: LigamentumVenosum;
  readonly gallbladder: GallbladderShape;
  /** Pared vesicular (mm), ecogénica, entre la luz anecoica y la fosa. */
  readonly gallbladderWallMm = GALLBLADDER_WALL_MM;
  readonly kidneyRight: Kidney;
  readonly kidneyLeft: Kidney;
  /** Bolsas de gas intestinal (confusor; vacío en el avatar de referencia). */
  readonly gasPockets: Sphere[];
  vessels: VesselDef[];
  readonly ducts: DuctDef[];
  readonly vesselById: Map<VesselId, VesselDef>;
  /** Esferas envolventes de vasos y conductos, en el mismo orden que la GPU (vasos, luego conductos). */
  readonly tubeBounds: Array<{ center: Vec3; r: number }>;

  constructor(patient: PatientState) {
    const fat = patient.habitus.subcutaneousFatMm;
    const muscle = patient.habitus.muscleMm;
    // Tronco 32 × 21 cm (adulto de IMC 25): la VCI queda a ≈ 12–13 cm del xifoides
    // la grasa preperitoneal es la parte más honda del espesor muscular del hábito (decisión 62)
    this.torso = { a: 160, b: 105, zMin: -300, zMax: 300, skinMm: 2, fatMm: fat, muscleMm: muscle, preperitonealMm: preperitonealMm(fat) };
    // Referencia craneocaudal: z = 0 en la punta del xifoides (T9–T10). Cúpula derecha
    // en T8–T9 (+45 mm), reborde costal en la línea medioclavicular ≈ −80 mm, unión
    // cavoauricular ≈ +55 mm, hilio hepático ≈ −45 mm (T12–L1) [B.5].
    this.diaphragm = {
      right: { kind: 'dome', x0: -55, y0: -5, rx: 85, ry: 92, apex: 55 },
      left: { kind: 'dome', x0: 70, y0: -5, rx: 70, ry: 85, apex: 25 },
      edgeZ: -50,
      edgeRise: 50,
    };
    // Columna: cuerpo vertebral de 36 mm justo por detrás de cava y aorta (su cara
    // posterior queda ≈ 5 cm de la piel dorsal, como en un adulto); arco posterior con
    // apófisis transversas de 40 mm a cada lado. Las costillas terminan en ellas.
    this.spine = { kind: 'cylinderZ', x0: 0, y0: -46, r: 17, archHalfWidth: 40, archY0: -78, archY1: -58 };
    // Hígado y vesícula: geometría en sus módulos de órgano (organs/liver, organs/gallbladder)
    ({ liver: this.liver, liverLeft: this.liverLeft, visceralFace: this.visceralFace } = liverLobes(patient.liver.sizeFactor));
    this.umbilicalFissure = UMBILICAL_FISSURE;
    this.ligamentumVenosum = LIGAMENTUM_VENOSUM;
    this.gallbladder = gallbladderBody();
    // Riñones: eje largo con el polo superior medial y posterior; hilio anteromedial.
    const bR = orthonormalBasis([0.22, -0.18, 1], [1, 0.25, 0]);
    const bL = orthonormalBasis([-0.22, -0.18, 1], [-1, 0.25, 0]);
    this.kidneyRight = {
      kind: 'kidney',
      center: [-72, -38, -78],
      radii: KIDNEY_RADII,
      ...bR,
      sinusRadii: KIDNEY_SINUS.radii,
      sinusOffset: KIDNEY_SINUS.offsetV,
      hilumRadius: 7,
    };
    this.kidneyLeft = {
      kind: 'kidney',
      center: [78, -36, -70],
      radii: KIDNEY_RADII,
      ...bL,
      sinusRadii: KIDNEY_SINUS.radii,
      sinusOffset: KIDNEY_SINUS.offsetV,
      hilumRadius: 7,
    };
    this.gasPockets = [];
    this.ribs = [];
    // Costillas derechas 5–10: el 7.º cartílago llega al esternón a la altura del xifoides (z 0).
    // Oblicuidad creciente hacia abajo: la cabeza de la 5.ª está en T5 (≈ 6 cm sobre su
    // extremo anterior) y la de la 10.ª en T10, a la altura del xifoides (≈ 9 cm sobre el
    // reborde) — `ribTiltMm`, la misma ley que dibuja el navegador 3D.
    const anterior = [40, 20, 0, -25, -50, -75];
    for (let i = 0; i < anterior.length; i++) {
      this.ribs.push({
        zAnterior: anterior[i],
        tilt: ribTiltMm(5 + i),
        halfWidth: 6,
        halfThickness: 3.2,
        scale: 0.85,
        // cartílago a ±45° de la línea media: la unión costocondral en la línea medioclavicular (x ≈ 96 mm en la
        // elipse de la costilla, 136 × 89 mm), la del reborde costal de las costillas 7–10 (decisión 62)
        cartilageFromPhi: Math.PI / 4,
        rightOnly: true,
      });
    }
    ({ vessels: this.vessels, ducts: this.ducts } = buildVesselTree(this.kidneyRight, this.kidneyLeft));
    // Ramas de 3.º–4.º orden confinadas al hígado (el SDF ya conoce riñón y vesícula); las madres sin hijas en su extremo,
    // afiladas (decisión 87)
    const { branches, parents } = buildHepaticBranches(
      this.vessels,
      (m) => -this.liverInteriorMargin(m),
      7,
      (m) => Math.min(this.liverInteriorMargin(m), this.ligamentumVenosumSdf(m)),
    );
    this.vessels = [...parents, ...branches];
    // Solo los vasos «madre»: las ramas procedurales comparten id y no deben sustituirlos
    this.vesselById = new Map(this.vessels.filter((v) => v.flowFactor === undefined).map((v) => [v.id, v]));
    this.tubeBounds = [
      ...this.vessels.map((v) => tubeBoundingSphere(v.tube, v.wallMm + 2)),
      ...this.ducts.map((d) => tubeBoundingSphere(d.tube, d.wallMm + 2)),
    ];
  }

  /** Distancia con signo a la cara visceral (positiva dentro del hígado, por encima de ella). */
  visceralFaceDistance(m: Vec3): number {
    return visceralFaceDistance(m, this.visceralFace, this.torso, this.wallThickness()).d;
  }

  /**
   * Margen hacia dentro del parénquima hepático REAL (mm): mínimo entre la distancia al
   * contorno del hígado, a la cara interna de la pared y a la lámina diafragmática.
   * Positivo = dentro. Lo usa el árbol vascular procedural para no salir del hígado.
   */
  liverInteriorMargin(m: Vec3): number {
    return Math.min(
      -this.liverSdf(m),
      -torsoDepth(m, this.torso) - this.wallThickness(),
      sdDiaphragm(m, this.diaphragm, this.torso) - DIAPHRAGM_THICKNESS_MM,
    );
  }

  /**
   * Distancia con signo al hígado sin los recortes de cúpula y pared: unión suave
   * de los lóbulos, cara visceral en cuña (borde inferior agudo), impresión renal
   * y fosa vesicular.
   */
  liverSdf(m: Vec3): number {
    return liverSdf(m, this);
  }

  /** Hígado sin la fisura umbilical (lo que la fisura excava se clasifica como ligamento redondo). */
  liverBaseSdf(m: Vec3): number {
    return liverBaseSdf(m, this);
  }

  /**
   * Región de la fisura umbilical (negativa dentro): lámina |x − xF| < hw, a menos de
   * `depthMm` de la superficie hepática (dBase > −depth), anterior (y > 0) y bajo zMax.
   * Misma fórmula en GLSL (`fissureSdf`).
   */
  umbilicalFissureSdf(m: Vec3, dBase: number): number {
    return umbilicalFissureSdf(m, dBase, this.umbilicalFissure);
  }

  /** Áreas de referencia (mm²) para la fisiología (Q/A). */
  vesselAreas(): VesselAreas {
    const out = {} as VesselAreas;
    for (const v of this.vessels) {
      if (v.flowFactor !== undefined) continue; // las ramas procedurales no definen el área de su id
      const r = v.refRadius;
      out[v.id] = Math.PI * r * r * v.tube.apScale;
    }
    return out;
  }

  /** Espesor total de la pared del tronco (mm). */
  wallThickness(): number {
    return this.torso.skinMm + this.torso.fatMm + this.torso.muscleMm;
  }

  /**
   * Profundidad (mm) de un punto MATERIAL bajo la cara interna de la pared: negativa en la pared, 0 en la
   * pleura parietal (gemelo GLSL `insideWallMm`). A0 busca en ella el cruce exacto de la pleura (decisión 61).
   */
  insideWallMm(m: Vec3): number {
    return -torsoDepth(m, this.torso) - this.wallThickness();
  }

  /**
   * El punto MATERIAL es pulmón de la cortina (la lámina bajo la pared), no del tórax bajo la cúpula
   * (decisión 61; gemelo GLSL `inLungCurtain`). Solo tiene sentido donde `classify` da pulmón.
   */
  inLungCurtain(m: Vec3, caliber: VesselCaliber): boolean {
    return inLungCurtain(m, this.insideWallMm(m), caliber.diaphragmCaudalMm);
  }

  /**
   * El punto MATERIAL, si `classify` da pulmón, toca la pared en el receso (la cortina o el tórax por encima de
   * la inserción del diafragma): ahí empieza la pleura parietal (decisión 61; gemelo GLSL `inLungRecess`).
   */
  inLungRecess(m: Vec3): boolean {
    return inLungRecess(m, this.insideWallMm(m));
  }

  /**
   * Distancia (mm) de un punto MATERIAL de la cara interna de la pared al borde del pulmón que la toca en el
   * receso: z − min(borde de la cortina, inserción del diafragma); null fuera de la huella (gemelo GLSL
   * `lungCurtainEdgeMm`, decisión 61).
   */
  lungEdgeMm(m: Vec3, caliber: VesselCaliber): number | null {
    return lungCurtainEdgeMm(m, caliber.diaphragmCaudalMm, diaphragmHeight(m[0], m[1], this.diaphragm, this.torso));
  }

  /**
   * Peso del campo de desplazamiento respiratorio en un punto material: 1 en
   * las vísceras, 0 en pared, costillas y columna (B.4, [EXTRAPOLACIÓN PROPIA]).
   */
  respiratoryWeight(m: Vec3): number {
    const inside = -torsoDepth(m, this.torso) - this.wallThickness();
    const wWall = smoothstep(0, 25, inside);
    const dSpine = Math.hypot(m[0] - this.spine.x0, m[1] - this.spine.y0);
    const wSpine = smoothstep(this.spine.r + 5, this.spine.r + 35, dSpine);
    return wWall * wSpine;
  }

  /**
   * Clasifica un punto MATERIAL. `caliber` aporta las escalas de radio que
   * dicta la fisiología en este instante. Orden de prioridad (el primero que
   * contiene el punto gana): pared → costillas → columna → cortina pulmonar → vasos y conductos →
   * tórax (corazón, pericardio, mediastino o pulmón, decisión 85) / diafragma → vesícula → riñones → hígado → gas →
   * psoas → cuadrado lumbar → grasa retroperitoneal → intestino (decisión 81). Cada paso es un método propio; el mismo orden vive en GLSL
   * (`classifyWith`).
   *
   * `withCurtain = false` es la variante sin la cortina pulmonar (decisión 61): lo que hay detrás de la
   * lámina de pulmón, igual que `classify` en todos los demás puntos. La usan el tejido que se ve en
   * parte a través del borde blando de la cortina y su transmisión (gemelo GLSL `classifyWith(m, false)`).
   * La clasificación sigue siendo binaria: la fracción de aire del haz es de la imagen, no de la anatomía.
   */
  classify(m: Vec3, caliber: VesselCaliber, withCurtain = true): Classification {
    const torso = this.torso;
    const depth = torsoDepth(m, torso);
    if (m[2] < torso.zMin || m[2] > torso.zMax || depth > 0) return NONE;
    const wall = this.classifyWall(m, -depth);
    if (wall.final) return wall.cls;
    const curtain = withCurtain ? this.classifyLungCurtain(m, -depth - wall.wallMm, caliber.diaphragmCaudalMm) : null;
    if (curtain) return curtain;
    const tube = this.classifyTubes(m, caliber);
    const [dDome, slope] = sdDiaphragmSlope(m, this.diaphragm, this.torso);
    const floor = heartFloor(dDome, slope);
    // la VCI que entra en la aurícula derecha (decisión 85): dentro de ella no hay pared que dibujar (antes daba un eco de
    // pared brillante y seguía como un anillo dentro de la cavidad): su pared es sangre de la aurícula y su luz conserva el
    // flujo sin cara; fuera de la aurícula, por encima de su suelo, no hay VCI (gana el corazón)
    const ivc = tube?.interface === Interface.IvcLumen ? ivcAtrium(m, floor) : null;
    if (tube && ivc && ivc.cavity < 0) {
      if (tube.tissue === Tissue.Blood)
        return {
          ...tube,
          boundaryDistance: Math.min(tube.boundaryDistance, -ivc.cavity),
          interface: Interface.None,
          interfaceDistance: NONE.interfaceDistance,
        };
      return { ...NONE, tissue: Tissue.Blood, boundaryDistance: -ivc.cavity };
    }
    if (tube && !ivc?.outside) return ivc ? { ...tube, boundaryDistance: Math.min(tube.boundaryDistance, ivc.cut) } : tube;
    if (dDome < 0) {
      // tórax (decisión 85): el corazón en su saco, el mediastino o el pulmón; la capa del pericardio dibuja su cara
      const t = thorax(m, dDome, floor);
      const face = t.ifd < NONE.interfaceDistance ? { interface: Interface.Pericardium, interfaceDistance: t.ifd } : {};
      // su distancia a la frontera cuenta también la columna y la pared (como el retroperitoneo)
      const bd = Math.min(t.bd, sdSpine(m, this.spine), -depth - wall.wallMm);
      return { ...NONE, tissue: t.tissue, boundaryDistance: bd, ...face };
    }
    if (dDome < DIAPHRAGM_THICKNESS_MM) {
      // la mitad abdominal dibuja la cara hepática; la pleural la dibuja el espejo exacto de la pasada A
      const liverFace = dDome > 0.5 * DIAPHRAGM_THICKNESS_MM;
      return {
        ...NONE,
        tissue: Tissue.Diaphragm,
        boundaryDistance: Math.min(dDome, DIAPHRAGM_THICKNESS_MM - dDome),
        ...(liverFace ? { interface: Interface.DiaphragmLiver, interfaceDistance: DIAPHRAGM_THICKNESS_MM - dDome } : {}),
      };
    }
    const dGb = gallbladderSdf(m, this.gallbladder);
    if (dGb < 0)
      return { ...NONE, tissue: Tissue.Fluid, boundaryDistance: -dGb, interface: Interface.GallbladderLumen, interfaceDistance: -dGb };
    if (dGb < this.gallbladderWallMm)
      return {
        ...NONE,
        tissue: Tissue.BileDuctWall,
        boundaryDistance: Math.min(dGb, this.gallbladderWallMm - dGb),
        interface: Interface.GallbladderLumen,
        interfaceDistance: dGb,
      };
    const kidney = this.classifyKidneys(m);
    if (kidney.cls) return kidney.cls;
    const liver = this.classifyLiver(m, dDome, -depth - wall.wallMm, kidney, dGb - this.gallbladderWallMm);
    if (liver) return liver;
    // Intestino: el «resto». Su distancia a la frontera es la de las interfaces que ganan antes
    // (diafragma, vesícula, hígado, pared, grasa perirrenal, gas; el corazón queda por encima del diafragma); como en el hígado, no
    // cuenta la de los tubos. Con 5 mm fijos el gate volumétrico daba por interior un punto pegado
    // al diafragma que float32 clasificaba al otro lado (CI de #39: Bowel→Diaphragm, 1 de 44 826).
    let bd = Math.min(
      BOWEL_BD_CAP_MM,
      dDome - DIAPHRAGM_THICKNESS_MM,
      dGb - this.gallbladderWallMm,
      this.liverBaseSdf(m),
      -depth - wall.wallMm,
    );
    for (const k of [this.kidneyRight, this.kidneyLeft]) bd = Math.min(bd, perirenalOuterSdf(kidneyLocal(m, k), k));
    for (const g of this.gasPockets) {
      const dg = sdSphere(m, g);
      if (dg < 0) return { ...NONE, tissue: Tissue.BowelGas, boundaryDistance: -dg };
      bd = Math.min(bd, dg);
    }
    // detrás del peritoneo parietal posterior, el retroperitoneo (decisión 81): psoas, cuadrado lumbar y grasa; delante, el
    // intestino. Su distancia a la frontera cuenta también la columna, que se clasifica antes (el psoas la bordea)
    const [tissue, dRetro] = retroperitoneum(m, -depth - wall.wallMm, kidney.dPeriMm);
    return { ...NONE, tissue, boundaryDistance: Math.max(0, Math.min(bd, dRetro, sdSpine(m, this.spine))) };
  }

  /**
   * Distancia con signo (mm) de un punto MATERIAL a una cara geométrica, positiva fuera de lo que la
   * cara encierra (luz, hígado, abdomen bajo la cúpula, riñón, luz vesicular). Es la misma cantidad
   * que decide la clasificación en esa cara, así que su gradiente es la normal de la interfaz:
   *  - `tube`: `hit.d` del tubo de `bestTube` (el de `classifyTubes`), null si ninguno contiene el
   *    punto en su luz o su pared;
   *  - `liverSurface`: −inner, con inner = min(−dLiver, dDome − DIAPHRAGM, pared), como `classifyLiver`;
   *  - `dome`: `sdDiaphragm`;
   *  - `kidneyOuter`: el menor `dOuter` de los dos riñones;
   *  - `perirenalOuter`: el menor `perirenalOuterSdf` de los dos riñones (`dOuter` − grosor local de la grasa);
   *  - `gallbladder`: `gallbladderSdf`;
   *  - `pericardium`: `heartOuterSdf` (el epicardio recortado por la cúpula).
   * Solo banco de fidelidad y pruebas: la clasificación no la llama.
   */
  faceSdf(m: Vec3, caliber: VesselCaliber, face: FaceGeometry): number | null {
    switch (face) {
      case 'tube':
        return this.bestTube(m, caliber)?.hit.d ?? null;
      case 'liverSurface': {
        const insideWallMm = -torsoDepth(m, this.torso) - this.wallThickness();
        const dDome = sdDiaphragm(m, this.diaphragm, this.torso);
        return -Math.min(-this.liverSdf(m), dDome - DIAPHRAGM_THICKNESS_MM, insideWallMm);
      }
      case 'dome':
        return sdDiaphragm(m, this.diaphragm, this.torso);
      case 'kidneyOuter':
        return Math.min(
          kidneyOuterSdf(kidneyLocal(m, this.kidneyRight), this.kidneyRight),
          kidneyOuterSdf(kidneyLocal(m, this.kidneyLeft), this.kidneyLeft),
        );
      case 'perirenalOuter':
        return Math.min(
          perirenalOuterSdf(kidneyLocal(m, this.kidneyRight), this.kidneyRight),
          perirenalOuterSdf(kidneyLocal(m, this.kidneyLeft), this.kidneyLeft),
        );
      case 'gallbladder':
        return gallbladderSdf(m, this.gallbladder);
      case 'pericardium':
        return heartOuterSdf(m, domeFloor(m, this.diaphragm, this.torso));
    }
  }

  /**
   * Tubo cuya luz da la cara `tube` de `faceSdf` en un punto MATERIAL: el vaso (null si es un conducto)
   * y su impacto (segmento y parámetro `s`), o null si ningún tubo contiene el punto en su luz o su
   * pared. Solo pruebas: la e2e de normales separa la VCI, de sección elíptica, del resto de tubos.
   */
  faceTube(m: Vec3, caliber: VesselCaliber): { vessel: VesselId | null; hit: TubeHit } | null {
    const best = this.bestTube(m, caliber);
    return best ? { vessel: best.kind === 'vessel' ? best.def.id : null, hit: best.hit } : null;
  }

  /**
   * Gradiente de la distancia de la cara que dibuja un punto MATERIAL (gemelo de `faceGradient` en la
   * GLSL, decisión 57), o null si el punto no dibuja ninguna. En los tubos es el analítico de su sección
   * (`tubeFaceGradient`, con su curvatura circunferencial); en el resto, diferencias centrales de paso
   * `FACE_GRADIENT_EPS_MM` de la distancia de su cara (`faceSdf`), como la GPU. El eco de interfaz
   * divide `interfaceDistance` por su norma: así el perfil, muestreado a lo largo del rayo, integra 1
   * aunque la distancia de la cara no sea euclídea (la VCI elíptica, las fusiones suaves del hígado, la
   * escotadura renal, la cúpula lejos de la pleura). `face` fuerza la geometría (la GPU la elige por
   * tejido, también donde no hay cara: la e2e de normales). Solo pruebas: la clasificación no la llama.
   */
  faceGradient(m: Vec3, caliber: VesselCaliber, face?: FaceGeometry | null): FaceGradient | null {
    if (face === undefined) {
      // las caras de la pared y de las costillas (decisión 62) no tienen geometría de faceSdf
      const iface = this.classify(m, caliber).interface;
      if (isWallLayerInterface(iface)) return this.numericGradient(m, (p) => wallFaceSd(p, iface, this.torso), 0);
      if (isRibInterface(iface)) {
        const rib = this.ribs[nearestRib(m, this.ribs, this.torso, this.spine)];
        const g = this.numericGradient(m, (p) => ribSd(p, rib, this.torso, this.spine), ribCurvature(m, rib, this.torso));
        return { ...g, axis: ribTangent(m, rib, this.torso) };
      }
      face = faceGeometryOf(iface);
    }
    if (face === null) return null;
    if (face === 'tube') {
      const best = this.bestTube(m, caliber);
      if (!best) return null;
      const { gradient, curvature } = tubeFaceGradient(m, best.tube, best.scale, best.hit);
      const norm = Math.hypot(gradient[0], gradient[1], gradient[2]);
      return { normal: [gradient[0] / norm, gradient[1] / norm, gradient[2] / norm], norm, curvature, axis: best.hit.tangent };
    }
    const geometry = face;
    return this.numericGradient(m, (p) => this.faceSdf(p, caliber, geometry)!, 0);
  }

  /** Gradiente por diferencias centrales de paso `FACE_GRADIENT_EPS_MM` (el de la GPU) de una distancia. */
  private numericGradient(m: Vec3, sd: (p: Vec3) => number, curvature: number): FaceGradient {
    const h = FACE_GRADIENT_EPS_MM;
    const g: Vec3 = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const plus: Vec3 = [m[0], m[1], m[2]];
      const minus: Vec3 = [m[0], m[1], m[2]];
      plus[a] += h;
      minus[a] -= h;
      g[a] = sd(plus) - sd(minus);
    }
    const l = Math.hypot(g[0], g[1], g[2]);
    if (l === 0) return { normal: [0, 1, 0], norm: 1, curvature };
    return { normal: [g[0] / l, g[1] / l, g[2] / l], norm: l / (2 * h), curvature };
  }

  /**
   * Capas parietales y costillas (decisión 62, módulo `organs/wall`). `final` = el punto está en piel,
   * grasa subcutánea, costilla/cartílago, músculo, grasa preperitoneal o columna (no hay nada más que
   * mirar); si no, devuelve el espesor total de la pared para recortar el hígado. Cada muestra de las capas
   * dibuja la cara de la capa más cercana (`wallFace`); junto a una costilla ósea, su cortical; el cartílago,
   * su pericondrio. El hueso no dibuja cara (su cortical la dibuja el tejido blando de fuera).
   */
  private classifyWall(m: Vec3, d: number): { final: true; cls: Classification } | { final: false; wallMm: number } {
    const torso = this.torso;
    const skin = torso.skinMm;
    const wall = skin + torso.fatMm + torso.muscleMm;
    // la cara de la capa más cercana; la distancia a la frontera cuenta la costilla más cercana (|∇| ≤ 1,1)
    const layer = (tissue: Tissue, bd: number, u: number, ribD: number, ribAny: number): { final: true; cls: Classification } => {
      const [face, dist] = wallFace(d, u, m[2], ribD, torso);
      const boundaryDistance = Math.min(bd, ribAny / 1.1);
      return { final: true, cls: { ...NONE, tissue, boundaryDistance, interface: face, interfaceDistance: dist } };
    };
    if (d < skin) return layer(Tissue.Skin, skin - d, 0, 1e3, 1e3);
    // Costillas, antes de la grasa subcutánea donde una puede llegar (la grasa no las corta): dentro de la
    // pared o justo por debajo; la ósea más cercana da la cortical, el cartílago su pericondrio
    let ribD = 1e3;
    let ribAny = 1e3;
    if (d >= ribSearchDepth(torso, this.ribs[0]?.scale ?? 1))
      for (const rib of this.ribs) {
        const r = sdRib(m, rib, torso, this.spine);
        if (r.d < 0) {
          const tissue = r.cartilage ? Tissue.Cartilage : Tissue.Bone;
          const face = r.cartilage ? { interface: Interface.Perichondrium, interfaceDistance: -r.d } : {};
          return { final: true, cls: { ...NONE, tissue, boundaryDistance: -r.d, ...face } };
        }
        ribAny = Math.min(ribAny, r.d);
        if (!r.cartilage) ribD = Math.min(ribD, r.d);
      }
    if (d >= wall) {
      const dSpine = sdSpine(m, this.spine);
      if (dSpine < 0) return { final: true, cls: { ...NONE, tissue: Tissue.Vertebra, boundaryDistance: -dSpine } };
      return { final: false, wallMm: wall };
    }
    // las coordenadas de la pared solo dentro de ella: fascia profunda y transversalis onduladas en (u, z)
    const u = wallArc(m, torso);
    const w = wallDepths(torso, u, m[2]);
    if (d < w.fascia) return layer(Tissue.Fat, Math.min(d - skin, w.fascia - d), u, ribD, ribAny);
    if (d < w.transversalis) return layer(Tissue.Muscle, Math.min(d - w.fascia, w.transversalis - d), u, ribD, ribAny);
    // grasa preperitoneal (extraperitoneal) entre la transversalis y el peritoneo parietal
    return layer(Tissue.Fat, Math.min(d - w.transversalis, wall - d), u, ribD, ribAny);
  }

  /** Lámina de pulmón en el receso costofrénico derecho (lateral y posterior), bajo la pared. */
  private classifyLungCurtain(m: Vec3, insideWallMm: number, diaphragmCaudalMm: number): Classification | null {
    const bd = lungCurtainDistance(m, insideWallMm, diaphragmCaudalMm);
    return bd === null ? null : { ...NONE, tissue: Tissue.Lung, boundaryDistance: bd };
  }

  /**
   * Tubo (vaso o conducto) que contiene el punto en su luz o en su pared, con la menor distancia a
   * la luz; a igualdad gana el vaso. Descarte por esfera envolvente. Es la búsqueda de
   * `classifyTubes` y la cara `tube` de `faceSdf` (la misma que recorre `classify` en GLSL).
   */
  private bestTube(m: Vec3, caliber: VesselCaliber): BestTube | null {
    let bestVessel: ({ def: VesselDef } & TubeFound) | null = null;
    let bestDuct: ({ def: DuctDef } & TubeFound) | null = null;
    for (let i = 0; i < this.vessels.length; i++) {
      const b = this.tubeBounds[i];
      if (Math.hypot(m[0] - b.center[0], m[1] - b.center[1], m[2] - b.center[2]) > b.r) continue;
      const def = this.vessels[i];
      const scale = caliber.radiusScale(def.id);
      const apScale = VESSEL_META[def.id].system === 'ivc' ? caliber.ivcApScale : def.tube.apScale;
      const tube = apScale === def.tube.apScale ? def.tube : { ...def.tube, apScale };
      const hit = tubeQuery(m, tube, scale);
      if (hit.d < wallThicknessMm(def, hit.r) && (!bestVessel || hit.d < bestVessel.hit.d)) bestVessel = { def, hit, tube, scale };
    }
    for (let i = 0; i < this.ducts.length; i++) {
      const b = this.tubeBounds[this.vessels.length + i];
      if (Math.hypot(m[0] - b.center[0], m[1] - b.center[1], m[2] - b.center[2]) > b.r) continue;
      const def = this.ducts[i];
      const hit = tubeQuery(m, def.tube, 1);
      if (hit.d < def.wallMm && (!bestDuct || hit.d < bestDuct.hit.d)) bestDuct = { def, hit, tube: def.tube, scale: 1 };
    }
    if (bestDuct && (!bestVessel || bestDuct.hit.d < bestVessel.hit.d)) return { kind: 'duct', ...bestDuct };
    return bestVessel ? { kind: 'vessel', ...bestVessel } : null;
  }

  /** Vasos y conductos (antes de los órganos: la luz prevalece). */
  private classifyTubes(m: Vec3, caliber: VesselCaliber): Classification | null {
    const best = this.bestTube(m, caliber);
    // la cara de la luz: la pared y la luz (sangre o bilis) conocen la misma, a |hit.d|
    if (best?.kind === 'duct') {
      const { def, hit } = best;
      const face = { interface: Interface.DuctLumen, interfaceDistance: Math.abs(hit.d) };
      if (hit.d < 0) return { ...NONE, tissue: Tissue.Fluid, boundaryDistance: -hit.d, boundaryNormal: [0, 0, 0], ...face };
      return {
        ...NONE,
        tissue: Tissue.BileDuctWall,
        boundaryDistance: Math.min(hit.d, def.wallMm - hit.d),
        boundaryNormal: [0, 0, 0],
        ...face,
      };
    }
    if (!best) return null;
    const { def, hit } = best;
    const iface = interfaceOfVessel(def.id, def.wallTissue);
    const flowFactor = def.flowFactor ?? 1;
    if (hit.d < 0) {
      return {
        tissue: Tissue.Blood,
        boundaryDistance: -hit.d,
        boundaryNormal: [0, 0, 0],
        interface: iface,
        interfaceDistance: -hit.d,
        vessel: def.id,
        vesselHit: hit,
        flowFactor,
      };
    }
    return {
      tissue: def.wallTissue,
      boundaryDistance: Math.min(hit.d, wallThicknessMm(def, hit.r) - hit.d),
      boundaryNormal: [0, 0, 0],
      interface: iface,
      interfaceDistance: hit.d,
      vessel: null,
      vesselHit: hit,
      flowFactor,
    };
  }

  /**
   * Riñones: corteza / pirámides / seno, con grasa perirrenal alrededor. Devuelve también la distancia
   * a la cara externa de la grasa perirrenal (`dPeriMm`, el menor `dOuter − grosor local` de los riñones
   * cercanos) y si esa grasa es fina (`periThin`): la cápsula hepática que la toca, o que está a una lámina de una fina,
   * no dibuja la suya (Morison es de la grasa: su cara externa si es gruesa, la de la cápsula renal si es fina).
   */
  private classifyKidneys(m: Vec3): { cls: Classification | null; dPeriMm: number; periThin: boolean } {
    let dPeriMm = 1e3;
    let periThin = false;
    for (const k of [this.kidneyRight, this.kidneyLeft]) {
      const dc = Math.hypot(m[0] - k.center[0], m[1] - k.center[1], m[2] - k.center[2]);
      if (dc > k.radii[0] + PERIRENAL.maxMm + 2) continue;
      const kh = kidneyQuery(m, k);
      const fat = perirenalThicknessMm(kidneyLocal(m, k), k);
      if (kh.dOuter - fat < dPeriMm) {
        dPeriMm = kh.dOuter - fat;
        periThin = fat <= PERIRENAL.faceMaxMm;
      }
      if (kh.dOuter < 0) {
        // cápsula fibrosa: línea brillante que separa la corteza de la grasa perirrenal, salvo en la boca del hilio: dentro
        // del canal del seno su grasa sigue en la perirrenal (decisión 87: antes la cápsula la cruzaba). El mismo canal
        // decide la cara de la grasa de fuera, así que las dos mitades de la cara cambian de dueño en el mismo sitio, y la
        // distancia a la frontera lo cuenta
        let bd = Math.min(kh.inner, -kh.dOuter - RENAL_CAPSULE_MM);
        if (-kh.dOuter < RENAL_CAPSULE_MM) {
          const hc = hilumChannelSdf(kidneyLocal(m, k), k);
          if (hc > 0) {
            const cls: Classification = {
              ...NONE,
              tissue: Tissue.RenalCapsule,
              boundaryDistance: Math.min(-kh.dOuter, RENAL_CAPSULE_MM + kh.dOuter, kh.inner, hc),
              interface: Interface.RenalCapsule,
              interfaceDistance: -kh.dOuter,
            };
            return { cls, dPeriMm, periThin };
          }
          bd = Math.min(kh.inner, -hc);
        }
        return { cls: { ...NONE, tissue: KIDNEY_TISSUE[kh.region], boundaryDistance: bd }, dPeriMm, periThin };
      }
      // Grasa perirrenal (fascia de Gerota) de grosor variable (decisión 68) hasta la impresión renal del hígado: en
      // el receso de Morison la cápsula hepática apoya directamente sobre ella, sin hueco.
      if (kh.dOuter < fat) {
        // la mitad externa de la grasa gruesa dibuja la cara de Morison, solo si apoya el hígado (la impresión renal solapa
        // la grasa y la cápsula hepática le cede la cara, `MORISON_CONTACT_MM`); si no, se funde sin línea con la grasa
        // retroperitoneal (antes la gruesa nunca la dibujaba y el 62 % del contacto hígado–grasa quedaba sin línea). La
        // mitad interna, y toda la fina (decisión 81), la de la cápsula renal: las dos caras de la fina, a 1–2,5 mm, eran dos
        // líneas paralelas (frente al hígado, la grasa retroperitoneal o el intestino); ahora son una, y en Morison la
        // cápsula hepática le sigue cediendo la suya
        // Frente a la boca del hilio (el canal del seno) no hay cápsula que dibujar: grasa con grasa (decisión 87); la
        // distancia a la frontera cuenta el cambio de dueño de la cara
        const outerFace = kh.dOuter > 0.5 * fat && fat > PERIRENAL.faceMaxMm;
        const ifd = outerFace ? fat - kh.dOuter : kh.dOuter;
        const hc = hilumChannelSdf(kidneyLocal(m, k), k);
        const face = outerFace ? this.liverSdf(m) <= ifd + MORISON_CONTACT_MM : hc > 0;
        const cls: Classification = {
          ...NONE,
          tissue: Tissue.PerirenalFat,
          boundaryDistance: Math.min(kh.dOuter, fat - kh.dOuter, Math.abs(hc)),
          interface: face ? (outerFace ? Interface.PerirenalFat : Interface.RenalCapsule) : Interface.None,
          interfaceDistance: face ? ifd : NONE.interfaceDistance,
        };
        return { cls, dPeriMm, periThin };
      }
    }
    return { cls: null, dPeriMm, periThin };
  }

  /** Plano de la fisura del ligamento venoso (módulo `organs/liverLigaments`). */
  ligamentumVenosumPlane(): { point: Vec3; normal: Vec3 } {
    return ligamentumVenosumPlane(this.ligamentumVenosum);
  }

  /** Distancia con signo a la lámina del ligamento venoso (negativa dentro de la lámina acotada). */
  ligamentumVenosumSdf(m: Vec3): number {
    return ligamentumVenosumSdf(m, this.ligamentumVenosum);
  }

  /**
   * Hígado con cápsula, recortado por diafragma (`dDome`) y pared (`insideWallMm`). La cápsula dibuja
   * su cara salvo donde la manda el diafragma (su cara es del diafragma), donde toca la grasa
   * perirrenal a ≤ `MORISON_CONTACT_MM` (`dPeriMm`: la cara de Morison es de la grasa) o a ≤ `MORISON_SLIVER_MM` de
   * una grasa fina (solo las separa una lámina; la línea es la de la cápsula renal, decisión 81), o donde toca la pared de la
   * vesícula a ≤ `GALLBLADDER_CONTACT_MM` (`dGbWallMm`, en su fosa: la pared vesicular es una sola línea).
   * La distancia a la frontera cuenta también la cara externa de la grasa (`dPeriMm`): la impresión renal la solapa
   * 1 mm y la grasa, que gana, es la frontera real del hígado en Morison.
   */
  private classifyLiver(
    m: Vec3,
    dDome: number,
    insideWallMm: number,
    { dPeriMm, periThin }: { dPeriMm: number; periThin: boolean },
    dGbWallMm: number,
  ): Classification | null {
    const dBase = this.liverBaseSdf(m);
    const dFissure = this.umbilicalFissureSdf(m, dBase);
    const dLiver = smoothMax(dBase, -dFissure, this.umbilicalFissure.roundMm);
    if (dLiver >= 0) {
      // lo excavado por la fisura (dentro del hígado original) es el ligamento redondo
      if (dBase < 0) return { ...NONE, tissue: Tissue.LigamentumTeres, boundaryDistance: Math.min(-dBase, dLiver) };
      return null;
    }
    const dDiaphragm = dDome - DIAPHRAGM_THICKNESS_MM;
    const inner = Math.min(-dLiver, dDiaphragm, insideWallMm);
    const bd = Math.min(inner, dPeriMm);
    if (inner < LIVER_CAPSULE_MM) {
      // `Math.min` devuelve uno de sus argumentos: la igualdad con la cara del diafragma es exacta
      const morison = dPeriMm <= inner + (periThin ? MORISON_SLIVER_MM : MORISON_CONTACT_MM);
      const other = inner === dDiaphragm || morison || dGbWallMm <= inner + GALLBLADDER_CONTACT_MM;
      return {
        ...NONE,
        tissue: Tissue.LiverCapsule,
        boundaryDistance: bd,
        ...(other ? {} : { interface: Interface.LiverCapsule, interfaceDistance: inner }),
      };
    }
    const dLv = this.ligamentumVenosumSdf(m);
    if (dLv < 0 && inner > 2) return { ...NONE, tissue: Tissue.LigamentumVenosum, boundaryDistance: Math.min(-dLv, bd) };
    return { ...NONE, tissue: Tissue.Liver, boundaryDistance: bd };
  }
}

/** Tejido de cada región del riñón; los vasos arcuatos (decisión 87) son pared arterial sin luz. */
const KIDNEY_TISSUE: Readonly<Record<KidneyRegion, Tissue>> = {
  pelvis: Tissue.RenalPelvis,
  sinus: Tissue.RenalSinus,
  medulla: Tissue.RenalMedulla,
  arcuate: Tissue.ArteryWall,
  cortex: Tissue.RenalCortex,
};

/** Clasificación «nada» (aire fuera del cuerpo): base de todas las demás. */
const NONE: Classification = Object.freeze({
  tissue: Tissue.Air,
  boundaryDistance: 1e3,
  boundaryNormal: [0, 1, 0] as Vec3,
  interface: Interface.None,
  interfaceDistance: 1e3,
  vessel: null,
  vesselHit: null,
  flowFactor: 1,
});

/** Escalas de calibre que la fisiología impone a la anatomía en un instante. */
export interface VesselCaliber {
  radiusScale(id: VesselId): number;
  /** Semieje AP / semieje lateral de la VCI. */
  ivcApScale: number;
  /** Descenso caudal del diafragma en este instante (mm, 0 en espiración): baja la cortina pulmonar. */
  diaphragmCaudalMm: number;
}

export const BASELINE_CALIBER: VesselCaliber = {
  radiusScale: () => 1,
  ivcApScale: 0.8,
  diaphragmCaudalMm: 0,
};

/** Cortina pulmonar: módulo de órgano `organs/lungCurtain` (se reexporta por compatibilidad). */
export { LUNG_CURTAIN } from './organs/lungCurtain';
