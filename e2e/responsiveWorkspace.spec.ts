import { expect, test, type Page } from '@playwright/test';
import { WINDOW_GROUPS } from '../src/app/windowGroups';
import { bootWithoutErrors, budget, checkAfterEach } from './support';

checkAfterEach();

/** Una caja recortada no se arregla ocultando el overflow del documento. */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const width = document.documentElement.clientWidth;
    // Un píxel admite el redondeo de rejillas fraccionarias, no un control recortado.
    if (document.documentElement.scrollWidth > width + 1) problems.push(`documento: ${document.documentElement.scrollWidth} > ${width}`);
    if (document.body.scrollWidth > width + 1) problems.push(`body: ${document.body.scrollWidth} > ${width}`);
    for (const element of document.querySelectorAll<HTMLElement>(
      'button, input, select, .console-tabs, .windows, .modebar, .img-hud > div > span, .disclaimer, .cine-bar, .modebar-status, .field, .build-info',
    )) {
      const box = element.getBoundingClientRect();
      if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') continue;
      const name = element.id || element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 70) || element.tagName;
      if (box.width <= 0 || box.height <= 0 || box.left < -1 || box.right > width + 1)
        problems.push(`${name}: caja ${box.left}, ${box.right}, ${box.width} × ${box.height}; viewport ${width}`);
      if (element.scrollWidth > element.clientWidth + 1)
        problems.push(`${name}: contenido ${element.scrollWidth} > ${element.clientWidth}`);
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (!['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)) continue;
        const bounds = parent.getBoundingClientRect();
        const left = bounds.left + parent.clientLeft;
        const right = left + parent.clientWidth;
        if (box.left < left - 1 || box.right > right + 1) problems.push(`${name}: recortado por ${parent.id || parent.className}`);
      }
    }
    for (const selector of ['#gl', '#overlay', '#ecg', '#nav3d canvas', '#cutmap']) {
      const canvas = document.querySelector<HTMLCanvasElement>(selector)!;
      const box = canvas.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0 || canvas.width <= 0 || canvas.height <= 0)
        problems.push(`${selector}: ${box.width} × ${box.height}; bitmap ${canvas.width} × ${canvas.height}`);
    }
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('.traces canvas')) {
      if (!canvas.getClientRects().length) continue;
      const box = canvas.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0 || canvas.width <= 0 || canvas.height <= 0)
        problems.push(`${canvas.id}: ${box.width} × ${box.height}; bitmap ${canvas.width} × ${canvas.height}`);
    }
    return problems;
  });
}

/** Contraste del texto realmente computado, incluidas las superficies translúcidas. */
async function textContrast(page: Page) {
  return page.evaluate(() => {
    const rgba = (value: string): number[] => {
      const values = value.match(/[\d.]+/g)!.map(Number);
      return [...values.slice(0, 3), values[3] ?? 1];
    };
    const over = (top: number[], bottom: number[]): number[] => top.slice(0, 3).map((v, i) => top[3] * v + (1 - top[3]) * bottom[i]);
    const luminance = (rgb: number[]) =>
      rgb
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    return ['.brand', '#case-select', '.tab.active', '#mode-b', '.disclaimer', '#cine-time', '#hud-tl span', '#hud-tr span'].map(
      (selector) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        const ancestors: HTMLElement[] = [];
        for (let node: HTMLElement | null = element; node; node = node.parentElement) ancestors.unshift(node);
        let background = [255, 255, 255];
        for (const node of ancestors) {
          // El lienzo es un hermano bajo los avisos: el peor eco posible es blanco,
          // aunque el fondo CSS del centro sea negro. No fingir contraste con ese negro.
          if (node.id === 'sector-wrap') background = [255, 255, 255];
          background = over(rgba(getComputedStyle(node).backgroundColor), background);
        }
        const color = over(rgba(getComputedStyle(element).color), background);
        const [hi, lo] = [luminance(color), luminance(background)].sort((a, b) => b - a);
        return { selector, contrast: (hi + 0.05) / (lo + 0.05), backgroundLuminance: luminance(background) };
      },
    );
  });
}

const acquired = (page: Page) =>
  page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    const frame = s.renderer.displayedFrame;
    return { frozen: s.frozen, clock: s.physiology.clock.t, frame: frame && { t: frame.t, n: frame.n, pose: frame.anatomy.pose } };
  });

test('el espacio claro conserva mandos, lienzos y adquisición congelada de 320 a 1600 px', async ({ page }, info) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  const evidence: unknown[] = [];
  try {
    await page.locator('#freeze').click();
    await expect(page.locator('#cine-bar')).toBeVisible();
    const frozen = await acquired(page);
    expect(frozen.frozen).toBe(true);
    expect(frozen.frame).toBeDefined();
    for (const viewport of [
      { width: 320, height: 844 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
      { width: 1600, height: 1000 },
    ]) {
      await test.step(`${viewport.width} × ${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await expect
          .poll(() => layoutProblems(page), { message: 'lienzos positivos y controles sin desborde ni recorte horizontal' })
          .toEqual([]);
        expect(await acquired(page), 'redimensionar no cambia el reloj ni el cuadro adquirido').toEqual(frozen);
        const contrasts = await textContrast(page);
        for (const sample of contrasts) expect(sample.contrast, `${sample.selector}: WCAG AA texto normal`).toBeGreaterThanOrEqual(4.5);
        // Superficie clara y texto oscuro en la consola; los avisos de la imagen siguen sobre negro.
        expect(contrasts.find((s) => s.selector === '.brand')!.backgroundLuminance).toBeGreaterThan(0.8);
        for (const selector of ['.disclaimer', '#cine-time'])
          expect(contrasts.find((s) => s.selector === selector)!.backgroundLuminance, selector).toBeLessThan(0.1);
        await expect(page.locator('.win-card')).toHaveCount(WINDOW_GROUPS.reduce((n, group) => n + group.windows.length, 0));
        const lastWindow = page.locator('.win-card').last();
        await lastWindow.focus();
        await expect(lastWindow).toBeFocused();
        await expect(lastWindow).toBeInViewport();
        const cases = page.locator('#case-select');
        await cases.focus();
        await expect(cases).toBeFocused();
        await expect(cases).toBeInViewport();
        // El DOM sigue el flujo móvil: cabecera → imagen/cine → modos → consola → anatomía.
        // Tab real detecta saltos al carril del fondo que focus() directo no ve.
        await cases.press('Tab');
        await expect(page.locator('#cine')).toBeFocused();
        await page.locator('#cine').press('Tab');
        await expect(page.locator('#mode-b')).toBeFocused();
        expect(await cases.locator('option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value))).toEqual(
          expect.arrayContaining(['normal-adult', 'severe-congestion']),
        );
        for (const label of ['Doppler', 'Medir', 'Adquirir']) {
          const tab = page.getByRole('tab', { name: label, exact: true });
          await tab.click();
          await expect(tab).toHaveAttribute('aria-selected', 'true');
          await expect(page.getByRole('tabpanel', { name: label, exact: true })).toBeVisible();
          expect(await layoutProblems(page), `controles de ${label}`).toEqual([]);
        }
        evidence.push({ viewport, contrasts, acquisition: await acquired(page) });
        if (viewport.width === 390 || viewport.width === 1600) {
          await page.evaluate(() => {
            window.scrollTo(0, 0);
            document.querySelector('#start-points')!.scrollTop = 0;
            document.querySelector('.console-scroll')!.scrollTop = 0;
          });
          const path = info.outputPath(`workspace-${viewport.width}.png`);
          await page.screenshot({ path, fullPage: true });
          await info.attach(`espacio-${viewport.width}`, { path, contentType: 'image/png' });
        }
      });
    }
    // El tamaño más estrecho conserva también los controles que cambian la disposición.
    await page.setViewportSize({ width: 320, height: 844 });
    for (const mode of ['m', 'color', 'pw', 'b']) {
      const button = page.locator(`#mode-${mode}`);
      await button.focus();
      await button.press('Enter');
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => layoutProblems(page), { message: `mandos accesibles en modo ${mode}` }).toEqual([]);
    }
    await page.locator('#cut-toggle').click();
    await expect(page.locator('#cut-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#cut-body')).toBeHidden();
    await page.locator('#cut-toggle').click();
    await expect(page.locator('#cut-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#cut-body')).toBeVisible();
    await page.locator('#torso-toggle').click();
    await expect(page.locator('#torso-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#left-rail')).toBeHidden();
    await expect(page.locator('#gl')).toBeVisible();
    await page.locator('#torso-toggle').click();
    await expect(page.locator('#torso-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#left-rail')).toBeVisible();
    await expect.poll(() => layoutProblems(page), { message: 'torso y corte restaurados sin desborde' }).toEqual([]);
    expect(await acquired(page), 'los modos y la disposición no adquieren ni alteran la captura congelada').toEqual(frozen);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('responsive-workspace', { body: JSON.stringify({ evidence, errors }, null, 2), contentType: 'application/json' });
  }
});
