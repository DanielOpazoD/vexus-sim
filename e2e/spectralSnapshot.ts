/** Pixel-derived baseline: reject local annotation glyphs without assuming its vertical position. */
export function spectralSnapshot(els: Element[]) {
  return els.map((el) => {
    const c = el as HTMLCanvasElement;
    // Repeated getImageData on the live canvas makes Chromium switch its renderer
    // from GPU to CPU, changing antialiased text pixels during the assertion.
    // Read a disposable software copy so the test does not mutate the renderer it verifies.
    const copy = document.createElement('canvas');
    copy.width = c.width;
    copy.height = c.height;
    const context = copy.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(c, 0, 0);
    const data = context.getImageData(0, 0, copy.width, copy.height).data;
    let hash = 2166136261;
    for (const v of data) hash = Math.imul(hash ^ v, 16777619) >>> 0;
    const yellowRows: number[] = [];
    for (let y = 0; y < c.height; y++) {
      let yellow = 0;
      for (let x = 0; x < c.width; x++) {
        const at = (y * c.width + x) * 4;
        if (data[at] - data[at + 2] > 50 && data[at + 1] - data[at + 2] > 45 && data[at] - data[at + 1] < 30) yellow++;
      }
      // A baseline spans the plot; a nearby yellow annotation does not.
      if (yellow > c.width / 2) yellowRows.push(y);
    }
    return {
      hash,
      columns: c.dataset.columns,
      lastTime: c.dataset.lastTime,
      marks: c.dataset.marks,
      zeroY: yellowRows.length ? yellowRows.reduce((a, b) => a + b, 0) / yellowRows.length : null,
    };
  });
}
