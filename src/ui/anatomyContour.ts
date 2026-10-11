/** Boundaries of an anatomical mask in normalized polar coordinates. No ultrasound pixels are changed. */
export function maskBoundary(mask: Uint8Array, width: number, height: number): Array<[number, number, number, number]> {
  const edges: Array<[number, number, number, number]> = [];
  const on = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && !!mask[y * width + x];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!on(x, y)) continue;
      const x0 = x / width,
        x1 = (x + 1) / width,
        y0 = y / height,
        y1 = (y + 1) / height;
      if (!on(x - 1, y)) edges.push([x0, y0, x0, y1]);
      if (!on(x + 1, y)) edges.push([x1, y0, x1, y1]);
      if (!on(x, y - 1)) edges.push([x0, y0, x1, y0]);
      if (!on(x, y + 1)) edges.push([x0, y1, x1, y1]);
    }
  return edges;
}

export type ContourPoint = [number, number];

/**
 * Isolínea a mitad de celda sobre la máscara adquirida (marching squares).
 * Caminos cerrados, incluidos huecos e islas; las diagonales no unen órganos.
 * No rellena agujeros ni cambia el mapa o la señal ecográfica.
 */
export function maskContours(mask: Uint8Array, width: number, height: number): ContourPoint[][] {
  const pairs: readonly (readonly [number, number])[][] = [
    [],
    [[0, 3]],
    [[0, 1]],
    [[3, 1]],
    [[1, 2]],
    [
      [0, 3],
      [1, 2],
    ],
    [[0, 2]],
    [[3, 2]],
    [[2, 3]],
    [[0, 2]],
    [
      [0, 1],
      [2, 3],
    ],
    [[1, 2]],
    [[3, 1]],
    [[0, 1]],
    [[0, 3]],
    [],
  ];
  const segments: [ContourPoint, ContourPoint][] = [];
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && !!mask[y * width + x];
  for (let y = -1; y < height; y++)
    for (let x = -1; x < width; x++) {
      const code = Number(on(x, y)) + 2 * Number(on(x + 1, y)) + 4 * Number(on(x + 1, y + 1)) + 8 * Number(on(x, y + 1));
      // Coordenadas enteras de media celda: claves compartidas exactas.
      const edge: ContourPoint[] = [
        [2 * x + 2, 2 * y + 1],
        [2 * x + 3, 2 * y + 2],
        [2 * x + 2, 2 * y + 3],
        [2 * x + 1, 2 * y + 2],
      ];
      for (const [a, b] of pairs[code]) segments.push([edge[a], edge[b]]);
    }
  const key = (p: ContourPoint) => `${p[0]},${p[1]}`;
  const adjacent = new Map<string, number[]>();
  segments.forEach((segment, i) =>
    segment.forEach((p) => {
      const k = key(p),
        ids = adjacent.get(k) ?? [];
      ids.push(i);
      adjacent.set(k, ids);
    }),
  );
  const used = new Uint8Array(segments.length),
    result: ContourPoint[][] = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    const start = segments[i][0],
      path = [start];
    let current = i,
      point = start;
    while (!used[current]) {
      used[current] = 1;
      const [a, b] = segments[current];
      point = key(a) === key(point) ? b : a;
      if (key(point) === key(start)) break;
      path.push(point);
      const next = adjacent.get(key(point))?.find((n) => !used[n]);
      if (next === undefined) break;
      current = next;
    }
    result.push(path.map(([x, y]) => [x / (2 * width), y / (2 * height)]));
  }
  return result;
}
