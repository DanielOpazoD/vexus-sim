import type { Tissue } from '../anatomy/tissues';

/**
 * Comprobación en vivo del invariante TS ↔ GLSL (decisión 30): el mapa de tejidos
 * que la GPU produce con `anatomy.glsl.ts` (`renderer.tissueMap`) y el que el
 * Worker produce con `anatomy/scene.ts` (`cutMapWorker`) muestrean la misma
 * rejilla (línea, profundidad) del plano; si las dos anatomías coinciden, las
 * celdas coinciden. Se comparan celda a celda; las discrepancias legítimas son
 * las de borde (una celda a caballo entre dos tejidos que cada implementación
 * resuelve con su precisión) y las de tiempo (mapas de instantes distintos
 * mientras la sonda se mueve), así que se informa el acuerdo total y el
 * acuerdo lejos de bordes.
 */
export interface TissueGrid {
  width: number;
  height: number;
  tissue: Uint8Array;
}

export interface EquivalenceReport {
  /** Fracción de celdas con el mismo tejido. */
  agreement: number;
  /** Fracción de acuerdo solo en celdas cuyos 4 vecinos (en el mapa CPU) tienen el mismo tejido. */
  interiorAgreement: number;
  /** Tejidos (CPU → GPU) con más desacuerdos, para depurar. */
  worst: Array<{ cpu: Tissue; gpu: Tissue; count: number }>;
  cells: number;
}

export function compareTissueGrids(cpu: TissueGrid, gpu: TissueGrid): EquivalenceReport | null {
  if (cpu.width !== gpu.width || cpu.height !== gpu.height) return null;
  const W = cpu.width;
  const H = cpu.height;
  let same = 0;
  let interior = 0;
  let interiorSame = 0;
  const pairs = new Map<number, number>();
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const i = v * W + u;
      const a = cpu.tissue[i];
      const b = gpu.tissue[i];
      if (a === b) same++;
      else pairs.set(a * 256 + b, (pairs.get(a * 256 + b) ?? 0) + 1);
      const isInterior =
        u > 0 &&
        u < W - 1 &&
        v > 0 &&
        v < H - 1 &&
        cpu.tissue[i - 1] === a &&
        cpu.tissue[i + 1] === a &&
        cpu.tissue[i - W] === a &&
        cpu.tissue[i + W] === a;
      if (isInterior) {
        interior++;
        if (a === b) interiorSame++;
      }
    }
  }
  const worst = [...pairs.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([k, count]) => ({ cpu: Math.floor(k / 256), gpu: k % 256, count }));
  return { agreement: same / (W * H), interiorAgreement: interior ? interiorSame / interior : 1, worst, cells: W * H };
}
