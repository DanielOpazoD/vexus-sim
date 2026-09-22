import { expect, test, type Page } from '@playwright/test';

/**
 * Humo de extremo a extremo: lo que ninguna prueba unitaria puede ver — que el
 * módulo arranca en el navegador, que WebGL2 renderiza cuadros, que la UI está
 * cableada (caso, modos, medición) y que no hay errores de consola.
 */
async function bootWithoutErrors(page: Page, query = '?e2e=1'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  // ?e2e expone ganchos de prueba estables (window.__vexusTest); nada más cambia
  await page.goto(`/${query}`);
  await expect(page.locator('#status')).toContainText(/\d+ fps/, { timeout: 30_000 });
  // los ganchos de prueba se cargan de forma diferida (import dinámico)
  await expect.poll(() => page.evaluate(() => typeof window.__vexusTest), { timeout: 30_000 }).toBe('object');
  return errors;
}

test('arranca, renderiza cuadros y no emite errores', async ({ page }) => {
  const errors = await bootWithoutErrors(page);
  // El reloj de simulación avanza: con SwiftShader un cuadro puede tardar segundos
  // (el bucle limita dt a 0,25 s por cuadro), así que se espera a que t cambie en
  // vez de fijar un plazo; los fps redondeados pueden ser 0 y no se exigen.
  const tOf = (s: string | null) => Number(/t ([\d.]+) s/.exec(s ?? '')?.[1] ?? 0);
  const t1 = tOf(await page.locator('#status').textContent());
  await expect.poll(async () => tOf(await page.locator('#status').textContent()), { timeout: 30_000 }).toBeGreaterThan(t1);
  expect(errors).toEqual([]);
});

test('cambia de caso y el HUD lo refleja', async ({ page }) => {
  const errors = await bootWithoutErrors(page);
  // Si el HUD no cambia, el mensaje dice por qué: caso vivo, selector, avisos y errores de consola
  // (en CI el paso a FA falló dos veces sin más pista que «esperaba FA»).
  const hudOr = async (sel: string, text: string) => {
    const hud = (await page.locator(sel).textContent()) ?? '';
    if (hud.includes(text)) return 'ok';
    const banner = await page.locator('.banner').allTextContents();
    const value = await page.locator('#case-select').inputValue();
    return `hud=${hud} · selector=${value} · avisos=${JSON.stringify(banner)} · errores=${JSON.stringify(errors)}`;
  };
  await page.selectOption('#case-select', 'severe-congestion');
  // modo alumno: el caso se rotula «Paciente B», nunca con su diagnóstico
  await expect.poll(() => hudOr('#hud-tl', 'Paciente B'), { timeout: 30_000 }).toBe('ok');
  await page.selectOption('#case-select', 'af-moderate-congestion');
  await expect.poll(() => hudOr('#hud-tr', 'FA'), { timeout: 30_000 }).toBe('ok');
  expect(errors).toEqual([]);
});

test('modos por teclado, pestaña Medir y captura de una medición', async ({ page }) => {
  test.setTimeout(180_000);
  // ?docente: al final se abre la pestaña Docente (en producción la casilla solo aparece así)
  const errors = await bootWithoutErrors(page, '?e2e=1&docente=1');
  await page.keyboard.press('p');
  await expect(page.locator('#mode-pw')).toHaveClass(/active/);
  await expect(page.locator('#hud-br')).toContainText('PW');
  await page.getByRole('tab', { name: 'Medir' }).click();
  await page.getByRole('button', { name: 'Suprahepática', exact: true }).click();
  // La puerta sobre la suprahepática (técnica del operador) y 7 s de espectro sin renderizar:
  // con SwiftShader el reloj avanza despacio y 2,5 s de espera no daban latidos completos
  expect(await page.evaluate(() => window.__vexusTest!.placeGate(['hvRight', 'hvMiddle']))).toBe(true);
  await page.evaluate(() => window.__vexusTest!.advance(7));
  await page.getByRole('button', { name: 'Capturar' }).click();
  // Un valor numérico: «VSH: —» (captura fallida) ya no pasa
  await expect(page.locator('.result')).toContainText(/VSH: S -?\d+\.\d · D -?\d+\.\d/);
  // Docente: el panel de depuración existe y se actualiza (la verdad fisiológica
  // necesita t > 8 s de simulación, inalcanzable con SwiftShader en CI; se prueba en local).
  // `force`: con render por software el hilo principal no deja al elemento «estable».
  await page.locator('#debug-toggle').check({ force: true });
  await page.getByRole('tab', { name: 'Docente' }).click({ force: true });
  await expect(page.locator('.debug')).toContainText(/t [\d.]+ s · latido/, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('sobrevive a la pérdida del contexto WebGL: avisa, se recupera y el reloj sigue', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await bootWithoutErrors(page);
  await page.evaluate(() => {
    const gl = (document.getElementById('gl') as HTMLCanvasElement).getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_lose_context')!;
    (window as unknown as { __lc: WEBGL_lose_context }).__lc = ext;
    ext.loseContext();
  });
  await expect(page.locator('.banner')).toContainText('Contexto GPU perdido', { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { __lc: WEBGL_lose_context }).__lc.restoreContext());
  await expect(page.locator('.banner')).toHaveCount(0, { timeout: 60_000 });
  const tOf = (s: string | null) => Number(/t ([\d.]+) s/.exec(s ?? '')?.[1] ?? 0);
  const t1 = tOf(await page.locator('#status').textContent());
  await expect.poll(async () => tOf(await page.locator('#status').textContent()), { timeout: 60_000 }).toBeGreaterThan(t1);
  expect(errors).toEqual([]);
});

test('el speckle del parénquima hepático tiene estadística de Rayleigh', async ({ page }) => {
  // Guarda de fidelidad de imagen (Fase 3): la envolvente de un speckle plenamente desarrollado
  // tiene SNR = 1,91. Detectar intensidad (1,0), sumar magnitudes antes del haz (≈ 9) o suavizar
  // la envolvente (≈ 3,7) salen de la banda (src/validation/speckle.test.ts).
  // Tres cuadros completos + lectura de la envolvente con SwiftShader: ~6 s cada uno en local y
  // ~3× en el runner de CI (agotó los 90 s por defecto).
  test.setTimeout(240_000);
  const errors = await bootWithoutErrors(page);
  for (const startPoint of ['subxiphoid', 'intercostal', 'flank'] as const) {
    const s = await page.evaluate((id) => window.__vexusTest!.speckle({ startPoint: id }), startPoint);
    const tag = `${startPoint}: ${JSON.stringify(s)}`;
    expect(s.patches, tag).toBeGreaterThan(50);
    expect(s.snr, tag).toBeGreaterThan(1.6);
    expect(s.snr, tag).toBeLessThan(2.25);
  }
  expect(errors).toEqual([]);
});

test('sin contacto no hay Doppler: el color y el espectro se apagan al levantar la sonda', async ({ page }) => {
  // Invariante de §23 de la guía. Medido con GPU real: color 1 346 celdas en contacto y 0 levantada;
  // PW 23 dB sobre el suelo en contacto y 7,5 dB (el valor del ruido puro) levantada.
  test.setTimeout(240_000);
  const errors = await bootWithoutErrors(page);
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  const r = await page.evaluate(() => {
    const T = window.__vexusTest!;
    const out: Record<string, number | boolean | null> = {};
    const veins = ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'] as const;
    T.goToStartPoint('renal');
    document.querySelector<HTMLButtonElement>('#mode-color')!.click();
    out.colorContact = T.colorOnVessel([...veins]);
    T.liftProbe(10);
    out.colorLifted = T.colorCells();
    T.liftProbe(0);
    document.querySelector<HTMLButtonElement>('#mode-pw')!.click();
    out.gate = T.placeGate([...veins]);
    T.advance(3);
    out.pwContact = T.pwBandOverFloorDb(2);
    T.liftProbe(10);
    T.advance(3);
    out.pwLifted = T.pwBandOverFloorDb(2);
    return out;
  });
  const tag = JSON.stringify(r);
  expect(r.colorContact, tag).toBeGreaterThan(50);
  expect(r.colorLifted, tag).toBe(0);
  expect(r.gate, tag).toBe(true);
  expect(r.pwContact! as number, tag).toBeGreaterThan((r.pwLifted as number) + 8);
  expect(r.pwLifted as number, tag).toBeLessThan(11);
  expect(errors).toEqual([]);
});

test('modo alumno ciego: sin diagnóstico en pantalla; el docente lo ve con ?docente', async ({ page }) => {
  // Guía §17. Nombres clínicos de los casos (no deben aparecer en modo alumno).
  const diagnoses = ['Adulto sano', 'Congestión venosa', 'congestión moderada', 'fallo derecho'];
  const errors = await bootWithoutErrors(page);
  await expect(page.locator('#debug-toggle')).toBeHidden();
  await page.selectOption('#case-select', 'severe-congestion');
  await expect(page.locator('#hud-tl')).toContainText('Paciente B');
  const body = await page.locator('body').innerText();
  for (const d of diagnoses) expect(body, d).not.toContain(d);
  const options = await page.locator('#case-select option').allTextContents();
  expect(options).toEqual(['Paciente A', 'Paciente B', 'Paciente C']);
  await expect(page.locator('#cutmap')).toHaveAttribute('data-labels', '0');
  await expect(page.locator('#layer-vessels')).toBeDisabled();
  expect(errors).toEqual([]);

  // Con ?docente la casilla aparece y al marcarla vuelven el nombre, los rótulos y los vasos
  const errors2 = await bootWithoutErrors(page, '?e2e=1&docente=1');
  await page.locator('#debug-toggle').check();
  await page.selectOption('#case-select', 'severe-congestion');
  await expect(page.locator('#hud-tl')).toContainText('Congestión venosa grave');
  await expect(page.locator('#cutmap')).toHaveAttribute('data-labels', '1');
  await expect(page.locator('#layer-vessels')).toBeEnabled();
  expect(errors2).toEqual([]);
});
