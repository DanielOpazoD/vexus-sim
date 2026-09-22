import { SeededRandom } from '../core/random';
import { add, cross, dist, normalize, rotateAxis, scale, sub, type Vec3 } from '../core/vec3';
import type { VesselId } from '../physiology/vessels';
import { BERTIN_COLUMNS_U, kidneyWorld, type Kidney, type Tube } from './primitives';
import { Tissue } from './tissues';

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
  /**
   * Ramas procedurales: velocidad relativa a la del vaso `id` del que dependen
   * (una rama de 3.º orden lleva ~0,85 de la velocidad media de su madre). 1 si se omite.
   */
  flowFactor?: number;
}

/** Conducto biliar: tubo sin flujo, luz anecoica y pared ecogénica. */
export interface DuctDef {
  id: 'cbd' | 'rightHepaticDuct' | 'leftHepaticDuct' | 'cysticDuct';
  tube: Tube;
  wallMm: number;
}

/**
 * Árbol vascular y vía biliar del avatar de referencia (base B.1–B.6 para los
 * calibres de tronco portal, suprahepática derecha y VCI; el resto es
 * [EXTRAPOLACIÓN PROPIA]). Coordenadas materiales en mm (marco levógiro,
 * decisión 22). Los vasos renales e interlobares se construyen en el marco local
 * del riñón (`kidneyWorld`) para que sigan a la primitiva si esta cambia.
 */
export function buildVesselTree(kidneyRight: Kidney, kidneyLeft: Kidney): { vessels: VesselDef[]; ducts: DuctDef[] } {
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
  const kR = kidneyRight;
  const kL = kidneyLeft;
  const kw = (k: Kidney, q: Vec3): Vec3 => kidneyWorld(q, k);
  const hilumR = kw(kR, [0, kR.radii[1] - 2, 0]);
  const hilumL = kw(kL, [0, kL.radii[1] - 2, 0]);
  // Interlobares en las columnas de Bertin: nacen en el seno y se abren en abanico
  // (u × 1,15 hacia la corteza) entre las pirámides; arteria y vena adyacentes
  const interlobarVein = (id: VesselId, u: number): VesselDef =>
    thin(
      id,
      [
        [kw(kR, [u * 1.15, -24, 1.8]), 1.4],
        [kw(kR, [u * 1.06, -15, 1.8]), 1.7],
        [kw(kR, [u, -6, 1.8]), 2.0],
      ],
      1.8,
      0.4,
    );
  const interlobarArtery = (id: VesselId, u: number): VesselDef =>
    artery(
      id,
      [
        [kw(kR, [u, -6, -1.8]), 1.4],
        [kw(kR, [u * 1.06, -15, -1.8]), 1.2],
        [kw(kR, [u * 1.15, -24, -1.8]), 1.0],
      ],
      1.2,
      0.4,
    );

  const vessels: VesselDef[] = [
    {
      id: 'ivcInfra',
      tube: tube(
        [
          [[-22, -16, -300], 9.5],
          [[-22, -16, 20], 10],
          [[-21, -14, 35], 10],
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
          [[-21, -14, 35], 10],
          [[-20, -12, 55], 10],
          [[-16, 2, 75], 10.5],
        ],
        0.8,
      ),
      refRadius: 10,
      profileN: 5,
      wallTissue: Tissue.VesselWallThin,
      wallMm: 0.8,
    },
    // Suprahepáticas: calibres BASALES de un adulto sano (curso medio 5–8 mm de diámetro,
    // desembocadura 8–10 mm; B.2); la congestión los dilata vía `hvRadiusScale` hasta
    // ~1,6× (≈ 15 mm de diámetro a 19 mmHg), como en la plétora real.
    // Derecha: plano intersegmentario del lóbulo derecho, entra en la cava por su cara
    // posterolateral derecha 1 cm por debajo del tronco común.
    thin(
      'hvRight',
      [
        [[-135, 12, -65], 2.4],
        [[-105, -4, -28], 3.6],
        [[-68, -18, 10], 4.8],
        [[-38, -16, 32], 5.6],
        [[-26, -16, 38], 6.0],
      ],
      5.6,
    ),
    thin(
      'hvRightAnterior',
      [
        [[-118, 42, -40], 2.0],
        [[-95, 16, -15], 2.8],
        [[-83, -12, -5], 3.2],
      ],
      2.8,
    ),
    thin(
      'hvRightPosterior',
      [
        [[-125, -45, -48], 2.0],
        [[-100, -30, -18], 2.8],
        [[-83, -12, -5], 3.2],
      ],
      2.8,
    ),
    // Media: cisura lobar principal (línea de Cantlie), desde la fosa vesicular
    thin(
      'hvMiddle',
      [
        [[-50, 40, -70], 2.0],
        [[-40, 24, -25], 3.2],
        [[-30, 4, 12], 4.0],
        [[-24, -2, 36], 4.4],
        [[-23, -6, 42], 4.4],
      ],
      4.5,
    ),
    thin(
      'hvMiddleTributary',
      [
        [[-75, 30, -20], 2.0],
        [[-50, 20, -8], 2.4],
        [[-33, 10, 1], 2.8],
      ],
      2.4,
    ),
    // Izquierda: cisura intersegmentaria izquierda
    thin(
      'hvLeft',
      [
        [[62, 28, -32], 2.0],
        [[30, 20, -2], 2.8],
        [[0, 2, 26], 3.6],
        [[-16, -2, 40], 4.0],
        [[-23, -6, 42], 4.0],
      ],
      4.2,
    ),
    thin(
      'hvLeftTributary',
      [
        [[30, 42, -50], 1.6],
        [[22, 26, -10], 2.0],
        [[15, 11, 12], 2.4],
      ],
      2.0,
    ),
    // Tronco común media + izquierda (≈ 1 cm) hasta la cara anterior izquierda de la VCI
    thin(
      'hvCommonTrunk',
      [
        [[-23, -6, 42], 6.0],
        [[-21, -14, 50], 6.4],
      ],
      6,
      0.6,
    ),
    // Porta: tronco (11 mm) oblicuo hacia el hilio, bifurcación en la porta hepatis
    portal(
      'pvTrunk',
      [
        [[8, -22, -107], 5.5],
        [[-12, -8, -72], 5.5],
        [[-34, 0, -45], 5.5],
      ],
      5.5,
      1.2,
    ),
    portal(
      'pvRight',
      [
        [[-34, 0, -45], 4.5],
        [[-58, 2, -37], 4.3],
        [[-80, 4, -31], 4],
      ],
      4.2,
    ),
    portal(
      'pvRightAnterior',
      [
        [[-80, 4, -31], 3],
        [[-100, 30, -19], 2.6],
        [[-115, 48, -5], 2],
      ],
      2.5,
      0.8,
    ),
    portal(
      'pvRightPosterior',
      [
        [[-80, 4, -31], 3],
        [[-105, -22, -27], 2.6],
        [[-125, -38, -17], 2],
      ],
      2.5,
      0.8,
    ),
    // Izquierda: porción transversa y porción umbilical, que gira hacia delante y abajo y
    // termina en el receso de Rex, justo por detrás del suelo de la fisura umbilical (x 15,
    // z < −30; decisión 40) donde se continúa con el ligamento redondo. De ahí salen las
    // ramas laterales (II–III) y mediales (IV).
    portal(
      'pvLeft',
      [
        [[-34, 0, -45], 3.8],
        [[-12, 10, -40], 3.6],
        [[8, 30, -38], 3.4],
      ],
      3.5,
    ),
    portal(
      'pvLeftLateral',
      [
        [[8, 30, -38], 2.8],
        [[38, 32, -22], 2.4],
        [[66, 30, -8], 1.8],
      ],
      2.4,
      0.8,
    ),
    portal(
      'pvLeftMedial',
      [
        [[8, 30, -38], 2.4],
        [[-16, 40, -26], 2],
        [[-38, 46, -10], 1.6],
      ],
      2,
      0.8,
    ),
    artery(
      'hepaticArtery',
      [
        [[10, -14, -102], 2.4],
        [[-14, 0, -67], 2.4],
        [[-32, 6, -42], 2.1],
        [[-70, 10, -27], 1.7],
      ],
      2.4,
    ),
    {
      id: 'aorta',
      tube: tube([
        [[12, -24, 100], 11],
        [[12, -24, -300], 10],
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
        [[12, -26, -62], 2.6],
        [[-12, -29, -67], 2.5],
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
        [[-40, -30, -70], 4.5],
        [[-22, -16, -66], 4.5],
      ],
      4.5,
      0.6,
    ),
    artery(
      'renalArteryLeft',
      [
        [[12, -26, -60], 2.6],
        [[40, -30, -64], 2.5],
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
        [[40, -22, -62], 5],
        [[12, -12, -64], 5],
        [[-22, -14, -64], 5],
      ],
      5,
      0.6,
    ),
    // Interlobares del riñón derecho en las columnas de Bertin (entre pirámides),
    // arteria y vena adyacentes en el plano coronal lateral
    interlobarArtery('interlobarArtery1', BERTIN_COLUMNS_U[0]),
    interlobarArtery('interlobarArtery2', BERTIN_COLUMNS_U[1]),
    interlobarArtery('interlobarArtery3', BERTIN_COLUMNS_U[2]),
    interlobarVein('interlobarVein1', BERTIN_COLUMNS_U[0]),
    interlobarVein('interlobarVein2', BERTIN_COLUMNS_U[1]),
    interlobarVein('interlobarVein3', BERTIN_COLUMNS_U[2]),
  ];
  // Vía biliar: colédoco anterolateral a la porta en el ligamento hepatoduodenal,
  // hepáticos derecho e izquierdo por delante de las ramas portales, cístico al cuello.
  const ducts: DuctDef[] = [
    {
      id: 'cbd',
      tube: tube([
        [[4, -10, -112], 2.8],
        [[-16, 4, -69], 2.8],
        [[-36, 8, -39], 2.4],
      ]),
      wallMm: 0.7,
    },
    {
      id: 'rightHepaticDuct',
      tube: tube([
        [[-36, 8, -39], 1.6],
        [[-62, 10, -31], 1.4],
        [[-82, 12, -25], 1.2],
      ]),
      wallMm: 0.6,
    },
    {
      id: 'leftHepaticDuct',
      tube: tube([
        [[-36, 8, -39], 1.5],
        [[-10, 16, -27], 1.3],
        [[12, 30, -17], 1.1],
      ]),
      wallMm: 0.6,
    },
    {
      id: 'cysticDuct',
      tube: tube([
        [[-13, 2, -75], 1.3],
        [[-16, 24, -69], 1.3],
        [[-20, 38, -65], 1.4],
      ]),
      wallMm: 0.6,
    },
  ];
  return { vessels, ducts };
}

/**
 * Ramas hepáticas de 3.º y 4.º orden, procedurales y deterministas (semilla fija:
 * el avatar es el mismo para todos los casos). Cada rama de 2.º orden (portal o
 * suprahepática) emite dos hijas por bifurcación con ángulo 30–45° alrededor de un
 * eje aleatorio perpendicular, longitud 0,7× la del segmento madre (22–40 mm) y
 * radio 0,62×; las hijas vuelven a bifurcarse una vez. Los extremos se acortan
 * hasta quedar a ≥ 3 mm dentro del hígado (`liverSdf`), así el árbol nunca sale del
 * parénquima aunque el hígado cambie de tamaño. Las ramas heredan el `id`
 * fisiológico de su madre (misma velocidad × `flowFactor`) y su tejido de pared:
 * manguito periportal ecogénico en la porta, pared fina en las suprahepáticas
 * (B.1–B.3; densidad de ramas [EXTRAPOLACIÓN PROPIA] de un hígado adulto).
 */
export function buildHepaticBranches(vessels: readonly VesselDef[], liverSdf: (m: Vec3) => number, seed = 7): VesselDef[] {
  const rng = new SeededRandom(seed);
  const out: VesselDef[] = [];
  /** Ramas madre: [id, ¿extremo periférico es el PRIMER nodo? (suprahepáticas: sí)] */
  const parents: Array<[VesselId, boolean]> = [
    ['pvRightAnterior', false],
    ['pvRightPosterior', false],
    ['pvLeftLateral', false],
    ['pvLeftMedial', false],
    ['hvRightAnterior', true],
    ['hvRightPosterior', true],
    ['hvMiddleTributary', true],
    ['hvLeftTributary', true],
    ['hvRight', true],
    ['hvMiddle', true],
    ['hvLeft', true],
  ];
  /** Punto a distancia `len` de `origin` en `dir`, acortado hasta quedar ≥ 3 mm dentro del hígado. */
  const fitInside = (origin: Vec3, dir: Vec3, len0: number): { end: Vec3; len: number } | null => {
    let len = len0;
    for (let i = 0; i < 8; i++) {
      const end = add(origin, scale(dir, len));
      if (liverSdf(end) <= -3) return { end, len };
      len *= 0.75;
    }
    return null;
  };
  const grow = (
    parent: VesselDef,
    origin: Vec3,
    dir: Vec3,
    r0: number,
    segLen: number,
    factor: number,
    depth: number,
    peripheralFirst: boolean,
  ): void => {
    if (depth > 2 || liverSdf(origin) > -2) return; // el origen también debe estar en el parénquima
    for (let k = 0; k < 2; k++) {
      // eje perpendicular aleatorio; ángulo de bifurcación alterno, y si esa dirección
      // sale del hígado se prueba la simétrica (el árbol real se acomoda a la cápsula)
      const rnd: Vec3 = normalize([rng.float() - 0.5, rng.float() - 0.5, rng.float() - 0.5]);
      const axis = normalize(cross(dir, rnd));
      const angle = ((k === 0 ? 1 : -1) * ((30 + 15 * rng.float()) * Math.PI)) / 180;
      const len0 = Math.min(40, Math.max(22, 0.7 * segLen)) * (0.9 + 0.2 * rng.float());
      let d2 = normalize(rotateAxis(dir, axis, angle));
      let fit = fitInside(origin, d2, len0);
      if (!fit || fit.len < 12) {
        d2 = normalize(rotateAxis(dir, axis, -angle * 1.6));
        fit = fitInside(origin, d2, len0);
      }
      if (!fit || fit.len < 12) continue;
      const rEnd = Math.max(0.9, r0 * 0.6);
      const nodes = peripheralFirst
        ? [
            { p: fit.end, r: rEnd },
            { p: origin, r: r0 },
          ]
        : [
            { p: origin, r: r0 },
            { p: fit.end, r: rEnd },
          ];
      out.push({
        id: parent.id,
        tube: { kind: 'tube', nodes, apScale: 1 },
        refRadius: r0,
        profileN: parent.profileN,
        wallTissue: parent.wallTissue,
        wallMm: Math.max(0.4, parent.wallMm * 0.7),
        flowFactor: factor,
      });
      grow(parent, fit.end, d2, rEnd, fit.len, factor * 0.85, depth + 1, peripheralFirst);
    }
  };
  for (const [id, peripheralFirst] of parents) {
    const parent = vessels.find((v) => v.id === id);
    if (!parent) continue;
    const nodes = parent.tube.nodes;
    const tip = peripheralFirst ? nodes[0] : nodes[nodes.length - 1];
    const prev = peripheralFirst ? nodes[1] : nodes[nodes.length - 2];
    const dir = normalize(sub(tip.p, prev.p));
    grow(parent, tip.p, dir, tip.r * 0.62, dist(tip.p, prev.p), 0.85, 1, peripheralFirst);
    // y ramas laterales a lo largo del último segmento (a 1/3 y 2/3), como las que
    // nacen a lo largo de un vaso real; cada una vuelve a bifurcarse una vez
    for (const f of [0.35, 0.7]) {
      const at: Vec3 = add(prev.p, scale(sub(tip.p, prev.p), f));
      const rAt = prev.r + (tip.r - prev.r) * f;
      grow(parent, at, dir, Math.max(0.9, rAt * 0.5), dist(tip.p, prev.p) * 0.6, 0.85, 2, peripheralFirst);
    }
  }
  return out;
}
