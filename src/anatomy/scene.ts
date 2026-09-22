import { smoothstep, type Vec3 } from '../core/vec3';
import type { PatientState } from '../physiology/patientState';
import type { VesselAreas, VesselId } from '../physiology/vessels';
import {
  kidneyQuery,
  kidneyWorld,
  orthonormalBasis,
  sdCylinderZ,
  sdDome,
  sdEllipsoid,
  sdRib,
  sdSphere,
  smoothMax,
  smoothMin,
  torsoDepth,
  tubeQuery,
  type CylinderZ,
  type Dome,
  type Ellipsoid,
  type Kidney,
  type Rib,
  type Sphere,
  type Torso,
  type Tube,
  type TubeHit,
} from './primitives';
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

export interface VesselDef {
  id: VesselId;
  tube: Tube;
  /** Radio de referencia en el sitio de muestreo (mm): define el área de VesselAreas. */
  refRadius: number;
  /** Exponente del perfil de velocidad (2 parabólico; mayor = más plano). */
  profileN: number;
  /** Tejido de pared y su espesor (mm). */
  wallTissue: Tissue;
  wallMm: number;
}

/** Conducto biliar: tubo sin flujo, luz anecoica y pared ecogénica. */
export interface DuctDef {
  id: 'cbd' | 'rightHepaticDuct' | 'leftHepaticDuct' | 'cysticDuct';
  tube: Tube;
  wallMm: number;
}

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

export class AnatomyScene {
  readonly torso: Torso;
  readonly ribs: Rib[];
  readonly dome: Dome;
  readonly spine: CylinderZ;
  /** Lóbulo derecho (voluminoso) y lóbulo izquierdo (aplanado); su unión suave es el hígado. */
  readonly liver: Ellipsoid;
  readonly liverLeft: Ellipsoid;
  readonly liverBlendMm = 30;
  /**
   * Cara visceral: plano z = −40 − 0,35·y (borde inferior agudo a z ≈ −68 bajo la
   * pared anterior y a −26 en la cara posterior); normal (0, 0,35, 1).
   */
  readonly visceralPlane = { zAtY0: -40, slopeY: 0.35, edgeRoundMm: 12 };
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
  readonly vessels: VesselDef[];
  readonly ducts: DuctDef[];
  readonly vesselById: Map<VesselId, VesselDef>;
  /** Esferas envolventes de vasos y conductos, en el mismo orden que la GPU (vasos, luego conductos). */
  readonly tubeBounds: Array<{ center: Vec3; r: number }>;

  constructor(patient: PatientState) {
    const fat = patient.habitus.subcutaneousFatMm;
    const muscle = patient.habitus.muscleMm;
    this.torso = { a: 160, b: 115, zMin: -300, zMax: 300, skinMm: 2, fatMm: fat, muscleMm: muscle };
    this.dome = { kind: 'dome', x0: -55, y0: -5, rx: 140, ry: 122, zBase: -45, h: 140 };
    this.spine = { kind: 'cylinderZ', x0: 0, y0: -72, r: 20 };
    // Hígado: el lóbulo derecho es un elipsoide grande (170 × 190 × 200 mm) del que la
    // pared abdominal recorta la cara anterior (convexa, pegada a la pared), la cúpula la
    // superior y el plano visceral la inferior: cuña con borde agudo. Craneocaudal
    // resultante ≈ 145 mm en la línea medioclavicular; lóbulo izquierdo afilado hasta x ≈ +95.
    this.liver = { kind: 'ellipsoid', center: [-70, -5, 5], radii: [85, 95, 100], taperX: 0.12 };
    this.liverLeft = { kind: 'ellipsoid', center: [0, 32, 12], radii: [95, 36, 55], taperX: 0.5 };
    // Vesícula en su fosa (cara visceral del segmento IV/V); fondo hacia el borde
    this.gallbladder = { kind: 'ellipsoid', center: [-52, 42, -48], radii: [34, 17, 17], taperX: 0 };
    this.rightAtrium = { kind: 'sphere', center: [-15, 0, 150], r: 32 };
    // Riñones: eje largo con el polo superior medial y posterior; hilio anteromedial.
    const bR = orthonormalBasis([0.22, -0.18, 1], [1, 0.25, 0]);
    const bL = orthonormalBasis([-0.22, -0.18, 1], [-1, 0.25, 0]);
    this.kidneyRight = {
      kind: 'kidney',
      center: [-72, -46, -78],
      radii: [54, 27, 23],
      ...bR,
      sinusRadii: [30, 12, 10],
      sinusOffset: 4,
      hilumRadius: 7,
    };
    this.kidneyLeft = {
      kind: 'kidney',
      center: [78, -44, -70],
      radii: [54, 27, 23],
      ...bL,
      sinusRadii: [30, 12, 10],
      sinusOffset: 4,
      hilumRadius: 7,
    };
    this.gasPockets = [];
    this.ribs = [];
    const anterior = [70, 45, 20, -5, -30, -55];
    for (let i = 0; i < anterior.length; i++) {
      this.ribs.push({
        zAnterior: anterior[i],
        tilt: 60,
        halfWidth: 6,
        halfThickness: 3.2,
        scale: 0.85,
        cartilageFromPhi: 1.05,
        rightOnly: true,
      });
    }
    const tube = (nodes: Array<[Vec3, number]>, apScale = 1): Tube => ({
      kind: 'tube',
      nodes: nodes.map(([p, r]) => ({ p, r })),
      apScale,
    });
    const thin = (id: VesselId, nodes: Array<[Vec3, number]>, refRadius: number, wallMm = 0.5): VesselDef => ({
      id,
      tube: tube(nodes),
      refRadius,
      profileN: 3,
      wallTissue: Tissue.VesselWallThin,
      wallMm,
    });
    const portal = (id: VesselId, nodes: Array<[Vec3, number]>, refRadius: number, wallMm = 1.0): VesselDef => ({
      id,
      tube: tube(nodes),
      refRadius,
      profileN: 4,
      wallTissue: Tissue.VesselWallPortal,
      wallMm,
    });
    const artery = (id: VesselId, nodes: Array<[Vec3, number]>, refRadius: number, wallMm = 0.6): VesselDef => ({
      id,
      tube: tube(nodes),
      refRadius,
      profileN: 2,
      wallTissue: Tissue.ArteryWall,
      wallMm,
    });
    // Puntos del riñón derecho en coordenadas del mundo (seno, hilio, columnas de Bertin)
    const kR = this.kidneyRight;
    const kL = this.kidneyLeft;
    const kw = (k: Kidney, q: Vec3): Vec3 => kidneyWorld(q, k);
    const hilumR = kw(kR, [0, kR.radii[1] - 2, 0]);
    const hilumL = kw(kL, [0, kL.radii[1] - 2, 0]);
    const interlobarVein = (id: VesselId, u: number): VesselDef =>
      thin(
        id,
        [
          [kw(kR, [u, -25, 1.8]), 1.5],
          [kw(kR, [u, -14, 1.8]), 1.8],
          [kw(kR, [u, -4, 1.8]), 2.0],
        ],
        1.8,
        0.4,
      );
    const interlobarArtery = (id: VesselId, u: number): VesselDef =>
      artery(
        id,
        [
          [kw(kR, [u, -4, -1.8]), 1.4],
          [kw(kR, [u, -14, -1.8]), 1.2],
          [kw(kR, [u, -25, -1.8]), 1.0],
        ],
        1.2,
        0.4,
      );

    this.vessels = [
      {
        id: 'ivcInfra',
        tube: tube(
          [
            [[-22, -30, -300], 9.5],
            [[-22, -30, 60], 10],
            [[-21, -27, 75], 10],
          ],
          0.8,
        ),
        refRadius: 10,
        profileN: 5,
        wallTissue: Tissue.VesselWallThin,
        wallMm: 0.8,
      },
      {
        id: 'ivcSupra',
        tube: tube(
          [
            [[-21, -27, 75], 10],
            [[-20, -22, 95], 10],
            [[-16, -8, 125], 10.5],
          ],
          0.8,
        ),
        refRadius: 10,
        profileN: 5,
        wallTissue: Tissue.VesselWallThin,
        wallMm: 0.8,
      },
      // Suprahepática derecha: plano intersegmentario del lóbulo derecho, entra en la
      // cava por su cara posterolateral derecha 1 cm por debajo del tronco común.
      thin(
        'hvRight',
        [
          [[-135, 12, -25], 3],
          [[-105, -4, 12], 4.5],
          [[-68, -18, 50], 6],
          [[-38, -26, 72], 7],
          [[-26, -26, 78], 7.5],
        ],
        6,
      ),
      thin(
        'hvRightAnterior',
        [
          [[-118, 42, 0], 2.5],
          [[-95, 16, 25], 3.5],
          [[-83, -12, 35], 4],
        ],
        3.5,
      ),
      thin(
        'hvRightPosterior',
        [
          [[-125, -45, -8], 2.5],
          [[-100, -30, 22], 3.5],
          [[-83, -12, 35], 4],
        ],
        3.5,
      ),
      // Media: cisura lobar principal (línea de Cantlie), desde la fosa vesicular
      thin(
        'hvMiddle',
        [
          [[-50, 40, -30], 2.5],
          [[-40, 24, 15], 4],
          [[-30, 4, 52], 5],
          [[-24, -12, 76], 5.5],
          [[-23, -16, 82], 5.5],
        ],
        5,
      ),
      thin(
        'hvMiddleTributary',
        [
          [[-75, 30, 20], 2.5],
          [[-50, 20, 32], 3],
          [[-33, 10, 41], 3.5],
        ],
        3,
      ),
      // Izquierda: cisura intersegmentaria izquierda
      thin(
        'hvLeft',
        [
          [[62, 28, 8], 2.5],
          [[30, 20, 38], 3.5],
          [[0, 2, 66], 4.5],
          [[-16, -12, 80], 5],
          [[-23, -16, 82], 5],
        ],
        4.5,
      ),
      thin(
        'hvLeftTributary',
        [
          [[30, 42, -10], 2],
          [[22, 26, 30], 2.5],
          [[15, 11, 52], 3],
        ],
        2.5,
      ),
      // Tronco común media + izquierda (≈ 1 cm) hasta la cara anterior izquierda de la VCI
      thin(
        'hvCommonTrunk',
        [
          [[-23, -16, 82], 7.5],
          [[-21, -24, 90], 8],
        ],
        7.5,
        0.6,
      ),
      // Porta: tronco (11 mm) oblicuo hacia el hilio, bifurcación en la porta hepatis
      portal(
        'pvTrunk',
        [
          [[8, -22, -90], 5.5],
          [[-12, -8, -55], 5.5],
          [[-34, 0, -28], 5.5],
        ],
        5.5,
        1.2,
      ),
      portal(
        'pvRight',
        [
          [[-34, 0, -28], 4.5],
          [[-58, 2, -20], 4.3],
          [[-80, 4, -14], 4],
        ],
        4.2,
      ),
      portal(
        'pvRightAnterior',
        [
          [[-80, 4, -14], 3],
          [[-100, 30, -2], 2.6],
          [[-115, 48, 12], 2],
        ],
        2.5,
        0.8,
      ),
      portal(
        'pvRightPosterior',
        [
          [[-80, 4, -14], 3],
          [[-105, -22, -10], 2.6],
          [[-125, -38, 0], 2],
        ],
        2.5,
        0.8,
      ),
      // Izquierda: porción transversa y porción umbilical (gira hacia anterior)
      portal(
        'pvLeft',
        [
          [[-34, 0, -28], 3.8],
          [[-10, 8, -18], 3.6],
          [[0, 24, -6], 3.4],
        ],
        3.5,
      ),
      portal(
        'pvLeftLateral',
        [
          [[0, 24, -6], 2.8],
          [[35, 30, 4], 2.4],
          [[65, 30, 10], 1.8],
        ],
        2.4,
        0.8,
      ),
      portal(
        'pvLeftMedial',
        [
          [[0, 24, -6], 2.4],
          [[-22, 36, 0], 2],
          [[-40, 44, 10], 1.6],
        ],
        2,
        0.8,
      ),
      artery(
        'hepaticArtery',
        [
          [[10, -14, -85], 2.4],
          [[-14, 0, -50], 2.4],
          [[-32, 6, -25], 2.1],
          [[-70, 10, -10], 1.7],
        ],
        2.4,
      ),
      {
        id: 'aorta',
        tube: tube([
          [[12, -38, 140], 11],
          [[12, -38, -300], 10],
        ]),
        refRadius: 10,
        profileN: 5,
        wallTissue: Tissue.ArteryWall,
        wallMm: 1.2,
      },
      // Renales: la arteria derecha pasa por detrás de la VCI; la vena izquierda cruza
      // por delante de la aorta (larga) hacia la VCI.
      artery(
        'renalArteryRight',
        [
          [[12, -40, -62], 2.6],
          [[-10, -47, -67], 2.5],
          [hilumR, 2.4],
          [kw(kR, [0, 6, -3]), 2.2],
        ],
        2.5,
      ),
      thin(
        'renalVeinRight',
        [
          [kw(kR, [0, 8, 3]), 4],
          [hilumR, 4.5],
          [[-40, -38, -70], 4.5],
          [[-22, -30, -66], 4.5],
        ],
        4.5,
        0.6,
      ),
      artery(
        'renalArteryLeft',
        [
          [[12, -40, -60], 2.6],
          [[40, -48, -64], 2.5],
          [hilumL, 2.4],
          [kw(kL, [0, 6, -3]), 2.2],
        ],
        2.5,
      ),
      thin(
        'renalVeinLeft',
        [
          [kw(kL, [0, 8, 3]), 4],
          [hilumL, 4.5],
          [[40, -30, -62], 5],
          [[12, -22, -64], 5],
          [[-22, -28, -64], 5],
        ],
        5,
        0.6,
      ),
      // Interlobares del riñón derecho en las columnas de Bertin (entre pirámides),
      // arteria y vena adyacentes en el plano coronal lateral
      interlobarArtery('interlobarArtery1', -26),
      interlobarArtery('interlobarArtery2', 0),
      interlobarArtery('interlobarArtery3', 26),
      interlobarVein('interlobarVein1', -26),
      interlobarVein('interlobarVein2', 0),
      interlobarVein('interlobarVein3', 26),
    ];
    // Vía biliar: colédoco anterolateral a la porta en el ligamento hepatoduodenal,
    // hepáticos derecho e izquierdo por delante de las ramas portales, cístico al cuello.
    this.ducts = [
      {
        id: 'cbd',
        tube: tube([
          [[4, -10, -95], 2.8],
          [[-16, 4, -52], 2.8],
          [[-36, 8, -22], 2.4],
        ]),
        wallMm: 0.7,
      },
      {
        id: 'rightHepaticDuct',
        tube: tube([
          [[-36, 8, -22], 1.6],
          [[-62, 10, -14], 1.4],
          [[-82, 12, -8], 1.2],
        ]),
        wallMm: 0.6,
      },
      {
        id: 'leftHepaticDuct',
        tube: tube([
          [[-36, 8, -22], 1.5],
          [[-10, 16, -10], 1.3],
          [[12, 30, 0], 1.1],
        ]),
        wallMm: 0.6,
      },
      {
        id: 'cysticDuct',
        tube: tube([
          [[-13, 2, -58], 1.3],
          [[-16, 24, -52], 1.3],
          [[-20, 38, -48], 1.4],
        ]),
        wallMm: 0.6,
      },
    ];
    this.vesselById = new Map(this.vessels.map((v) => [v.id, v]));
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
   * Distancia con signo al hígado sin los recortes de cúpula y pared: unión suave
   * de los lóbulos, cara visceral en cuña (borde inferior agudo), impresión renal
   * y fosa vesicular.
   */
  liverSdf(m: Vec3): number {
    let d = smoothMin(sdEllipsoid(m, this.liver), sdEllipsoid(m, this.liverLeft), this.liverBlendMm);
    d = smoothMax(d, -this.visceralPlaneDistance(m), this.visceralPlane.edgeRoundMm);
    const kr = kidneyQuery(m, this.kidneyRight);
    d = smoothMax(d, -(kr.dOuter - this.renalImpressionMm), 8);
    d = smoothMax(d, -sdEllipsoid(m, this.gallbladder), 4);
    return d;
  }

  /** Áreas de referencia (mm²) para la fisiología (Q/A). */
  vesselAreas(): VesselAreas {
    const out = {} as VesselAreas;
    for (const v of this.vessels) {
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
   * dicta la fisiología en este instante.
   */
  classify(m: Vec3, caliber: VesselCaliber): Classification {
    const torso = this.torso;
    const depth = torsoDepth(m, torso);
    const none: Classification = {
      tissue: Tissue.Air,
      boundaryDistance: 1e3,
      boundaryNormal: [0, 1, 0],
      specular: 0,
      vessel: null,
      vesselHit: null,
    };
    if (m[2] < torso.zMin || m[2] > torso.zMax || depth > 0) return none;

    // Capas parietales
    const skin = torso.skinMm;
    const fat = skin + torso.fatMm;
    const wall = fat + torso.muscleMm;
    const d = -depth;
    let out: Classification = { ...none, tissue: Tissue.Bowel };
    if (d < skin) return { ...none, tissue: Tissue.Skin, boundaryDistance: skin - d, specular: 0.1 };
    if (d < fat) return { ...none, tissue: Tissue.Fat, boundaryDistance: Math.min(d - skin, fat - d), specular: 0.15 };
    if (d < wall) {
      out = { ...none, tissue: Tissue.Muscle, boundaryDistance: Math.min(d - fat, wall - d), specular: 0.2 };
    }

    // Costillas (dentro de la pared muscular o justo por debajo)
    for (const rib of this.ribs) {
      const r = sdRib(m, rib, torso);
      if (r.d < 0) {
        return {
          ...none,
          tissue: r.cartilage ? Tissue.Cartilage : Tissue.Bone,
          boundaryDistance: -r.d,
          specular: r.cartilage ? 0.3 : 0.9,
        };
      }
    }
    if (out.tissue === Tissue.Muscle) return out;

    // Columna
    const dSpine = sdCylinderZ(m, this.spine);
    if (dSpine < 0) return { ...none, tissue: Tissue.Bone, boundaryDistance: -dSpine, specular: 0.9 };

    // Vasos y conductos (antes de órganos: la luz prevalece). Descarte por esfera envolvente.
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
      if (hit.d < 0) return { ...none, tissue: Tissue.Fluid, boundaryDistance: -hit.d, boundaryNormal: [0, 0, 0], specular: 0.6 };
      return {
        ...none,
        tissue: Tissue.BileDuctWall,
        boundaryDistance: Math.min(hit.d, def.wallMm - hit.d),
        boundaryNormal: [0, 0, 0],
        specular: 0.6,
      };
    }
    if (bestVessel) {
      const { def, hit } = bestVessel;
      const specular = def.wallTissue === Tissue.VesselWallPortal ? 0.7 : def.wallTissue === Tissue.ArteryWall ? 0.6 : 0.35;
      if (hit.d < 0) {
        return { tissue: Tissue.Blood, boundaryDistance: -hit.d, boundaryNormal: [0, 0, 0], specular, vessel: def.id, vesselHit: hit };
      }
      return {
        tissue: def.wallTissue,
        boundaryDistance: Math.min(hit.d, def.wallMm - hit.d),
        boundaryNormal: [0, 0, 0],
        specular,
        vessel: null,
        vesselHit: hit,
      };
    }

    // Aurícula derecha (sangre, en el tórax)
    const dRa = sdSphere(m, this.rightAtrium);
    if (dRa < 0) return { ...none, tissue: Tissue.Blood, boundaryDistance: -dRa, specular: 0.5 };

    // Tórax: pulmón por encima de la cúpula; diafragma como lámina bajo ella
    const dDome = sdDome(m, this.dome);
    if (dDome < 0) return { ...none, tissue: Tissue.Lung, boundaryDistance: -dDome, specular: 1.0 };
    if (dDome < DIAPHRAGM_THICKNESS_MM)
      return { ...none, tissue: Tissue.Diaphragm, boundaryDistance: Math.min(dDome, DIAPHRAGM_THICKNESS_MM - dDome), specular: 0.9 };

    // Vesícula (líquido) en su fosa
    const dGb = sdEllipsoid(m, this.gallbladder);
    if (dGb < 0) return { ...none, tissue: Tissue.Fluid, boundaryDistance: -dGb, specular: 0.4 };

    // Riñones: corteza / pirámides / seno, con grasa perirrenal alrededor
    for (const k of [this.kidneyRight, this.kidneyLeft]) {
      const dc = Math.hypot(m[0] - k.center[0], m[1] - k.center[1], m[2] - k.center[2]);
      if (dc > k.radii[0] + this.perirenalMm + 2) continue;
      const kh = kidneyQuery(m, k);
      if (kh.dOuter < 0) {
        const tissue = kh.region === 'sinus' ? Tissue.RenalSinus : kh.region === 'medulla' ? Tissue.RenalMedulla : Tissue.RenalCortex;
        const specular = kh.region === 'sinus' ? 0.6 : kh.region === 'medulla' ? 0.25 : 0.45;
        return { ...none, tissue, boundaryDistance: kh.inner, specular };
      }
      if (kh.dOuter < this.perirenalMm) {
        return { ...none, tissue: Tissue.PerirenalFat, boundaryDistance: Math.min(kh.dOuter, this.perirenalMm - kh.dOuter), specular: 0.6 };
      }
    }

    // Hígado con cápsula
    const dLiver = this.liverSdf(m);
    if (dLiver < 0) {
      const inner = Math.min(-dLiver, dDome - DIAPHRAGM_THICKNESS_MM, -depth - wall);
      if (inner < LIVER_CAPSULE_MM) return { ...none, tissue: Tissue.LiverCapsule, boundaryDistance: inner, specular: 0.5 };
      return { ...none, tissue: Tissue.Liver, boundaryDistance: inner, specular: 0.5 };
    }

    // Gas intestinal (confusor opcional)
    for (const g of this.gasPockets) {
      const dg = sdSphere(m, g);
      if (dg < 0) return { ...none, tissue: Tissue.BowelGas, boundaryDistance: -dg, specular: 1.0 };
    }
    return { ...none, tissue: Tissue.Bowel, boundaryDistance: 5, specular: 0.3 };
  }
}

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
