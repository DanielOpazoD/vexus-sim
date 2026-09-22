import { SeededRandom } from '../core/random';
import { add, cross, dist, normalize, rotateAxis, scale, sub, type Vec3 } from '../core/vec3';
import type { VesselId } from '../physiology/vessels';
import { kidneyWorld, type Kidney, type Tube } from './primitives';
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

  const vessels: VesselDef[] = [
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
    // Suprahepáticas: calibres BASALES de un adulto sano (curso medio 5–8 mm de diámetro,
    // desembocadura 8–10 mm; B.2); la congestión los dilata vía `hvRadiusScale` hasta
    // ~1,6× (≈ 15 mm de diámetro a 19 mmHg), como en la plétora real.
    // Derecha: plano intersegmentario del lóbulo derecho, entra en la cava por su cara
    // posterolateral derecha 1 cm por debajo del tronco común.
    thin(
      'hvRight',
      [
        [[-135, 12, -25], 2.4],
        [[-105, -4, 12], 3.6],
        [[-68, -18, 50], 4.8],
        [[-38, -26, 72], 5.6],
        [[-26, -26, 78], 6.0],
      ],
      5.6,
    ),
    thin(
      'hvRightAnterior',
      [
        [[-118, 42, 0], 2.0],
        [[-95, 16, 25], 2.8],
        [[-83, -12, 35], 3.2],
      ],
      2.8,
    ),
    thin(
      'hvRightPosterior',
      [
        [[-125, -45, -8], 2.0],
        [[-100, -30, 22], 2.8],
        [[-83, -12, 35], 3.2],
      ],
      2.8,
    ),
    // Media: cisura lobar principal (línea de Cantlie), desde la fosa vesicular
    thin(
      'hvMiddle',
      [
        [[-50, 40, -30], 2.0],
        [[-40, 24, 15], 3.2],
        [[-30, 4, 52], 4.0],
        [[-24, -12, 76], 4.4],
        [[-23, -16, 82], 4.4],
      ],
      4.5,
    ),
    thin(
      'hvMiddleTributary',
      [
        [[-75, 30, 20], 2.0],
        [[-50, 20, 32], 2.4],
        [[-33, 10, 41], 2.8],
      ],
      2.4,
    ),
    // Izquierda: cisura intersegmentaria izquierda
    thin(
      'hvLeft',
      [
        [[62, 28, 8], 2.0],
        [[30, 20, 38], 2.8],
        [[0, 2, 66], 3.6],
        [[-16, -12, 80], 4.0],
        [[-23, -16, 82], 4.0],
      ],
      4.2,
    ),
    thin(
      'hvLeftTributary',
      [
        [[30, 42, -10], 1.6],
        [[22, 26, 30], 2.0],
        [[15, 11, 52], 2.4],
      ],
      2.0,
    ),
    // Tronco común media + izquierda (≈ 1 cm) hasta la cara anterior izquierda de la VCI
    thin(
      'hvCommonTrunk',
      [
        [[-23, -16, 82], 6.0],
        [[-21, -24, 90], 6.4],
      ],
      6,
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
  const ducts: DuctDef[] = [
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
