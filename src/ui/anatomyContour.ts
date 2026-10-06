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
