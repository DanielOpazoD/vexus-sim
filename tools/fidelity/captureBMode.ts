/** PNG del framebuffer B-mode presentado: no depende de fuentes ni del compositor de Chromium. */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
const { PNG } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle') as {
  PNG: { sync: { write: (image: { width: number; height: number; data: Buffer }) => Buffer } };
};
export function encodeBMode(width: number, height: number, gray: ArrayLike<number>): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || gray.length !== width * height)
    throw new Error('Dimensiones de B-mode inválidas');
  const data = Buffer.alloc(gray.length * 4);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error('Gris de B-mode inválido');
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return PNG.sync.write({ width, height, data });
}
/** Requiere la imagen realmente congelada y sin color; exporta filas tal como readDisplay las presenta. */
export async function captureBMode(page: Page, path: string): Promise<void> {
  const frame = await page.evaluate(() => {
    const sim = window.__vexusTest!.sim();
    if (!sim.frozen || sim.color.enabled) throw new Error('Captura exige B-mode congelado sin color');
    const { width, height, gray } = sim.renderer.readDisplay();
    return { width, height, gray: Array.from(gray) };
  });
  if (!frame.gray.some((x) => x > 0)) throw new Error('Framebuffer B-mode vacío en la ventana de comparación');
  writeFileSync(path, encodeBMode(frame.width, frame.height, frame.gray));
}
