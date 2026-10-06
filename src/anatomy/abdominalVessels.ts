import type { Vec3 } from '../core/vec3';
import { ABDOMINAL_VESSEL_RADII, type VesselId } from '../physiology/vessels';
import { Tissue } from './tissues';
import type { DuctDef, VesselDef } from './vesselTree';

/** Registered source sections for main axes; branches between landmarks remain estimated.
 * Material LAS mm, same source xiphoid as skin and visceral fields. Never rescale an organ.
 * Positive node order: arteries toward tissue, veins toward their parent/confluence.
 */
const AXES: Partial<Record<VesselId, readonly Vec3[]>> = {
  aorta: [
    [17.5, -21.5, 100],
    [17, -22, 20],
    [10.8, -23.4, -30],
    [10.4, -22.9, -50],
    [9.7, -10.7, -90],
    [8.4, 0.2, -130],
    [7.1, 4.5, -170],
    [5.9, 2.6, -210],
  ],
  ivcInfra: [
    [-8.7, -4.1, -210],
    [-11.5, -3.1, -130],
    [-14, -5.4, -70],
    [-14.3, -5.7, -64],
    [-15.1, -5.8, -40],
    [-15.1, -5.7, -14],
    [-15.1, -5.6, 15],
    [-15.1, -5.6, 25],
    [-15, -5, 35],
  ],
  // Source section centroids: FJ2416 right and FJ2415 left hepatic veins,
  // same LAS registration as the liver. Selected proximal courses and their
  // estimated tributaries/junction are documented in docs/anatomy; no imported flow.
  hvRight: [
    [-70, -11.065, -25.4276],
    [-55, -16.0815, -21.5546],
    [-40, -17.526, -14.777],
    [-30, -14.5257, -13.3149],
    [-23, -10.5925, -14.626],
    [-15.1, -5.7, -14],
  ],
  hvRightAnterior: [
    [-95, 16, -35],
    [-83, 3.6714, -24.3448],
    [-70, -11.065, -25.4276],
  ],
  hvRightPosterior: [
    [-100, -30, -35],
    [-80, -29.9226, -10],
    [-55, -16.0815, -21.5546],
  ],
  hvMiddle: [
    [-40, 36, -58],
    [-30, 29, -45],
    [-25, 19, -30],
    [-19, 10, -14],
    [-12, 4, -6],
    [-8, 1.2108, -3.757],
  ],
  hvMiddleTributary: [
    [-70, 35, -65],
    [-50, 25, -57],
    [-25, 19, -30],
  ],
  hvLeft: [
    // Distal source sections at x=35/45 intersect the independently registered
    // stomach/liver envelope; they remain rejected evidence, not stitched into runtime.
    [25, 19.641, -21.0818],
    [15, 18.2851, -17.7846],
    [5, 8.0443, -10.272],
    [-3, 2.0803, -5.2795],
    [-8, 1.2108, -3.757],
  ],
  hvLeftTributary: [
    [28, 55, -48],
    [20, 37, -28],
    [15, 18.2851, -17.7846],
  ],
  hvCommonTrunk: [
    [-8, 1.2108, -3.757],
    [-15.1, -5.7, -3],
  ],
  pvTrunk: [
    [-10.4, 6.5, -100],
    [-11.9, 8, -90],
    [-13.2, 12.2, -80],
    [-14.8, 16.2, -70],
    [-16.9, 19.1, -60],
    [-23.7, 16, -50],
  ],
  pvRight: [
    [-23.7, 16, -50],
    [-53.1, 6, -61.7],
    [-79, -3, -57],
  ],
  pvRightAnterior: [
    [-79, -3, -57],
    [-83, 28, -42],
    [-89, 43, -14],
  ],
  pvRightPosterior: [
    [-79, -3, -57],
    [-89, -24, -45],
    [-93, -48, -30],
  ],
  pvLeft: [
    [-23.7, 16, -50],
    [-8.1, 28.1, -44],
    [0.7, 42, -40],
  ],
  pvLeftLateral: [
    [0.7, 42, -40],
    [16, 62, -36],
    [31, 58, -21],
    [50, 43, -15],
  ],
  pvLeftMedial: [
    [0.7, 42, -40],
    [-21, 48, -30],
    [-32, 47, -21],
  ],
  celiacTrunk: [
    [9.6, -12, -84],
    [7, -4, -82],
    [4, 5, -82],
  ],
  splenicArtery: [
    [4, 5, -82],
    [25, 1.48, -92.21],
    [40, -5.42, -89.62],
    [55, -24.14, -85.71],
    [70, -23.86, -81.29],
    [85, -18.63, -75.53],
    [93, -37, -70],
  ],
  hepaticArtery: [
    [-20, 18, -83],
    [-17, 22, -65],
    [-25, 16, -53],
    [-45, 20, -43],
    [-65, 20, -36],
  ],
  sma: [
    [9.3, -10, -102],
    [2, 7, -114],
    [-6, 30, -130],
    [-15, 28, -160],
    [-20, 14, -180],
    [-31, 6, -231],
  ],
};

const EXTRA: Record<keyof typeof ABDOMINAL_VESSEL_RADII, readonly Vec3[]> = {
  leftGastricArtery: [
    [4, 5, -82],
    [10, 18, -66],
    [21, 28, -53],
  ],
  commonHepaticArtery: [
    [4, 5, -82],
    [-8, 18, -92],
    [-20, 18, -83],
  ],
  ima: [
    [7.1, 4.5, -170],
    [12, 10, -192],
    [19, 13, -217],
    [35, 5, -244],
  ],
  iliacArteryRight: [
    [5.9, 2.6, -210],
    [-11.6, -0.1, -230],
    [-30.9, -10.7, -255],
  ],
  iliacArteryLeft: [
    [5.9, 2.6, -210],
    [17.1, -7.9, -230],
    [29.9, -23, -255],
  ],
  internalIliacArteryRight: [
    [-30.9, -10.7, -255],
    [-27, -45, -280],
    [-26, -60, -317],
  ],
  internalIliacArteryLeft: [
    [29.9, -23, -255],
    [27.12, -26.89, -270],
    [26.44, -51.02, -290],
    [29.88, -98.62, -310],
  ],
  externalIliacArteryRight: [
    [-30.9, -10.7, -255],
    [-45, -18, -290],
    [-56, -11, -343],
  ],
  externalIliacArteryLeft: [
    [29.9, -23, -255],
    [37.59, -31.21, -270],
    [48.51, -37.89, -290],
    [57.21, -33.67, -310],
    [57, -27, -323],
  ],
  iliacVeinRight: [
    [-27.3, -21.7, -255],
    [-17.3, -11.4, -230],
    [-8.7, -4.1, -210],
  ],
  iliacVeinLeft: [
    [16.3, -32.1, -255],
    [1.1, -15.9, -230],
    [-8.7, -4.1, -210],
  ],
  internalIliacVeinRight: [
    [-33.12, -87.8, -330],
    [-26.47, -86.75, -310],
    [-27.05, -68.86, -290],
    [-27.91, -39.11, -270],
    [-27.3, -21.7, -255],
  ],
  internalIliacVeinLeft: [
    [23.58, -99.16, -330],
    [19.67, -97.83, -310],
    [20.7, -75.52, -290],
    [20.59, -50.93, -270],
    [16.3, -32.1, -255],
  ],
  externalIliacVeinRight: [
    [-49, -22, -343],
    [-37, -30, -290],
    [-27.3, -21.7, -255],
  ],
  externalIliacVeinLeft: [
    [52, -29, -330],
    [48.14, -44.7, -310],
    [39.41, -46.95, -290],
    [23, -43, -270],
    [16.3, -32.1, -255],
  ],
  portalSmv: [
    [-24, -10, -220],
    [-13, -8, -171],
    [-7, -6, -140],
    [-5, 4, -117],
    [-10.4, 6.5, -100],
  ],
  portalSplenic: [
    [77, -46, -83],
    [61, -19, -108],
    [35, -18, -114],
    [10, -12, -112],
    [-10.4, 6.5, -100],
  ],
};

/** Construction only, before bounds/branches/indices exist. Legacy geometry stays available for QA. */
export function registerAbdominalVessels(vessels: VesselDef[], ducts: DuctDef[]): void {
  for (const v of vessels) {
    const points = AXES[v.id];
    if (points) {
      const old = v.tube.nodes;
      v.tube = {
        ...v.tube,
        nodes: points.map((p, i) => ({ p: [...p], r: old[Math.round((i * (old.length - 1)) / (points.length - 1))].r })),
      };
    }
  }
  const byId = (id: VesselId) => {
    const v = vessels.find((v) => v.id === id);
    if (!v) throw new Error('Missing registered parent ' + id);
    return v;
  };
  byId('ivcSupra').tube.nodes[0].p = [-15, -5, 35];
  // Parent origins follow the source renal level; local hilar/sinus nodes already follow each kidney.
  for (const [id, points] of [
    [
      'renalArteryRight',
      [
        [8.4, 0.2, -130],
        [-16, -17, -132],
      ],
    ],
    [
      'renalArteryLeft',
      [
        [8.6, -1, -124],
        [30, -17, -125],
      ],
    ],
  ] as const)
    points.forEach((p, i) => {
      byId(id).tube.nodes[i].p = [...p];
    });
  const right = byId('renalVeinRight');
  right.tube.nodes[2].p = [-30, 10, -140];
  right.tube.nodes[3].p = [-11, -2, -141];
  const left = byId('renalVeinLeft');
  [
    [40, 8, -124],
    [27, 16, -124],
    [8, 17, -124],
    [0, 15, -126],
    [-11, -3, -126],
  ].forEach((p, i) => {
    left.tube.nodes[i + 2].p = p as Vec3;
  });
  for (const [id, points] of Object.entries(EXTRA) as [keyof typeof EXTRA, readonly Vec3[]][]) {
    const r = ABDOMINAL_VESSEL_RADII[id],
      artery = id.endsWith('Artery') || id.includes('Artery') || id === 'ima',
      portal = id.startsWith('portal');
    vessels.push({
      id,
      tube: { kind: 'tube', apScale: 1, nodes: points.map((p) => ({ p: [...p], r })) },
      refRadius: r,
      profileN: artery ? 2 : portal ? 4 : 3,
      wallTissue: artery ? Tissue.ArteryWall : portal ? Tissue.VesselWallPortal : Tissue.VesselWallThin,
      wallMm: portal ? 0.8 : artery ? 0.6 : 0.5,
    });
  }
  const ductPoints: Record<DuctDef['id'], Vec3[]> = {
    cbd: [
      [-35, 5, -146],
      [-28, 9, -115],
      [-23, 12, -78],
      [-24, 24, -56],
    ],
    cysticDuct: [
      [-29, 18, -81],
      [-26, 14, -78],
      [-23, 12, -78],
    ],
    rightHepaticDuct: [
      [-24, 24, -56],
      [-44, 23, -49],
      [-70, 18, -42],
    ],
    leftHepaticDuct: [
      [-24, 24, -56],
      [-7, 33, -46],
      [13, 44, -40],
    ],
  };
  for (const d of ducts)
    d.tube = { ...d.tube, nodes: ductPoints[d.id].map((p, i) => ({ p, r: d.tube.nodes[Math.min(i, d.tube.nodes.length - 1)].r })) };
}
