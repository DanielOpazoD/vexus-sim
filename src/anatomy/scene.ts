import { smoothstep, type Vec3 } from '../core/vec3';
import type { PatientState } from '../physiology/patientState';
import { VESSEL_META, type VesselAreas, type VesselId } from '../physiology/vessels';
import {
  orthonormalBasis,
  sdSpine,
  sdDiaphragm,
  sdRib,
  sdSphere,
  smoothMax,
  torsoDepth,
  tubeQuery,
  type Spine,
  type Diaphragm,
  type Ellipsoid,
  type OrientedEllipsoid,
  type Rib,
  type Sphere,
  type Torso,
  type Tube,
  type TubeHit,
} from './primitives';
import { GALLBLADDER_WALL_MM, gallbladderBody, gallbladderSdf } from './organs/gallbladder';
import { RENAL_CAPSULE_MM, kidneyLocal, kidneyOuterSdf, kidneyQuery, type Kidney } from './organs/kidney';
import {
  LIVER_BLEND_MM,
  RENAL_IMPRESSION,
  liverBaseSdf,
  liverLobes,
  liverSdf,
  visceralPlaneDistance,
  type VisceralPlane,
} from './organs/liver';
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
import { lungCurtainDistance } from './organs/lungCurtain';

export type { DuctDef, VesselDef } from './vesselTree';
import { BOWEL_BD_CAP_MM, DIAPHRAGM_THICKNESS_MM, LIVER_CAPSULE_MM, Tissue } from './tissues';

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
  /** Reflectividad especular relativa de esa interfaz (0–1). */
  specular: number;
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
 *  - `gallbladder`: la luz vesicular.
 */
export type FaceGeometry = 'tube' | 'liverSurface' | 'dome' | 'kidneyOuter' | 'gallbladder';
export const FACE_GEOMETRIES: readonly FaceGeometry[] = ['tube', 'liverSurface', 'dome', 'kidneyOuter', 'gallbladder'];

/** Resultado de la búsqueda de tubos de `classify`. */
type BestTube = { kind: 'vessel'; def: VesselDef; hit: TubeHit } | { kind: 'duct'; def: DuctDef; hit: TubeHit };

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
  /** Cara visceral (módulo `organs/liver`). */
  readonly visceralPlane: VisceralPlane;
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
  readonly gallbladder: OrientedEllipsoid;
  /** Pared vesicular (mm), ecogénica, entre la luz anecoica y la fosa. */
  readonly gallbladderWallMm = GALLBLADDER_WALL_MM;
  readonly rightAtrium: Sphere;
  readonly kidneyRight: Kidney;
  readonly kidneyLeft: Kidney;
  /** Grasa perirrenal (fascia de Gerota) alrededor del riñón (mm). */
  readonly perirenalMm = 4;
  /** Separación mínima hígado–riñón (impresión renal) (mm). */
  readonly renalImpressionMm = RENAL_IMPRESSION.mm;
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
    this.torso = { a: 160, b: 105, zMin: -300, zMax: 300, skinMm: 2, fatMm: fat, muscleMm: muscle };
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
    ({ liver: this.liver, liverLeft: this.liverLeft, visceralPlane: this.visceralPlane } = liverLobes(patient.liver.sizeFactor));
    this.umbilicalFissure = UMBILICAL_FISSURE;
    this.ligamentumVenosum = LIGAMENTUM_VENOSUM;
    this.gallbladder = gallbladderBody();
    this.rightAtrium = { kind: 'sphere', center: [-15, 15, 95], r: 30 };
    // Riñones: eje largo con el polo superior medial y posterior; hilio anteromedial.
    const bR = orthonormalBasis([0.22, -0.18, 1], [1, 0.25, 0]);
    const bL = orthonormalBasis([-0.22, -0.18, 1], [-1, 0.25, 0]);
    this.kidneyRight = {
      kind: 'kidney',
      center: [-72, -38, -78],
      radii: [54, 27, 23],
      ...bR,
      sinusRadii: [30, 12, 10],
      sinusOffset: 4,
      hilumRadius: 7,
    };
    this.kidneyLeft = {
      kind: 'kidney',
      center: [78, -36, -70],
      radii: [54, 27, 23],
      ...bL,
      sinusRadii: [30, 12, 10],
      sinusOffset: 4,
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
        cartilageFromPhi: 1.05,
        rightOnly: true,
      });
    }
    ({ vessels: this.vessels, ducts: this.ducts } = buildVesselTree(this.kidneyRight, this.kidneyLeft));
    // Ramas de 3.º–4.º orden confinadas al hígado (el SDF ya conoce riñón y vesícula)
    this.vessels = [
      ...this.vessels,
      ...buildHepaticBranches(
        this.vessels,
        (m) => -this.liverInteriorMargin(m),
        7,
        (m) => Math.min(this.liverInteriorMargin(m), this.ligamentumVenosumSdf(m)),
      ),
    ];
    // Solo los vasos «madre»: las ramas procedurales comparten id y no deben sustituirlos
    this.vesselById = new Map(this.vessels.filter((v) => v.flowFactor === undefined).map((v) => [v.id, v]));
    this.tubeBounds = [
      ...this.vessels.map((v) => tubeBoundingSphere(v.tube, v.wallMm + 2)),
      ...this.ducts.map((d) => tubeBoundingSphere(d.tube, d.wallMm + 2)),
    ];
  }

  /** Distancia con signo a la cara visceral (positiva dentro del hígado, por encima del plano). */
  visceralPlaneDistance(m: Vec3): number {
    return visceralPlaneDistance(m, this.visceralPlane);
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
   * contiene el punto gana): pared → costillas → columna → vasos y conductos →
   * aurícula derecha → tórax/diafragma → vesícula → riñones → hígado → gas →
   * intestino. Cada paso es un método propio; el mismo orden vive en GLSL.
   */
  classify(m: Vec3, caliber: VesselCaliber): Classification {
    const torso = this.torso;
    const depth = torsoDepth(m, torso);
    if (m[2] < torso.zMin || m[2] > torso.zMax || depth > 0) return NONE;
    const wall = this.classifyWall(m, -depth);
    if (wall.final) return wall.cls;
    const curtain = this.classifyLungCurtain(m, -depth - wall.wallMm, caliber.diaphragmCaudalMm);
    if (curtain) return curtain;
    const tube = this.classifyTubes(m, caliber);
    if (tube) return tube;
    const dRa = sdSphere(m, this.rightAtrium);
    if (dRa < 0) return { ...NONE, tissue: Tissue.Blood, boundaryDistance: -dRa, specular: 0.5 };
    const dDome = sdDiaphragm(m, this.diaphragm, this.torso);
    if (dDome < 0) return { ...NONE, tissue: Tissue.Lung, boundaryDistance: -dDome, specular: 1.0 };
    if (dDome < DIAPHRAGM_THICKNESS_MM)
      return { ...NONE, tissue: Tissue.Diaphragm, boundaryDistance: Math.min(dDome, DIAPHRAGM_THICKNESS_MM - dDome), specular: 0.9 };
    const dGb = gallbladderSdf(m, this.gallbladder);
    if (dGb < 0) return { ...NONE, tissue: Tissue.Fluid, boundaryDistance: -dGb, specular: 0.4 };
    if (dGb < this.gallbladderWallMm)
      return { ...NONE, tissue: Tissue.BileDuctWall, boundaryDistance: Math.min(dGb, this.gallbladderWallMm - dGb), specular: 0.5 };
    const kidney = this.classifyKidneys(m);
    if (kidney) return kidney;
    const liver = this.classifyLiver(m, dDome, -depth - wall.wallMm);
    if (liver) return liver;
    // Intestino: el «resto». Su distancia a la frontera es la de las interfaces que ganan antes
    // (diafragma, vesícula, aurícula, hígado, pared, grasa perirrenal, gas); como en el hígado, no
    // cuenta la de los tubos. Con 5 mm fijos el gate volumétrico daba por interior un punto pegado
    // al diafragma que float32 clasificaba al otro lado (CI de #39: Bowel→Diaphragm, 1 de 44 826).
    let bd = Math.min(
      BOWEL_BD_CAP_MM,
      dDome - DIAPHRAGM_THICKNESS_MM,
      dGb - this.gallbladderWallMm,
      dRa,
      this.liverBaseSdf(m),
      -depth - wall.wallMm,
    );
    for (const k of [this.kidneyRight, this.kidneyLeft]) bd = Math.min(bd, kidneyOuterSdf(kidneyLocal(m, k), k) - this.perirenalMm);
    for (const g of this.gasPockets) {
      const dg = sdSphere(m, g);
      if (dg < 0) return { ...NONE, tissue: Tissue.BowelGas, boundaryDistance: -dg, specular: 1.0 };
      bd = Math.min(bd, dg);
    }
    return { ...NONE, tissue: Tissue.Bowel, boundaryDistance: Math.max(0, bd), specular: 0.3 };
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
   *  - `gallbladder`: `gallbladderSdf`.
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
      case 'gallbladder':
        return gallbladderSdf(m, this.gallbladder);
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
   * Capas parietales y costillas. `final` = el punto está en piel, grasa,
   * costilla/cartílago, músculo o columna (no hay nada más que mirar); si no,
   * devuelve el espesor total de la pared para recortar el hígado.
   */
  private classifyWall(m: Vec3, d: number): { final: true; cls: Classification } | { final: false; wallMm: number } {
    const torso = this.torso;
    const skin = torso.skinMm;
    const fat = skin + torso.fatMm;
    const wall = fat + torso.muscleMm;
    if (d < skin) return { final: true, cls: { ...NONE, tissue: Tissue.Skin, boundaryDistance: skin - d, specular: 0.1 } };
    if (d < fat)
      return { final: true, cls: { ...NONE, tissue: Tissue.Fat, boundaryDistance: Math.min(d - skin, fat - d), specular: 0.15 } };
    // Costillas (dentro de la pared muscular o justo por debajo)
    for (const rib of this.ribs) {
      const r = sdRib(m, rib, torso, this.spine);
      if (r.d < 0) {
        return {
          final: true,
          cls: { ...NONE, tissue: r.cartilage ? Tissue.Cartilage : Tissue.Bone, boundaryDistance: -r.d, specular: r.cartilage ? 0.3 : 0.9 },
        };
      }
    }
    if (d < wall)
      return { final: true, cls: { ...NONE, tissue: Tissue.Muscle, boundaryDistance: Math.min(d - fat, wall - d), specular: 0.2 } };
    const dSpine = sdSpine(m, this.spine);
    if (dSpine < 0) return { final: true, cls: { ...NONE, tissue: Tissue.Vertebra, boundaryDistance: -dSpine, specular: 0.9 } };
    return { final: false, wallMm: wall };
  }

  /** Lámina de pulmón en el receso costofrénico derecho (lateral y posterior), bajo la pared. */
  private classifyLungCurtain(m: Vec3, insideWallMm: number, diaphragmCaudalMm: number): Classification | null {
    const bd = lungCurtainDistance(m, insideWallMm, diaphragmCaudalMm);
    return bd === null ? null : { ...NONE, tissue: Tissue.Lung, boundaryDistance: bd, specular: 1.0 };
  }

  /**
   * Tubo (vaso o conducto) que contiene el punto en su luz o en su pared, con la menor distancia a
   * la luz; a igualdad gana el vaso. Descarte por esfera envolvente. Es la búsqueda de
   * `classifyTubes` y la cara `tube` de `faceSdf` (la misma que recorre `classify` en GLSL).
   */
  private bestTube(m: Vec3, caliber: VesselCaliber): BestTube | null {
    let bestVessel: { def: VesselDef; hit: TubeHit } | null = null;
    let bestDuct: { def: DuctDef; hit: TubeHit } | null = null;
    for (let i = 0; i < this.vessels.length; i++) {
      const b = this.tubeBounds[i];
      if (Math.hypot(m[0] - b.center[0], m[1] - b.center[1], m[2] - b.center[2]) > b.r) continue;
      const def = this.vessels[i];
      const scale = caliber.radiusScale(def.id);
      const apScale = VESSEL_META[def.id].system === 'ivc' ? caliber.ivcApScale : def.tube.apScale;
      const hit = tubeQuery(m, apScale === def.tube.apScale ? def.tube : { ...def.tube, apScale }, scale);
      if (hit.d < wallThicknessMm(def, hit.r) && (!bestVessel || hit.d < bestVessel.hit.d)) bestVessel = { def, hit };
    }
    for (let i = 0; i < this.ducts.length; i++) {
      const b = this.tubeBounds[this.vessels.length + i];
      if (Math.hypot(m[0] - b.center[0], m[1] - b.center[1], m[2] - b.center[2]) > b.r) continue;
      const def = this.ducts[i];
      const hit = tubeQuery(m, def.tube, 1);
      if (hit.d < def.wallMm && (!bestDuct || hit.d < bestDuct.hit.d)) bestDuct = { def, hit };
    }
    if (bestDuct && (!bestVessel || bestDuct.hit.d < bestVessel.hit.d)) return { kind: 'duct', ...bestDuct };
    return bestVessel ? { kind: 'vessel', ...bestVessel } : null;
  }

  /** Vasos y conductos (antes de los órganos: la luz prevalece). */
  private classifyTubes(m: Vec3, caliber: VesselCaliber): Classification | null {
    const best = this.bestTube(m, caliber);
    if (best?.kind === 'duct') {
      const { def, hit } = best;
      if (hit.d < 0) return { ...NONE, tissue: Tissue.Fluid, boundaryDistance: -hit.d, boundaryNormal: [0, 0, 0], specular: 0.6 };
      return {
        ...NONE,
        tissue: Tissue.BileDuctWall,
        boundaryDistance: Math.min(hit.d, def.wallMm - hit.d),
        boundaryNormal: [0, 0, 0],
        specular: 0.6,
      };
    }
    if (!best) return null;
    const { def, hit } = best;
    const specular = def.wallTissue === Tissue.VesselWallPortal ? 0.7 : def.wallTissue === Tissue.ArteryWall ? 0.6 : 0.35;
    const flowFactor = def.flowFactor ?? 1;
    if (hit.d < 0) {
      return {
        tissue: Tissue.Blood,
        boundaryDistance: -hit.d,
        boundaryNormal: [0, 0, 0],
        specular,
        vessel: def.id,
        vesselHit: hit,
        flowFactor,
      };
    }
    return {
      tissue: def.wallTissue,
      boundaryDistance: Math.min(hit.d, wallThicknessMm(def, hit.r) - hit.d),
      boundaryNormal: [0, 0, 0],
      specular,
      vessel: null,
      vesselHit: hit,
      flowFactor,
    };
  }

  /** Riñones: corteza / pirámides / seno, con grasa perirrenal alrededor. */
  private classifyKidneys(m: Vec3): Classification | null {
    for (const k of [this.kidneyRight, this.kidneyLeft]) {
      const dc = Math.hypot(m[0] - k.center[0], m[1] - k.center[1], m[2] - k.center[2]);
      if (dc > k.radii[0] + this.perirenalMm + 2) continue;
      const kh = kidneyQuery(m, k);
      if (kh.dOuter < 0) {
        // cápsula fibrosa: línea brillante que separa la corteza de la grasa perirrenal
        if (-kh.dOuter < RENAL_CAPSULE_MM)
          return {
            ...NONE,
            tissue: Tissue.RenalCapsule,
            boundaryDistance: Math.min(-kh.dOuter, RENAL_CAPSULE_MM + kh.dOuter),
            specular: 0.9,
          };
        const tissue =
          kh.region === 'pelvis'
            ? Tissue.RenalPelvis
            : kh.region === 'sinus'
              ? Tissue.RenalSinus
              : kh.region === 'medulla'
                ? Tissue.RenalMedulla
                : Tissue.RenalCortex;
        const specular = kh.region === 'pelvis' ? 0.5 : kh.region === 'sinus' ? 0.6 : kh.region === 'medulla' ? 0.25 : 0.45;
        return { ...NONE, tissue, boundaryDistance: kh.inner, specular };
      }
      // Grasa perirrenal (fascia de Gerota) hasta la impresión renal del hígado: en el
      // receso de Morison la cápsula hepática apoya directamente sobre ella, sin hueco.
      if (kh.dOuter < this.perirenalMm) {
        return { ...NONE, tissue: Tissue.PerirenalFat, boundaryDistance: Math.min(kh.dOuter, this.perirenalMm - kh.dOuter), specular: 0.6 };
      }
    }
    return null;
  }

  /** Plano de la fisura del ligamento venoso (módulo `organs/liverLigaments`). */
  ligamentumVenosumPlane(): { point: Vec3; normal: Vec3 } {
    return ligamentumVenosumPlane(this.ligamentumVenosum);
  }

  /** Distancia con signo a la lámina del ligamento venoso (negativa dentro de la lámina acotada). */
  ligamentumVenosumSdf(m: Vec3): number {
    return ligamentumVenosumSdf(m, this.ligamentumVenosum);
  }

  /** Hígado con cápsula, recortado por diafragma (`dDome`) y pared (`insideWallMm`). */
  private classifyLiver(m: Vec3, dDome: number, insideWallMm: number): Classification | null {
    const dBase = this.liverBaseSdf(m);
    const dFissure = this.umbilicalFissureSdf(m, dBase);
    const dLiver = smoothMax(dBase, -dFissure, this.umbilicalFissure.roundMm);
    if (dLiver >= 0) {
      // lo excavado por la fisura (dentro del hígado original) es el ligamento redondo
      if (dBase < 0) return { ...NONE, tissue: Tissue.LigamentumTeres, boundaryDistance: Math.min(-dBase, dLiver), specular: 0.6 };
      return null;
    }
    const inner = Math.min(-dLiver, dDome - DIAPHRAGM_THICKNESS_MM, insideWallMm);
    if (inner < LIVER_CAPSULE_MM) return { ...NONE, tissue: Tissue.LiverCapsule, boundaryDistance: inner, specular: 0.5 };
    const dLv = this.ligamentumVenosumSdf(m);
    if (dLv < 0 && inner > 2) return { ...NONE, tissue: Tissue.LigamentumVenosum, boundaryDistance: Math.min(-dLv, inner), specular: 0.7 };
    return { ...NONE, tissue: Tissue.Liver, boundaryDistance: inner, specular: 0.5 };
  }
}

/** Clasificación «nada» (aire fuera del cuerpo): base de todas las demás. */
const NONE: Classification = Object.freeze({
  tissue: Tissue.Air,
  boundaryDistance: 1e3,
  boundaryNormal: [0, 1, 0] as Vec3,
  specular: 0,
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
