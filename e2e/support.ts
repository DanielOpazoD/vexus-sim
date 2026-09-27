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
 * Un cuadro del bucle no tarda más de ~15 s en el corredor (medido: 0,5–12 s de media, con los ganchos dibujando): si en
 * `STALL_MS` no se completa ninguno, el bucle está colgado o lanza en cada cuadro (un cuadro que lanza no cuenta), y
 * la espera falla con ese motivo en vez de agotar el plazo de la prueba.
 */
const STALL_MS = 90_000;

/**
 * Espera a que `check` se cumpla (devuelve `true`, o una descripción del estado para el mensaje de error) con un
 * plazo en cuadros: si el bucle completa `frames` cuadros más y sigue sin cumplirse, falla. Lo que dependa de la
 * cadencia de 250 ms del estado y el panel (la lectura de la sonda, las tarjetas, el panel docente) pide ≥ 20
 * cuadros: con GPU real son 15 a 60 fps; con SwiftShader cada cuadro ya pasa de 250 ms.
 */
export async function withinFrames(page: Page, frames: number, what: string, check: () => Promise<true | string>): Promise<void> {
  await test.step(`${what} (≤ ${frames} cuadros)`, async () => {
    const f0 = await framesRendered(page);
    let fSeen = f0;
    let seenAt = Date.now();
    for (;;) {
      if ((await check()) === true) return;
      const f = await framesRendered(page);
      if (f >= f0 + frames) {
        const last = await check();
        if (last === true) return;
        throw new Error(`${what}: no se cumple tras ${f - f0} cuadros del bucle — ${last}`);
      }
      if (f !== fSeen) [fSeen, seenAt] = [f, Date.now()];
      else if (Date.now() - seenAt > STALL_MS)
        throw new Error(`${what}: el bucle no completa ningún cuadro en ${STALL_MS / 1000} s (${f - f0} de ${frames}) — ${await check()}`);
      await page.waitForTimeout(100);
    }
  });
}

/**
 * Como `withinFrames`, con el plazo en segundos del reloj de la simulación (el bucle lo avanza con el tiempo real
 * entre cuadros, ≤ 0,25 s por cuadro): para lo que la aplicación hace en un tiempo dado, como la sonda que se desliza.
 * Exige cuadros completos (el reloj avanza antes de dibujar: un cuadro que lanza lo movería sin dibujar) y falla si
 * el reloj vuelve atrás (otro caso es otro simulador, con su reloj en cero) o si el bucle se cuelga.
 */
export async function withinSimSeconds(page: Page, seconds: number, what: string, check: () => Promise<true | string>): Promise<void> {
  await test.step(`${what} (≤ ${seconds} s de simulación)`, async () => {
    const t0 = await simTime(page);
    let fSeen = await framesRendered(page);
    let seenAt = Date.now();
    for (;;) {
      if ((await check()) === true) return;
      const t = await simTime(page);
      if (t < t0) throw new Error(`${what}: el reloj de la simulación volvió atrás (${t0} → ${t} s): ¿otro simulador?`);
      if (t >= t0 + seconds) {
        const last = await check();
        if (last === true) return;
        throw new Error(`${what}: no se cumple tras ${(t - t0).toFixed(2)} s de simulación — ${last}`);
      }
      const f = await framesRendered(page);
      if (f !== fSeen) [fSeen, seenAt] = [f, Date.now()];
      else if (Date.now() - seenAt > STALL_MS)
        throw new Error(`${what}: el bucle no completa ningún cuadro en ${STALL_MS / 1000} s (t ${t} s) — ${await check()}`);
      await page.waitForTimeout(100);
    }
  });
}

/**
 * El reloj de la simulación avanza con cuadros completos: `frames` cuadros más y el reloj por delante. Un cuadro que
 * lanza (y lo informa al registro de errores, no a la consola) avanza el reloj antes de dibujar: no basta con el reloj.
 */
export async function clockRuns(page: Page, what: string, frames = 3): Promise<void> {
  const t1 = await simTime(page);
  const f1 = await framesRendered(page);
  await withinFrames(page, frames, what, async () => {
    const [t, f] = [await simTime(page), await framesRendered(page)];
    return (t > t1 && f >= f1 + 2) || `t ${t1} → ${t} s en ${f - f1} cuadros`;
  });
}

const allowedLogged = new WeakMap<Page, RegExp[]>();

/** Entradas del registro de errores de la aplicación que esta prueba provoca a propósito (p. ej. el contexto perdido). */
export function expectLoggedErrors(page: Page, patterns: RegExp[]): void {
  allowedLogged.set(page, [...(allowedLogged.get(page) ?? []), ...patterns]);
}

/**
 * Tras cada prueba: anota el arranque y el ritmo del bucle (lo que tarda un cuadro en el corredor, para calibrar los
 * plazos con datos) y, si la prueba pasó, exige vacío el registro de errores de la aplicación (`errorLog`), salvo lo
 * que la prueba declaró con `expectLoggedErrors`. Un `catch` informa ahí y no a la consola (CLAUDE.md, invariante 6):
 * sin esto, un bucle que lanza en cada cuadro pasaba por «sin errores».
 */
export function checkAfterEach(): void {
  test.afterEach(async ({ page }, info) => {
    const p = paces.get(page);
    if (!p) return;
    const f = await page.evaluate(() => window.__vexusTest?.framesRendered() ?? null).catch(() => null);
    const dt = (Date.now() - p.t0) / 1000;
    const n = f === null ? null : f - p.f0;
    info.annotations.push({
      type: 'ritmo del bucle',
      description: `arranque ${(p.bootMs / 1000).toFixed(1)} s; después ${n ?? '?'} cuadros en ${dt.toFixed(1)} s${n ? ` (${(dt / n).toFixed(2)} s/cuadro)` : ''}`,
    });
    if (info.status !== info.expectedStatus) return;
    const logged = await page.evaluate(() => window.__vexusTest?.loggedErrors() ?? null);
    const allowed = allowedLogged.get(page) ?? [];
    expect(
      (logged ?? []).filter((e) => !allowed.some((r) => r.test(e))),
      'registro de errores de la aplicación (errorLog)',
    ).toEqual([]);
  });
}
