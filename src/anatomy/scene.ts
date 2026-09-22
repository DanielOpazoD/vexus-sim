import { smoothstep, type Vec3 } from '../core/vec3';
import type { PatientState } from '../physiology/patientState';
import type { VesselAreas, VesselId } from '../physiology/vessels';
import {
  kidneyQuery,
  orthonormalBasis,
  sdSpine,
  sdDiaphragm,
  sdEllipsoid,
  sdRib,
  sdSphere,
  smoothMax,
  smoothMin,
  torsoDepth,
  tubeQuery,
  type Spine,
  type Diaphragm,
  type Ellipsoid,
  type Kidney,
  type Rib,
  type Sphere,
  type Torso,
  type Tube,
  type TubeHit,
} from './primitives';
import { buildHepaticBranches, buildVesselTree, type DuctDef, type VesselDef } from './vesselTree';

export type { DuctDef, VesselDef } from './vesselTree';
import { DIAPHRAGM_THICKNESS_MM, LIVER_CAPSULE_MM, Tissue } from './tissues';

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
  readonly liverBlendMm = 30;
  /**
   * Cara visceral: plano z = −62 − 0,35·y (borde inferior agudo a z ≈ −83 bajo la
   * pared anterior, junto al reborde costal, y a −48 en la cara posterior); normal (0, 0,35, 1).
   */
  readonly visceralPlane: { zAtY0: number; slopeY: number; edgeRoundMm: number };
  /**
   * Fisura umbilical (ligamento redondo / falciforme): surco sagital en x = 15 mm (izquierda
   * del paciente) sobre la cara anteroinferior del lóbulo izquierdo, entre el segmento IV y
   * los segmentos II–III; 8 mm de ancho, 14 mm de profundidad desde la superficie, relleno de
   * grasa ecogénica. Solo por delante (y > 0) y en el tercio inferior (z < zMax = −30): en el corte transversal es el foco ecogénico entre los segmentos III y IV.
   */
  readonly umbilicalFissure: { x: number; halfWidth: number; depthMm: number; zMax: number; roundMm: number };
  readonly gallbladder: Ellipsoid;
  readonly rightAtrium: Sphere;
  readonly kidneyRight: Kidney;
  readonly kidneyLeft: Kidney;
  /** Grasa perirrenal (fascia de Gerota) alrededor del riñón (mm). */
  readonly perirenalMm = 3.5;
  /** Separación mínima hígado–riñón (impresión renal) (mm). */
  readonly renalImpressionMm = 4;
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
    // Hígado: el lóbulo derecho es un elipsoide grande (170 × 190 × 200 mm) del que la
    // pared abdominal recorta la cara anterior (convexa, pegada a la pared), la cúpula la
    // superior y el plano visceral la inferior: cuña con borde agudo. Craneocaudal
    // resultante ≈ 145 mm en la línea medioclavicular; lóbulo izquierdo afilado hasta x ≈ +95.
    // Hepatomegalia congestiva: los radios escalan con `sizeFactor` y el borde inferior
    // (plano visceral) desciende en proporción (≈ 1 cm por cada 10 % de tamaño).
    const f = patient.liver.sizeFactor;
    this.liver = { kind: 'ellipsoid', center: [-70, -5, -18], radii: [85 * f, 95 * f, 100 * f], taperX: 0.12 };
    this.liverLeft = { kind: 'ellipsoid', center: [0, 32, -25], radii: [95 * f, 36 * f, 55 * f], taperX: 0.5 };
    this.visceralPlane = { zAtY0: -62 - 100 * (f - 1), slopeY: 0.35, edgeRoundMm: 12 };
    this.umbilicalFissure = { x: 15, halfWidth: 4, depthMm: 14, zMax: -30, roundMm: 3 };
    // Vesícula en su fosa (cara visceral del segmento IV/V); fondo hacia el borde
    this.gallbladder = { kind: 'ellipsoid', center: [-52, 42, -65], radii: [34, 17, 17], taperX: 0 };
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
    this.vessels = [...this.vessels, ...buildHepaticBranches(this.vessels, (m) => -this.liverInteriorMargin(m))];
    // Solo los vasos «madre»: las ramas procedurales comparten id y no deben sustituirlos
    this.vesselById = new Map(this.vessels.filter((v) => v.flowFactor === undefined).map((v) => [v.id, v]));
    this.tubeBounds = [
      ...this.vessels.map((v) => tubeBoundingSphere(v.tube, v.wallMm + 2)),
      ...this.ducts.map((d) => tubeBoundingSphere(d.tube, d.wallMm + 2)),
    ];
  }

  /** Distancia con signo a la cara visceral (positiva dentro del hígado, por encima del plano). */
  visceralPlaneDistance(m: Vec3): number {
    const vp = this.visceralPlane;
    return (m[2] - vp.zAtY0 + vp.slopeY * m[1]) / Math.hypot(vp.slopeY, 1);
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
    const dBase = this.liverBaseSdf(m);
    return smoothMax(dBase, -this.umbilicalFissureSdf(m, dBase), this.umbilicalFissure.roundMm);
  }

  /** Hígado sin la fisura umbilical (lo que la fisura excava se clasifica como ligamento redondo). */
  liverBaseSdf(m: Vec3): number {
    let d = smoothMin(sdEllipsoid(m, this.liver), sdEllipsoid(m, this.liverLeft), this.liverBlendMm);
    d = smoothMax(d, -this.visceralPlaneDistance(m), this.visceralPlane.edgeRoundMm);
    const kr = kidneyQuery(m, this.kidneyRight);
    d = smoothMax(d, -(kr.dOuter - this.renalImpressionMm), 8);
    d = smoothMax(d, -sdEllipsoid(m, this.gallbladder), 4);
    return d;
  }

  /**
   * Región de la fisura umbilical (negativa dentro): lámina |x − xF| < hw, a menos de
   * `depthMm` de la superficie hepática (dBase > −depth), anterior (y > 0) y bajo zMax.
   * Misma fórmula en GLSL (`fissureSdf`).
   */
  umbilicalFissureSdf(m: Vec3, dBase: number): number {
    const f = this.umbilicalFissure;
    return Math.max(Math.abs(m[0] - f.x) - f.halfWidth, -(dBase + f.depthMm), m[2] - f.zMax, -m[1]);
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
    const tube = this.classifyTubes(m, caliber);
    if (tube) return tube;
    const dRa = sdSphere(m, this.rightAtrium);
    if (dRa < 0) return { ...NONE, tissue: Tissue.Blood, boundaryDistance: -dRa, specular: 0.5 };
    const dDome = sdDiaphragm(m, this.diaphragm, this.torso);
    if (dDome < 0) return { ...NONE, tissue: Tissue.Lung, boundaryDistance: -dDome, specular: 1.0 };
    if (dDome < DIAPHRAGM_THICKNESS_MM)
      return { ...NONE, tissue: Tissue.Diaphragm, boundaryDistance: Math.min(dDome, DIAPHRAGM_THICKNESS_MM - dDome), specular: 0.9 };
    const dGb = sdEllipsoid(m, this.gallbladder);
    if (dGb < 0) return { ...NONE, tissue: Tissue.Fluid, boundaryDistance: -dGb, specular: 0.4 };
    const kidney = this.classifyKidneys(m);
    if (kidney) return kidney;
    const liver = this.classifyLiver(m, dDome, -depth - wall.wallMm);
    if (liver) return liver;
    for (const g of this.gasPockets) {
      const dg = sdSphere(m, g);
      if (dg < 0) return { ...NONE, tissue: Tissue.BowelGas, boundaryDistance: -dg, specular: 1.0 };
    }
    return { ...NONE, tissue: Tissue.Bowel, boundaryDistance: 5, specular: 0.3 };
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

  /** Vasos y conductos (antes de los órganos: la luz prevalece). Descarte por esfera envolvente. */
  private classifyTubes(m: Vec3, caliber: VesselCaliber): Classification | null {
    let bestVessel: { def: VesselDef; hit: TubeHit } | null = null;
    let bestDuct: { def: DuctDef; hit: TubeHit } | null = null;
    for (let i = 0; i < this.vessels.length; i++) {
      const b = this.tubeBounds[i];
      if (Math.hypot(m[0] - b.center[0], m[1] - b.center[1], m[2] - b.center[2]) > b.r) continue;
      const def = this.vessels[i];
      const scale = caliber.radiusScale(def.id);
      const apScale = def.id.startsWith('ivc') ? caliber.ivcApScale : def.tube.apScale;
      const hit = tubeQuery(m, apScale === def.tube.apScale ? def.tube : { ...def.tube, apScale }, scale);
      if (hit.d < def.wallMm && (!bestVessel || hit.d < bestVessel.hit.d)) bestVessel = { def, hit };
    }
    for (let i = 0; i < this.ducts.length; i++) {
      const b = this.tubeBounds[this.vessels.length + i];
      if (Math.hypot(m[0] - b.center[0], m[1] - b.center[1], m[2] - b.center[2]) > b.r) continue;
      const def = this.ducts[i];
      const hit = tubeQuery(m, def.tube, 1);
      if (hit.d < def.wallMm && (!bestDuct || hit.d < bestDuct.hit.d)) bestDuct = { def, hit };
    }
    if (bestDuct && (!bestVessel || bestDuct.hit.d < bestVessel.hit.d)) {
      const { def, hit } = bestDuct;
      if (hit.d < 0) return { ...NONE, tissue: Tissue.Fluid, boundaryDistance: -hit.d, boundaryNormal: [0, 0, 0], specular: 0.6 };
      return {
        ...NONE,
        tissue: Tissue.BileDuctWall,
        boundaryDistance: Math.min(hit.d, def.wallMm - hit.d),
        boundaryNormal: [0, 0, 0],
        specular: 0.6,
      };
    }
    if (!bestVessel) return null;
    const { def, hit } = bestVessel;
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
      boundaryDistance: Math.min(hit.d, def.wallMm - hit.d),
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
        const tissue = kh.region === 'sinus' ? Tissue.RenalSinus : kh.region === 'medulla' ? Tissue.RenalMedulla : Tissue.RenalCortex;
        const specular = kh.region === 'sinus' ? 0.6 : kh.region === 'medulla' ? 0.25 : 0.45;
        return { ...NONE, tissue, boundaryDistance: kh.inner, specular };
      }
      if (kh.dOuter < this.perirenalMm) {
        return { ...NONE, tissue: Tissue.PerirenalFat, boundaryDistance: Math.min(kh.dOuter, this.perirenalMm - kh.dOuter), specular: 0.6 };
      }
    }
    return null;
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
}

export const BASELINE_CALIBER: VesselCaliber = {
  radiusScale: () => 1,
  ivcApScale: 0.8,
};
