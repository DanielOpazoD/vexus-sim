import { expect, test, type Page } from '@playwright/test';

/**
 * Esperas de la e2e. Corre con SwiftShader (WebGL2 por CPU: el corredor de GitHub no tiene GPU) y lo que tarda un
 * cuadro cambia de un corredor a otro y de un día a otro (de décimas a varios segundos). Regla: se espera en cuadros
 * del bucle de la aplicación (`framesRendered`) o en tiempo de simulación, que es lo que la aplicación promete («el
 * HUD cambia en el cuadro siguiente», «la sonda llega en ~2 s»); nunca «n segundos de reloj». Los plazos en
 * milisegundos que quedan son del arranque (dominado por la compilación) o detectan un cuelgue.
 */

/**
 * Plazo del arranque hasta los primeros cuadros. Lo domina la compilación de los programas GLSL con SwiftShader: en el
 * corredor de GitHub, 23–26 s con una sola página (una caché de programas mayor, `--gpu-program-cache-size-kb`, no lo
 * cambia) y 15–35 s por prueba con un trabajador por corredor; con dos trabajadores eran 40–60 s (27-09-2026; 18,6 s a
 * mediados de septiembre, antes de las decisiones 84–90). El plazo solo detecta un arranque colgado: ×5 sobre lo medido.
 */
export const BOOT_MS = 180_000;

/** Plazo de una prueba: `boots` arranques más `workMs` de trabajo (medido en el corredor, con margen ×2 o más). */
export function budget(workMs: number, boots = 1): void {
  test.setTimeout(boots * BOOT_MS + workMs);
}

/** Cuadros completos del bucle de la aplicación desde el arranque (no cuenta los que dibujan los ganchos). */
export const framesRendered = (page: Page): Promise<number> => page.evaluate(() => window.__vexusTest!.framesRendered());

/** Reloj de la simulación (s). */
export const simTime = (page: Page): Promise<number> => page.evaluate(() => window.__vexusTest!.sim().physiology.clock.t);

const paces = new WeakMap<Page, { bootMs: number; t0: number; f0: number }>();

/**
 * Arranca la aplicación con los ganchos de prueba (`?e2e=1`: pose por defecto y fundamental; `?e2e=app`: como el
 * usuario) y espera sus dos primeros cuadros. Devuelve la lista de errores de página y de consola, que cada prueba
 * exige vacía al final.
 */
export async function bootWithoutErrors(page: Page, query = '?e2e=1'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  const t0 = Date.now();
  await page.goto(`/${query}`);
  // los ganchos se cargan de forma diferida (import dinámico); el arranque acaba con dos cuadros del bucle
  await expect
    .poll(() => page.evaluate(() => (typeof window.__vexusTest === 'object' ? window.__vexusTest.framesRendered() : -1)), {
      timeout: BOOT_MS,
      message: 'arranque: ganchos cargados y dos cuadros del bucle',
    })
    .toBeGreaterThanOrEqual(2);
  // el estado se escribe en el primer cuadro con más de 250 ms desde el anterior (con SwiftShader, casi todos)
  await withinFrames(page, 30, 'estado con fps', async () => {
    const s = (await page.locator('#status').textContent()) ?? '';
    return /\d+ fps/.test(s) || `estado «${s}»`;
  });
  paces.set(page, { bootMs: Date.now() - t0, t0: Date.now(), f0: await framesRendered(page) });
  return errors;
}

/**
 * Espera a que `check` se cumpla (devuelve `true`, o una descripción del estado para el mensaje de error) con un
 * plazo en cuadros: si el bucle completa `frames` cuadros más y sigue sin cumplirse, falla. Lo que dependa de la
 * cadencia de 250 ms del estado y el panel (la lectura de la sonda, las tarjetas, el panel docente) pide ≥ 20
 * cuadros: con GPU real son 15 a 60 fps; con SwiftShader cada cuadro ya pasa de 250 ms.
 */
export async function withinFrames(page: Page, frames: number, what: string, check: () => Promise<true | string>): Promise<void> {
  await test.step(`${what} (≤ ${frames} cuadros)`, async () => {
    const f0 = await framesRendered(page);
    for (;;) {
      if ((await check()) === true) return;
      const f = await framesRendered(page);
      if (f >= f0 + frames) {
        const last = await check();
        if (last === true) return;
        throw new Error(`${what}: no se cumple tras ${f - f0} cuadros del bucle — ${last}`);
      }
      await page.waitForTimeout(100);
    }
  });
}

/**
 * Como `withinFrames`, con el plazo en segundos del reloj de la simulación (el bucle lo avanza con el tiempo real
 * entre cuadros, ≤ 0,25 s por cuadro): para lo que la aplicación hace en un tiempo dado, como la sonda que se desliza.
 */
export async function withinSimSeconds(page: Page, seconds: number, what: string, check: () => Promise<true | string>): Promise<void> {
  await test.step(`${what} (≤ ${seconds} s de simulación)`, async () => {
    const t0 = await simTime(page);
    for (;;) {
      if ((await check()) === true) return;
      const t = await simTime(page);
      if (t >= t0 + seconds) {
        const last = await check();
        if (last === true) return;
        throw new Error(`${what}: no se cumple tras ${(t - t0).toFixed(2)} s de simulación — ${last}`);
      }
      await page.waitForTimeout(100);
    }
  });
}

/**
 * Anota en cada prueba el arranque y el ritmo del bucle (cuadros por segundo de reloj): lo que tarda un cuadro en el
 * corredor, para calibrar los plazos con datos y no a ojo.
 */
export function annotateLoopPace(): void {
  test.afterEach(async ({ page }) => {
    const p = paces.get(page);
    if (!p) return;
    const f = await page.evaluate(() => window.__vexusTest?.framesRendered() ?? null).catch(() => null);
    const dt = (Date.now() - p.t0) / 1000;
    const n = f === null ? null : f - p.f0;
    test.info().annotations.push({
      type: 'ritmo del bucle',
      description: `arranque ${(p.bootMs / 1000).toFixed(1)} s; después ${n ?? '?'} cuadros en ${dt.toFixed(1)} s${n ? ` (${(dt / n).toFixed(2)} s/cuadro)` : ''}`,
    });
  });
}
