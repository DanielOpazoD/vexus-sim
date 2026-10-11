import { test, expect } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach } from './support';
import { measureHepatorenal } from '../tools/fidelity/hepatorenalMeasurements';
checkAfterEach();
for (const reference of [false, true])
  test(`ventana hepatorrenal normal: adquisición y contraste emparejado (${reference ? 'referencia' : 'legacy'})`, async ({
    page,
  }, info) => {
    budget(240_000);
    await bootWithoutErrors(page, reference ? '?e2e=1&reference=1' : '?e2e=1');
    const card = page.getByRole('button', { name: /^Hepatorrenal/ });
    await card.click();
    await expect(card).toHaveAttribute('aria-current', 'true');
    await page.evaluate(() => {
      const t = window.__vexusTest!;
      t.goToStartPoint('hepatorenal');
      t.setCompound(true);
      t.setHarmonic(true);
      t.frameCostMs(6);
    });
    await page.locator('#freeze').evaluate((b: HTMLButtonElement) => b.click());
    await expect(page.locator('#freeze')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#gl').evaluate((c: HTMLCanvasElement) => c.getContext('webgl2')!.finish());
    const clip = await page.locator('#gl').boundingBox();
    expect(clip).not.toBeNull();
    const path = info.outputPath('hepatorenal.png');
    await page.screenshot({ path, clip: clip!, animations: 'disabled' });
    const pose = reference
      ? { phi: 3.2, z: -80, yaw: 0, tilt: -0.4, rock: -0.2, lift: 0 }
      : { phi: 3.2, z: -80, yaw: -0.1, tilt: -0.4, rock: 0.1, lift: 0 };
    const r = measureHepatorenal(path, pose, reference);
    expect(r.bands.length).toBeGreaterThanOrEqual(3);
    expect(r.matchedPixels).toBeGreaterThan(150);
    expect(r.ratio).not.toBeNull();
    // Guarda de apariencia sintética del caso normal, no umbral diagnóstico de esteatosis.
    expect(r.ratio!).toBeGreaterThan(0.85);
    expect(r.ratio!).toBeLessThan(1.35);
    for (const b of r.bands) {
      expect(b.liver.saturated).toBeLessThan(0.01);
      expect(b.cortex.saturated).toBeLessThan(0.01);
    }
    info.annotations.push({ type: 'hepatorenal-matched-depth', description: JSON.stringify(r) });
  });
